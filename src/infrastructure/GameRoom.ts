import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { GameState } from "../core/state";
import type { Ship, Team, AiState, ShipClass } from "../core/ships/shipTypes";
import type { WeaponKind } from "../core/combat/weaponStats";
import { SHIP_CLASSES } from "@speakerdust/shared";
import { SHIP_BOOST_COST } from "../core/ships/shipStats";
import { TICK_MS, SAVE_EVERY_TICKS } from "../core/world/mapConfig";
import { clamp, uuid } from "../core/math";
import { createPlayerWithShip } from "../features/physics/playerSystem";
import { spawnWave, tickEnemyAI } from "../features/ai/enemySystem";
import { initZones, tickControlPoints, findZoneBonusForShip } from "../core/world/zones";
import { PersistenceQueue, serializeForStorage, hydrateState, PersistedState } from "./persistence/persistence";
import { SNAPSHOT_KEY } from "./persistence/constants";
import { validateMessage, buildInitPayload, buildTickPayload, checkMoveRate, checkShootRate, checkBoostRate, rateLimits } from "./network/network";
import { isOriginAllowed, validateToken } from "./network/auth";
import { checkConnectionRate } from "./network/rateLimit";
import { processAdminCommand } from "../features/admin/admin";
import { CombatSystem } from "../features/combat/combatSystem";

export { GameRoom };
export type { Env };

class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    ships: {}, players: {}, projectiles: {}, zones: {}, wave: 1, tick: 0,
  };

  private readonly persistence: PersistenceQueue;
  private readonly combat: CombatSystem;
  private readonly aiStates = new Map<string, AiState>();

  // Arreglos cacheados (Cero Garbage Collection por frame)
  private alivePlayers: Ship[] = [];
  private aliveEnemies: Ship[] = [];
  private aliveShips: Ship[] = [];
  private enemyCountsCache: Record<string, number> = {};

  // Loop de alta velocidad en memoria (En vez de disco/Alarms)
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state.zones = initZones();

    this.persistence = new PersistenceQueue(async () => {
      await this.ctx.storage.put(SNAPSHOT_KEY, serializeForStorage(this.state, this.aiStates));
    });

    this.combat = new CombatSystem(
      () => this.state,
      payload => this.safeBroadcast(payload),
      () => this.persistence.markDirty(),
    );

    this.ctx.blockConcurrencyWhile(async () => {
      try { await this.ctx.storage.deleteAlarm(); } catch { /* ignore */ }

      const stored = await this.ctx.storage.get<PersistedState>(SNAPSHOT_KEY);
      const hydrated = stored ? hydrateState(stored) : null;

      if (hydrated && stored) {
        this.state = hydrated;
        this.aiStates.clear();
        if (stored.aiStates) {
          for (const k in stored.aiStates) {
            this.aiStates.set(k, stored.aiStates[k] as AiState);
          }
        }
      } else {
        const results = spawnWave(1);
        for (const { ship, ai } of results) {
          this.state.ships[ship.id] = ship;
          this.aiStates.set(ship.id, ai);
        }
      }

      this.persistence.setHydrated();
      this.persistence.markDirty();
    });
  }

  // ── Network & Performance Helpers ──────────────────────────────────────────
  private safeSend(ws: WebSocket, payload: unknown): void {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(payload));
    } catch { /* ignorar conexiones muertas */ }
  }

  // OPTIMIZACIÓN: Stringify 1 sola vez en lugar de N veces para todos los jugadores
  private safeBroadcast(payload: object): void {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    const str = JSON.stringify(payload);
    for (let i = 0; i < sockets.length; i++) {
      try {
        if (sockets[i]!.readyState === 1) sockets[i]!.send(str);
      } catch { /* ignore */ }
    }
  }

  private getClientIP(request: Request): string {
    return request.headers.get("CF-Connecting-IP")
      ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
      ?? "unknown";
  }

  // Cache updater para evitar crear objetos en el GC
  private updateEnemyCounts(): Record<string, number> {
    for (const k in this.enemyCountsCache) this.enemyCountsCache[k] = 0;
    for (let i = 0; i < this.aliveEnemies.length; i++) {
      const cls = this.aliveEnemies[i]!.shipClass;
      this.enemyCountsCache[cls] = (this.enemyCountsCache[cls] || 0) + 1;
    }
    return this.enemyCountsCache;
  }

  // ── High Performance Game Loop ──────────────────────────────────────────────
  private ensureGameLoop(): void {
    if (this.tickTimer === null && this.ctx.getWebSockets().length > 0) {
      this.tickTimer = setInterval(() => {
        try { this.gameTick(); } catch (err) { console.error("GameTick Crash:", err); }
      }, TICK_MS);
    }
  }

  private stopGameLoop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      // Liberar memoria cuando no hay humanos
      this.alivePlayers.length = 0;
      this.aliveEnemies.length = 0;
      this.aliveShips.length = 0;
      // Guardar el estado al vaciarse la sala (Hibernación segura)
      this.ctx.waitUntil(this.ctx.storage.put(SNAPSHOT_KEY, serializeForStorage(this.state, this.aiStates)));
    }
  }

  // Backup system: por si el DO se reinicia por mantenimiento de Cloudflare
  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      this.stopGameLoop();
    }
  }

  // ── Lifecycle & Connections ───────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Upgrade, Connection",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Speakerdust Node", { status: 200, headers: { "Content-Type": "text/plain", ...corsHeaders } });
    }

    const url = new URL(request.url);
    if (!isOriginAllowed(origin, this.env.ALLOWED_ORIGINS)) return new Response("Origin not allowed", { status: 403 });

    const token = url.searchParams.get("token") ?? "";
    const { valid } = validateToken(token, this.env.AUTH_SECRET);
    if (!valid) return new Response("Invalid auth token", { status: 401 });

    const clientIP = this.getClientIP(request);
    if (!checkConnectionRate(clientIP)) return new Response("Rate limited", { status: 429 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const playerId = uuid();
    server.serializeAttachment({ playerId });

    let redCount = 0, blueCount = 0;
    for (const id in this.state.ships) {
      const s = this.state.ships[id];
      if (s && s.controller === "player") {
        if (s.team === "red") redCount++;
        else if (s.team === "blue") blueCount++;
      }
    }
    const team: Team = redCount <= blueCount ? "red" : "blue";

    const { player, ship } = createPlayerWithShip(playerId, team);
    this.state.ships[playerId] = ship;
    this.state.players[playerId] = player;

    this.safeSend(server, buildInitPayload(playerId, this.state));
    this.safeBroadcast({ type: "player_join", player: { id: player.id, name: player.name, color: player.color, team: player.team } });

    // Iniciar loop apenas conecte alguien
    this.ensureGameLoop();
    this.persistence.markDirty();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    const attachment = ws.deserializeAttachment() as { playerId: string } | null;
    if (!attachment) return;

    const ship = this.state.ships[attachment.playerId];
    if (!ship || ship.controller !== "player") return;

    const msg = validateMessage(raw);
    if (!msg) return;

    if (msg.type.startsWith("admin_")) {
      await this.processAdminMessage(ws, ship, msg);
      return;
    }

    switch (msg.type) {
      case "set_team": {
        const t = msg.team as Team;
        if (t === "red" || t === "blue" || t === "spectator") {
          ship.team = t;
          this.safeBroadcast({ type: "player_team", playerId: ship.id, team: t });
        }
        break;
      }
      case "respawn": {
        if (!ship.alive || ship.team === "spectator") {
          if (ship.team === "spectator") {
            let red = 0, blue = 0;
            for (const id in this.state.ships) {
              const s = this.state.ships[id];
              if (s && s.controller === "player") {
                if (s.team === "red") red++; else if (s.team === "blue") blue++;
              }
            }
            ship.team = red <= blue ? "red" : "blue";
            this.safeBroadcast({ type: "player_team", playerId: ship.id, team: ship.team });
          }
          // BUGFIX: Clear pending shots before respawn to avoid ghost bullets
          this.combat.removePendingShotsFor(ship.id);
          ship.respawn();
          this.persistence.markDirty();
          // BUGFIX: Reset shoot rate limiter so player can fire immediately after respawn
          const limit = rateLimits?.get(ws);
          if (limit) limit.lastShootMs = 0;
          this.safeSend(ws, { type: "respawned" });
          // BUGFIX: Send weapon_changed so client resets lastShot cooldown and weapon display
          this.safeSend(ws, { type: "weapon_changed", weapon: ship.weapon });
        }
        break;
      }
      case "boost": {
        if (!ship.alive || !checkBoostRate(ws)) return;
        if (ship.boostCooldown <= 0 && ship.boostEnergy >= SHIP_BOOST_COST) ship.boostQueued = true;
        break;
      }
      case "move": {
        if (!ship.alive || !checkMoveRate(ws)) return;
        this.processPlayerMovement(ship, msg);
        break;
      }
      case "switch_weapon": {
        if (!ship.alive) return;
        const weapon = ship.cycleToNextWeapon();
        this.safeSend(ws, { type: "weapon_changed", weapon });
        const limit = rateLimits?.get(ws);
        if (limit) limit.lastShootMs = 0;
        break;
      }
      case "shoot": {
        if (!ship.alive || !checkShootRate(ws)) return;
        this.combat.tryFireWeapon(ship);
        break;
      }
      case "changeClass": {
        const cls = msg.shipClass as ShipClass;
        if (cls && SHIP_CLASSES[cls] && cls !== ship.shipClass) {
          ship.shipClass = cls;
          ship.respawn();
          this.persistence.markDirty();
          this.safeSend(ws, { type: "respawned" });
          this.safeSend(ws, { type: "weapon_changed", weapon: ship.weapon });
          const limit = rateLimits?.get(ws);
          if (limit) limit.lastShootMs = 0;
        }
        break;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as { playerId?: string } | null;
    const playerId = attachment?.playerId;

    if (playerId && this.state.ships[playerId]) {
      delete this.state.ships[playerId];
      delete this.state.players[playerId];
      this.aiStates.delete(playerId);
      this.safeBroadcast({ type: "player_leave", playerId });
      this.combat.removePendingShotsFor(playerId);
      this.persistence.markDirty();
    }

    if (this.ctx.getWebSockets().length === 0) {
      this.stopGameLoop();
    }
  }

  // ── Game Loop & Core Systems ──────────────────────────────────────────────
  private gameTick(): void {
    const st = this.state;
    st.tick++;

    this.alivePlayers.length = 0;
    this.aliveEnemies.length = 0;
    this.aliveShips.length = 0;

    const ships = st.ships;
    for (const id in ships) {
      const s = ships[id];
      if (!s || !s.alive) continue;

      this.aliveShips.push(s);
      if (s.controller === "player") this.alivePlayers.push(s);
      else if (s.controller === "ai") this.aliveEnemies.push(s);
    }

    const zoneEvents = tickControlPoints(st.zones, this.alivePlayers, this.aliveEnemies, st.wave);
    for (let i = 0; i < zoneEvents.length; i++) {
      this.safeBroadcast({ type: "objective", ...zoneEvents[i] });
    }

    // Players
    for (let i = 0; i < this.alivePlayers.length; i++) {
      const player = this.alivePlayers[i]!;
      const zoneBonus = findZoneBonusForShip(player, st.zones);
      player.tick(zoneBonus);

      if (zoneBonus.repairEveryTicks > 0 && st.tick % zoneBonus.repairEveryTicks === 0 && player.hp < player.maxHp) player.hp++;
      if (zoneBonus.scoreEveryTicks > 0 && st.tick % zoneBonus.scoreEveryTicks === 0) player.score++;
    }

    // AI
    const enemyCounts = this.updateEnemyCounts() as Record<ShipClass, number>;
    for (let i = 0; i < this.aliveEnemies.length; i++) {
      const enemy = this.aliveEnemies[i]!;
      const ai = this.aiStates.get(enemy.id);
      if (!ai) continue;

      const target = tickEnemyAI(enemy, ai, this.alivePlayers, this.aliveEnemies, enemyCounts, st.zones);
      enemy.tick(0);
      if (target) this.combat.fireEnemyWeapon(enemy, target);
    }

    // Physics
    this.combat.resolvePendingShots();
    this.combat.tickProjectiles(this.aliveShips);
    this.combat.resolveCollisions(this.aliveShips);

    const newShips = this.combat.checkAndAdvanceWave(this.alivePlayers);
    for (let i = 0; i < newShips.length; i++) {
      this.aiStates.set(newShips[i]!.ship.id, newShips[i]!.ai);
    }

    if (st.tick % SAVE_EVERY_TICKS === 0) this.persistence.markDirty();
    this.safeBroadcast(buildTickPayload(st));
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  private processPlayerMovement(player: Ship, msg: any): void {
    if (typeof msg.seq === "number") player.inputSeq = msg.seq;

    if (typeof msg.throttle === "number" || typeof msg.strafe === "number" || typeof msg.turn === "number") {
      let f = clamp(Number(msg.throttle ?? 0), -1, 1);
      let s = clamp(Number(msg.strafe ?? 0), -1, 1);

      // Fast magnitude (Sin Math.hypot para más velocidad)
      const magSq = f * f + s * s;
      if (magSq > 1) {
        const mag = Math.sqrt(magSq);
        f /= mag; s /= mag;
      }

      player.inputForward = f;
      player.inputStrafe = s;
      if (typeof msg.turn === "number") player.inputTurn = clamp(Number(msg.turn), -1, 1);
      if (typeof msg.aimAngle === "number") player.targetAngle = msg.aimAngle;

    } else if (typeof msg.forward === "number" || typeof msg.strafe === "number") {
      let f = clamp(Number(msg.forward ?? 0), -1, 1);
      let s = clamp(Number(msg.strafe ?? 0), -1, 1);
      const magSq = f * f + s * s;
      if (magSq > 1) { const mag = Math.sqrt(magSq); f /= mag; s /= mag; }

      player.inputForward = f;
      player.inputStrafe = s;
      if (typeof msg.angle === "number") player.targetAngle = msg.angle;

    } else if (typeof msg.vx === "number" || typeof msg.vy === "number") {
      const rawX = clamp(Number(msg.vx ?? 0), -1, 1);
      const rawY = clamp(Number(msg.vy ?? 0), -1, 1);
      const cos = Math.cos(player.angle);
      const sin = Math.sin(player.angle);
      player.inputForward = clamp(rawX * cos + rawY * sin, -1, 1);
      player.inputStrafe = clamp(-rawX * sin + rawY * cos, -1, 1);
    } else {
      player.inputForward = 0;
      player.inputStrafe = 0;
    }
  }

  private async processAdminMessage(ws: WebSocket, player: Ship, msg: any): Promise<void> {
    const effect = processAdminCommand(msg, player, this.state, this.env);
    switch (effect.kind) {
      case "authed":
        this.safeSend(ws, { type: "admin_authed", ok: effect.ok });
        break;
      case "reset_all":
        this.safeBroadcast({ type: "admin_event", action: "reset_all" });
        this.state.wave = 1;
        this.persistence.markDirty();
        break;
      case "reset_data":
        this.safeBroadcast({ type: "admin_event", action: "reset_data" });
        this.ctx.storage.deleteAll().catch(() => { });
        this.state = { ships: {}, players: {}, projectiles: {}, zones: initZones(), wave: 1, tick: 0 };
        this.aiStates.clear();
        for (const sock of this.ctx.getWebSockets()) sock.close(1000, "Server Wipe");
        this.stopGameLoop();
        break;
      case "kick": {
        const targetWs = this.ctx.getWebSockets().find(s => (s.deserializeAttachment() as any)?.playerId === effect.playerId);
        if (targetWs) { try { targetWs.close(1000, "Kicked"); } catch { } }
        this.safeBroadcast({ type: "player_leave", playerId: effect.playerId });
        this.persistence.markDirty();
        break;
      }
      case "set_wave":
        this.safeBroadcast({ type: "new_wave", wave: effect.wave });
        for (const { ship, ai } of effect.spawns) {
          // FIX: Ahora sí agrega las naves al mapa
          this.state.ships[ship.id] = ship;
          this.aiStates.set(ship.id, ai);
        }
        this.persistence.markDirty();
        break;
      case "clear_enemies":
        this.safeBroadcast({ type: "admin_event", action: "clear_enemies" });
        // FIX: Eliminación real y física de los objetos
        for (const id in this.state.ships) {
          if (this.state.ships[id]?.controller === "ai") {
            delete this.state.ships[id];
            this.aiStates.delete(id);
          }
        }
        this.persistence.markDirty();
        break;
      case "godmode":
        this.safeSend(ws, { type: "admin_godmode", active: effect.active });
        this.safeBroadcast({ type: "admin_event", action: "godmode", playerId: player.id, active: effect.active });
        break;
      case "heal_all":
        this.safeBroadcast({ type: "admin_event", action: "heal_all" });
        this.persistence.markDirty();
        break;
    }
  }
}