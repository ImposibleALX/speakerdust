import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import {
  GameState,
} from "../core/state";
import type { PlayerShip, EnemyShip, Ship, Team } from "../core/ships/shipTypes";
import type { Bullet, WeaponKind } from "../core/combat/weaponStats";
import { WEAPON_STATS, HITBOX_PLAYER_BULLET_DEFAULT_SQ, HITBOX_ENEMY_BULLET_SQ, EMP_DURATION_TICKS } from "../core/combat/weaponStats";
import { AI_STATS, SHIP_HEAT_LIMIT, SHIP_BOOST_COST, collisionRadiusFor } from "../core/ships/shipStats";
import { TICK_MS, SAVE_EVERY_TICKS } from "../core/world/mapConfig";
import { clamp, uuid, distSq, shortestAngleDelta } from "../core/math";
import { isAngleInArc } from "../core/combat/patterns";
import {
  createPlayer, respawnPlayer, updateShipPhysics, applyShipDamage,
  resolveShipCollision, applyWeaponRecoil, cycleWeapon,
} from "../features/physics/playerSystem";
import {
  spawnWave, updateEnemyInputs, computeEnemyCounts, shouldEnemyFire,
  generateEnemyBullets, applyBulletSplash, makeBullet,
} from "../features/ai/enemySystem";
import { initZones, updateControlPoints, getZoneBonusForShip, findNearestZone } from "../core/world/zones";
import { PersistenceQueue, serializeForStorage, hydrateState, PersistedState } from "./persistence/persistence";
import { SNAPSHOT_KEY } from "./persistence/constants";
import { validateMessage, buildInitPayload, buildTickPayload, broadcast, checkMoveRate, checkShootRate, checkBoostRate } from "./network/network";
import { handleAdmin } from "../features/admin/admin";
import { CombatSystem } from "../features/combat/combatSystem";

export { GameRoom };
export type { Env };

class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    ships: {}, bullets: {}, zones: {}, wave: 1, tick: 0,
  };
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private readonly persistence: PersistenceQueue;
  private readonly combat: CombatSystem;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state.zones = initZones();

    this.persistence = new PersistenceQueue(async () => {
      await this.ctx.storage.put(SNAPSHOT_KEY, serializeForStorage(this.state));
    });
    this.combat = new CombatSystem(
      () => this.state,
      payload => this.safeBroadcast(payload),
      () => this.persistence.markDirty(),
    );

    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<PersistedState>(SNAPSHOT_KEY);
      const hydrated = stored ? hydrateState(stored) : null;
      if (hydrated) {
        this.state = hydrated;
      } else {
        for (const enemy of spawnWave(1)) this.state.ships[enemy.id] = enemy;
      }
      this.persistence.setHydrated();
      this.persistence.markDirty();
    });

    this.startLoop();
  }

  // ── Network Helpers ────────────────────────────────────────────────────────
  private safeSend(ws: WebSocket, payload: any): void {
    try {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(JSON.stringify(payload));
      }
    } catch {
      // Ignorar errores de socket cerrado silenciosamente
    }
  }

  private safeBroadcast(payload: any): void {
    broadcast(this.ctx.getWebSockets(), payload);
  }

  // ── Lifecycle & Connections ───────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Upgrade, Connection",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Speakerdust - connect via WebSocket", {
        status: 200, headers: { "Content-Type": "text/plain", ...corsHeaders },
      });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const playerId = uuid();
    server.serializeAttachment({ playerId });

    const playerShips = this.getPlayerShips();
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

    this.startLoop();
    this.persistence.markDirty();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): void {
    const attachment = ws.deserializeAttachment() as { playerId: string } | null;
    if (!attachment) return;

    const ship = this.state.ships[attachment.playerId];
    if (!ship || ship.controller !== "player") return;
    const player = ship as PlayerShip;

    const msg = validateMessage(raw);
    if (!msg) return;

    if (msg.type.startsWith("admin_")) {
      this.processAdminMessage(ws, player, msg);
      return;
    }

    switch (msg.type) {
      case "set_team": {
        const t = msg.team as Team;
        if (t === "red" || t === "blue" || t === "spectator") {
          player.team = t;
          this.safeBroadcast({ type: "player_team", playerId: player.id, team: t });
        }
        break;
      }
      case "respawn": {
        if (!player.alive || player.team === "spectator") {
          // Si es espectador, asignarle el equipo con menos gente antes de respawnear
          if (player.team === "spectator") {
            const ships = this.getPlayerShips();
            const red = ships.filter(p => p.team === "red").length;
            const blue = ships.filter(p => p.team === "blue").length;
            player.team = red <= blue ? "red" : "blue";
            this.safeBroadcast({ type: "player_team", playerId: player.id, team: player.team });
          }
          respawnPlayer(player);
          this.persistence.markDirty();
        }
        break;
      }
      case "boost": {
        if (!player.alive || !checkBoostRate(ws)) return;
        if (player.boostCooldown <= 0 && player.boostEnergy >= SHIP_BOOST_COST) {
          player.boostQueued = true;
        }
        break;
      }
      case "move": {
        if (!player.alive || !checkMoveRate(ws)) return;
        this.processPlayerMovement(player, msg);
        break;
      }
      case "switch_weapon": {
        if (!player.alive) return;
        const weapon = cycleWeapon(player);
        this.safeSend(ws, { type: "weapon_changed", weapon });
        break;
      }
      case "shoot": {
        if (!player.alive || !checkShootRate(ws)) return;
        this.combat.tryFireWeapon(player);
        break;
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { playerId?: string } | null;
    const playerId = attachment?.playerId;

    if (playerId && this.state.ships[playerId]) {
      delete this.state.ships[playerId];
      this.safeBroadcast({ type: "player_leave", playerId });
      this.combat.discardPendingShotsFor(playerId);
      this.persistence.markDirty();
    }

    if (this.getPlayerShips().length === 0) {
      this.stopLoop();
      this.persistence.markDirty();
    }
  }

  // ── Game Loop & Core Systems ──────────────────────────────────────────────
  private startLoop(): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => this.gameTick(), TICK_MS);
  }

  private stopLoop(): void {
    if (!this.loopTimer) return;
    clearInterval(this.loopTimer);
    this.loopTimer = null;
  }

  private gameTick(): void {
    const st = this.state;
    st.tick++;

    const playerShips = this.getPlayerShips();
    const enemyShips = this.getEnemyShips();
    const alivePlayers = playerShips.filter(p => p.alive);
    const aliveEnemies = enemyShips.filter(e => e.alive);

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
      const nearestZone = findNearestZone(enemy.x, enemy.y, st.zones);
      updateEnemyInputs(enemy, alivePlayers, enemyCounts, nearestZone);
      updateShipPhysics(enemy, 0);

      if (alivePlayers.length > 0) {
        let closestPlayer: PlayerShip | null = null;
        let closestDSq = Infinity;
        for (const p of alivePlayers) {
          const dSq = distSq(enemy, p);
          if (dSq < closestDSq) {
            closestDSq = dSq;
            closestPlayer = p;
          }
        }
        if (closestPlayer) {
          const angToTarget = Math.atan2(closestPlayer.y - enemy.y, closestPlayer.x - enemy.x);
          const aimError = shortestAngleDelta(enemy.angle, angToTarget);
          if (shouldEnemyFire(enemy, closestDSq, aimError)) {
            this.combat.fireEnemyWeapon(enemy, closestPlayer);
          }
        }
      }
    }

    // Combat Resolution
    this.combat.resolvePendingShots();
    this.combat.updateBullets(alivePlayers, aliveEnemies);
    this.combat.resolveCollisions(alivePlayers, aliveEnemies);
    this.combat.resolveWaveCompletion(alivePlayers);

    if (st.tick % SAVE_EVERY_TICKS === 0) this.persistence.markDirty();
    this.safeBroadcast(buildTickPayload(st));
  }

  // Utility

  private processPlayerMovement(player: PlayerShip, msg: any): void {
    const hasLocal = typeof msg.forward === "number" || typeof msg.strafe === "number";
    const hasWorld = typeof msg.vx === "number" || typeof msg.vy === "number";

    if (hasLocal) {
      player.inputForward = clamp(Number(msg.forward ?? 0), -1, 1);
      player.inputStrafe = clamp(Number(msg.strafe ?? 0), -1, 1);
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

  private processAdminMessage(ws: WebSocket, player: PlayerShip, msg: any): void {
    const effect = handleAdmin(msg, player, this.state, this.env);
    switch (effect.kind) {
      case "authed":
        this.safeSend(ws, { type: "admin_authed", ok: effect.ok });
        break;
      case "reset_all":
        this.safeBroadcast({ type: "admin_event", action: "reset_all" });
        this.persistence.markDirty();
        break;
      case "kick": {
        const targetWs = this.ctx.getWebSockets().find(sock => {
          const attachment = sock.deserializeAttachment() as { playerId?: string } | null;
          return attachment?.playerId === effect.playerId;
        });
        if (targetWs) {
          try { targetWs.close(1000, "Kicked by admin"); } catch { }
        }
        this.safeBroadcast({ type: "player_leave", playerId: effect.playerId });
        this.persistence.markDirty();
        break;
      }
      case "set_wave":
        this.safeBroadcast({ type: "new_wave", wave: effect.wave });
        this.persistence.markDirty();
        break;
      case "clear_enemies":
        this.safeBroadcast({ type: "admin_event", action: "clear_enemies" });
        this.persistence.markDirty();
        break;
    }
  }

  private getPlayerShips(): PlayerShip[] {
    return Object.values(this.state.ships).filter((s): s is PlayerShip => s.controller === "player");
  }

  private getEnemyShips(): EnemyShip[] {
    return Object.values(this.state.ships).filter((s): s is EnemyShip => s.controller === "ai");
  }

  private getEnemyScore(enemy: EnemyShip): number {
    return AI_STATS[enemy.kind]?.score ?? 0;
  }
}
