import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { GameState } from "../core/state";
import type { Ship, Team, AiState } from "../core/ships/shipTypes";
import type { WeaponKind } from "../core/combat/weaponStats";
import { classStats, SHIP_BOOST_COST } from "../core/ships/shipStats";
import { TICK_MS, SAVE_EVERY_TICKS } from "../core/world/mapConfig";
import { clamp, uuid } from "../core/math";
import {
  createPlayer, respawnPlayer, updateShipPhysics, cycleWeapon,
} from "../features/physics/playerSystem";
import {
  spawnWave, updateEnemyInputs, updateEnemyCombat, computeEnemyCounts,
} from "../features/ai/enemySystem";
import { initZones, updateControlPoints, getZoneBonusForShip, findNearestZone } from "../core/world/zones";
import { PersistenceQueue, serializeForStorage, hydrateState, PersistedState } from "./persistence/persistence";
import { SNAPSHOT_KEY } from "./persistence/constants";
import { validateMessage, buildInitPayload, buildTickPayload, broadcast, checkMoveRate, checkShootRate, checkBoostRate } from "./network/network";
import { isOriginAllowed, validateToken } from "./network/auth";
import { checkConnectionRate } from "./network/rateLimit";
import { handleAdmin } from "../features/admin/admin";
import { CombatSystem } from "../features/combat/combatSystem";

export { GameRoom };
export type { Env };

class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    ships: {}, projectiles: {}, zones: {}, wave: 1, tick: 0,
  };

  private readonly persistence: PersistenceQueue;
  private readonly combat: CombatSystem;
  private readonly aiStates = new Map<string, AiState>();

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
          for (const [k, v] of Object.entries(stored.aiStates)) {
            this.aiStates.set(k, v as AiState);
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
      await this.reconcileAlarmState();
    });
  }

  // ── Network Helpers ────────────────────────────────────────────────────────
  private safeSend(ws: WebSocket, payload: unknown): void {
    try {
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        ws.send(JSON.stringify(payload));
      }
    } catch { /* socket cerrado */ }
  }

  private safeBroadcast(payload: object): void {
    broadcast(this.ctx.getWebSockets(), payload);
  }

  private getClientIP(request: Request): string {
    return request.headers.get("CF-Connecting-IP")
      ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
      ?? "unknown";
  }

  private hasActiveGame(): boolean {
    return Object.values(this.state.ships).some(s => s.alive);
  }

  private async reconcileAlarmState(): Promise<void> {
    try {
      const active = this.hasActiveGame();
      const currentAlarm = await this.ctx.storage.getAlarm();

      if (!active) {
        if (currentAlarm !== null) {
          await this.ctx.storage.deleteAlarm();
        }
        return;
      }

      const now = Date.now();
      const staleThresholdMs = Math.max(120_000, TICK_MS * 20);

      if (currentAlarm === null || currentAlarm < now - staleThresholdMs) {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.setAlarm(now + TICK_MS);
      }
    } catch (err) {
      console.error("reconcileAlarmState failed:", err);
    }
  }

  private async ensureNextTickAlarm(): Promise<void> {
    try {
      if (!this.hasActiveGame()) {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    } catch (err) {
      console.error("ensureNextTickAlarm failed:", err);
    }
  }

  // ── Alarm-based Game Loop ─────────────────────────────────────────────────
  async alarm(): Promise<void> {
    await this.ctx.storage.sync();

    const alive = Object.values(this.state.ships).filter(s => s.alive);
    if (alive.length === 0) {
      try { await this.ctx.storage.deleteAlarm(); } catch { /* ignore */ }
      await this.ctx.storage.put(SNAPSHOT_KEY, serializeForStorage(this.state, this.aiStates));
      return;
    }

    try { this.gameTick(); } catch (err) { console.error("gameTick error:", err); }

    await this.ensureNextTickAlarm();
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
      return new Response("Speakerdust - connect via WebSocket", {
        status: 200, headers: { "Content-Type": "text/plain", ...corsHeaders },
      });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";

    if (!isOriginAllowed(origin, this.env.ALLOWED_ORIGINS)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const { valid } = validateToken(token, this.env.AUTH_SECRET);
    if (!valid) return new Response("Invalid auth token", { status: 401 });

    const clientIP = this.getClientIP(request);
    if (!checkConnectionRate(clientIP)) return new Response("Rate limited", { status: 429 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const playerId = uuid();
    server.serializeAttachment({ playerId });

    const playerShips = Object.values(this.state.ships).filter(s => s.controller === "player");
    const redCount = playerShips.filter(p => p.team === "red").length;
    const blueCount = playerShips.filter(p => p.team === "blue").length;
    const team: Team = redCount <= blueCount ? "red" : "blue";

    const player = createPlayer(playerId, team);
    this.state.ships[playerId] = player;

    this.safeSend(server, buildInitPayload(playerId, this.state));

    this.safeBroadcast({
      type: "player_join",
      player: { id: player.id, name: player.name, color: player.color, team: player.team },
    });

    await this.ensureNextTickAlarm();
    this.persistence.markDirty();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): void {
    const attachment = ws.deserializeAttachment() as { playerId: string } | null;
    if (!attachment) return;

    const ship = this.state.ships[attachment.playerId];
    if (!ship || ship.controller !== "player") return;

    const msg = validateMessage(raw);
    if (!msg) return;

    if (msg.type.startsWith("admin_")) {
      this.processAdminMessage(ws, ship, msg);
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
            const ships = Object.values(this.state.ships).filter(s => s.controller === "player");
            const red = ships.filter(p => p.team === "red").length;
            const blue = ships.filter(p => p.team === "blue").length;
            ship.team = red <= blue ? "red" : "blue";
            this.safeBroadcast({ type: "player_team", playerId: ship.id, team: ship.team });
          }
          respawnPlayer(ship);
          this.persistence.markDirty();
          this.safeSend(ws, { type: "respawned" });
          void this.reconcileAlarmState();
        }
        break;
      }
      case "boost": {
        if (!ship.alive || !checkBoostRate(ws)) return;
        if (ship.boostCooldown <= 0 && ship.boostEnergy >= SHIP_BOOST_COST) {
          ship.boostQueued = true;
        }
        break;
      }
      case "move": {
        if (!ship.alive || !checkMoveRate(ws)) return;
        this.processPlayerMovement(ship, msg);
        break;
      }
      case "switch_weapon": {
        if (!ship.alive) return;
        const weapon = cycleWeapon(ship);
        this.safeSend(ws, { type: "weapon_changed", weapon });
        break;
      }
      case "shoot": {
        if (!ship.alive || !checkShootRate(ws)) return;
        this.combat.tryFireWeapon(ship);
        break;
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { playerId?: string } | null;
    const playerId = attachment?.playerId;

    if (playerId && this.state.ships[playerId]) {
      delete this.state.ships[playerId];
      this.aiStates.delete(playerId);
      this.safeBroadcast({ type: "player_leave", playerId });
      this.combat.discardPendingShotsFor(playerId);
      this.persistence.markDirty();
      void this.reconcileAlarmState();
    }
  }

  // ── Game Loop & Core Systems ──────────────────────────────────────────────
  private gameTick(): void {
    const st = this.state;
    st.tick++;

    const allShips = Object.values(st.ships);
    const alivePlayers = allShips.filter(s => s.controller === "player" && s.alive);
    const aliveEnemies = allShips.filter(s => s.controller === "ai" && s.alive);

    // Zone Control Logic
    const zoneEvents = updateControlPoints(st.zones, alivePlayers, aliveEnemies, st.wave);
    for (const ev of zoneEvents) {
      this.safeBroadcast({ type: "objective", ...ev });
    }

    // Players Physics & Zone Bonuses
    for (const player of alivePlayers) {
      const zoneBonus = getZoneBonusForShip(player, st.zones);
      updateShipPhysics(player, zoneBonus);

      if (zoneBonus.repairEveryTicks > 0 && st.tick % zoneBonus.repairEveryTicks === 0 && player.hp < player.maxHp) {
        player.hp++;
      }
      if (zoneBonus.scoreEveryTicks > 0 && st.tick % zoneBonus.scoreEveryTicks === 0) {
        player.score += 1;
      }
    }

    // AI Logic & Physics
    const enemyCounts = computeEnemyCounts(aliveEnemies);
    for (const enemy of aliveEnemies) {
      const ai = this.aiStates.get(enemy.id);
      if (!ai) continue;

      const nearestZone = findNearestZone(enemy.x, enemy.y, st.zones);
      updateEnemyInputs(enemy, ai, alivePlayers, enemyCounts, nearestZone);
      updateShipPhysics(enemy, 0);
      updateEnemyCombat(enemy, ai, alivePlayers, (e, t) => this.combat.fireEnemyWeapon(e, t));
    }

    // Combat Resolution
    const aliveShips = [...alivePlayers, ...aliveEnemies];
    this.combat.resolvePendingShots();
    this.combat.updateBullets(aliveShips);
    this.combat.resolveCollisions(aliveShips);
    const newShips = this.combat.resolveWaveCompletion(alivePlayers);
    for (const { ai, ship } of newShips) {
      this.aiStates.set(ship.id, ai);
    }

    if (st.tick % SAVE_EVERY_TICKS === 0) this.persistence.markDirty();
    this.safeBroadcast(buildTickPayload(st));
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  private processPlayerMovement(player: Ship, msg: any): void {
    if (typeof msg.seq === "number") player.inputSeq = msg.seq;

    const hasLocal = typeof msg.forward === "number" || typeof msg.strafe === "number";
    const hasWorld = typeof msg.vx === "number" || typeof msg.vy === "number";

    if (hasLocal) {
      let f = clamp(Number(msg.forward ?? 0), -1, 1);
      let s = clamp(Number(msg.strafe ?? 0), -1, 1);
      const mag = Math.hypot(f, s);
      if (mag > 1) { f /= mag; s /= mag; }
      player.inputForward = f;
      player.inputStrafe = s;
    } else if (hasWorld) {
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

    if (typeof msg.angle === "number") {
      player.targetAngle = msg.angle;
    }
  }

  private processAdminMessage(ws: WebSocket, player: Ship, msg: any): void {
    const effect = handleAdmin(msg, player, this.state, this.env);
    switch (effect.kind) {
      case "authed":
        this.safeSend(ws, { type: "admin_authed", ok: effect.ok });
        break;
      case "reset_all":
        this.safeBroadcast({ type: "admin_event", action: "reset_all" });
        this.aiStates.clear();
        this.persistence.markDirty();
        void this.reconcileAlarmState();
        break;
      case "kick": {
        const targetWs = this.ctx.getWebSockets().find(sock => {
          const a = sock.deserializeAttachment() as { playerId?: string } | null;
          return a?.playerId === effect.playerId;
        });
        if (targetWs) { try { targetWs.close(1000, "Kicked by admin"); } catch { } }
        this.safeBroadcast({ type: "player_leave", playerId: effect.playerId });
        this.persistence.markDirty();
        void this.reconcileAlarmState();
        break;
      }
      case "set_wave":
        this.safeBroadcast({ type: "new_wave", wave: effect.wave });
        for (const { ship, ai } of effect.spawns) {
          this.aiStates.set(ship.id, ai);
        }
        this.persistence.markDirty();
        void this.reconcileAlarmState();
        break;
      case "clear_enemies":
        this.safeBroadcast({ type: "admin_event", action: "clear_enemies" });
        for (const [id] of this.aiStates) {
          if (!this.state.ships[id]) this.aiStates.delete(id);
        }
        this.persistence.markDirty();
        void this.reconcileAlarmState();
        break;
      case "godmode":
        this.safeSend(ws, { type: "admin_godmode", active: effect.active });
        this.safeBroadcast({ type: "admin_event", action: "godmode", playerId: player.id, active: effect.active });
        break;
      case "heal_all":
        this.safeBroadcast({ type: "admin_event", action: "heal_all" });
        this.persistence.markDirty();
        void this.reconcileAlarmState();
        break;
    }
  }

  private getEnemyScore(ship: Ship): number {
    return classStats(ship.shipClass).score;
  }
}
