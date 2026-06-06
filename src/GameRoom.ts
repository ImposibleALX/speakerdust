import { DurableObject } from "cloudflare:workers";
import {
  Env, GameState, PlayerShip, EnemyShip, Ship, Bullet, Team, WeaponKind,
  WORLD_W, WORLD_H, TICK_MS, SAVE_EVERY_TICKS, SNAPSHOT_KEY,
  SHIP_HEAT_LIMIT, SHIP_BOOST_COST, WEAPON_STATS, AI_STATS,
  HITBOX_PLAYER_BULLET_DEFAULT_SQ, HITBOX_ENEMY_BULLET_SQ,
  EMP_DURATION_TICKS, collisionRadiusFor,
  clamp, uuid, distSq, shortestAngleDelta, isAngleInArc,
} from "./gameState";
import {
  createPlayer, respawnPlayer, updateShipPhysics, applyShipDamage,
  resolveShipCollision, applyWeaponRecoil, cycleWeapon,
} from "./playerSystem";
import {
  spawnWave, updateEnemyInputs, computeEnemyCounts, shouldEnemyFire,
  generateEnemyBullets, applyBulletSplash, makeBullet,
} from "./enemySystem";
import { initZones, updateControlPoints, getZoneBonusForShip, findNearestZone } from "./zonesSystem";
import { PersistenceQueue, serializeForStorage, hydrateState, PersistedState } from "./persistence";
import { validateMessage, buildInitPayload, buildTickPayload, broadcast, checkMoveRate, checkShootRate, checkBoostRate } from "./network";
import { handleAdmin } from "./admin";

export { GameRoom };
export type { Env };

interface PendingShot {
  ownerId: string;
  weapon: WeaponKind;
  angle: number;
  targetId?: string;
  fireTick: number;
}

class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    ships: {}, bullets: {}, zones: {}, wave: 1, tick: 0,
  };
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private readonly persistence: PersistenceQueue;
  private pendingShots: PendingShot[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state.zones = initZones();

    this.persistence = new PersistenceQueue(async () => {
      await this.ctx.storage.put(SNAPSHOT_KEY, serializeForStorage(this.state));
    });

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
        if (!player.alive) {
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
        this.tryFireWeapon(player);
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
      this.pendingShots = this.pendingShots.filter(s => s.ownerId !== playerId);
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
            this.fireEnemyWeapon(enemy, closestPlayer);
          }
        }
      }
    }

    // Combat Resolution
    this.resolvePendingShots();
    this.updateBullets(alivePlayers, aliveEnemies);
    this.resolveCollisions(alivePlayers, aliveEnemies);
    this.resolveWaveCompletion(alivePlayers);

    if (st.tick % SAVE_EVERY_TICKS === 0) this.persistence.markDirty();
    this.safeBroadcast(buildTickPayload(st));
  }

  // ── Combat & Weapons ──────────────────────────────────────────────────────
  private tryFireWeapon(player: PlayerShip): void {
    if (player.shootCooldown > 0 || player.weaponHeat >= SHIP_HEAT_LIMIT || player.empTicks > 0) return;

    const weapon = player.weapon;
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    // Arc Check
    const targetId = this.findTargetId(player, weapon);
    if (targetId && !isAngleInArc(player.angle, Math.atan2(this.state.ships[targetId].y - player.y, this.state.ships[targetId].x - player.x), stats.arc)) {
      // Continue to fire but it won't be guided if guided. Or just return if strict.
    }

    player.shootCooldown = stats.cooldown;
    player.weaponHeat = Math.min(SHIP_HEAT_LIMIT + 40, player.weaponHeat + stats.heat);
    applyWeaponRecoil(player, player.angle, stats.recoil);

    if (stats.chargeTicks > 0) {
      this.queueShot(player.id, weapon, player.angle, stats.chargeTicks, targetId);
    } else {
      this.spawnWeaponBullets(player.id, "player", player.x, player.y, player.angle, weapon, targetId);
    }
    this.persistence.markDirty();
  }

  private fireEnemyWeapon(enemy: EnemyShip, target: PlayerShip): void {
    const weapon = AI_STATS[enemy.kind].preferredWeapon;
    const stats = WEAPON_STATS[weapon];
    const angle = Math.atan2(target.y + target.vy * 20 - enemy.y, target.x + target.vx * 20 - enemy.x);

    if (stats.chargeTicks > 0) {
      enemy.weapon = weapon;
      enemy.shootCooldown = Math.round(stats.cooldown * AI_STATS[enemy.kind].shootRateMul);
      enemy.weaponHeat = Math.min(130, enemy.weaponHeat + stats.heat);
      this.queueShot(enemy.id, weapon, angle, stats.chargeTicks, target.id);
    } else {
      const bullets = generateEnemyBullets(enemy, target);
      for (const b of bullets) this.state.bullets[b.id] = b;
    }
  }

  private queueShot(ownerId: string, weapon: WeaponKind, angle: number, delay: number, targetId?: string): void {
    const owner = this.state.ships[ownerId];
    if (!owner) return;

    this.pendingShots.push({ ownerId, weapon, angle, targetId, fireTick: this.state.tick + delay });
    this.safeBroadcast({
      type: "weapon_charge",
      ownerId,
      weapon,
      x: owner.x,
      y: owner.y,
      angle,
      ticks: delay,
      color: WEAPON_STATS[weapon].telegraphColor,
    });
  }

  private resolvePendingShots(): void {
    const ready = this.pendingShots.filter(s => s.fireTick <= this.state.tick);
    this.pendingShots = this.pendingShots.filter(s => s.fireTick > this.state.tick);

    for (const shot of ready) {
      const owner = this.state.ships[shot.ownerId];
      if (!owner || !owner.alive) continue;
      this.spawnWeaponBullets(shot.ownerId, owner.controller, owner.x, owner.y, shot.angle, shot.weapon, shot.targetId);
    }
  }

  private spawnWeaponBullets(
    ownerId: string,
    ownerController: "player" | "ai",
    x: number, y: number, angle: number,
    weapon: WeaponKind, targetId?: string
  ): void {
    const originX = x + Math.cos(angle) * 28;
    const originY = y + Math.sin(angle) * 28;
    const offsets = weapon === "plasma_broadside" ? [-Math.PI / 2, Math.PI / 2] : weapon === "autocannon" ? [-0.04, 0.04] : [0];

    for (const off of offsets) {
      const bullet = makeBullet(ownerId, ownerController, originX, originY, angle + off, weapon, targetId);
      this.state.bullets[bullet.id] = bullet;
    }
    this.safeBroadcast({ type: "shockwave", x: originX, y: originY, weapon });
  }

  // ── Bullet Physics & Collisions ───────────────────────────────────────────
  private updateBullets(alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    const st = this.state;

    for (const [bid, bullet] of Object.entries(st.bullets)) {
      // 1. Guided tracking logic
      if ((bullet.kind === "guided_missile" || bullet.kind === "torpedo") && bullet.targetId && bullet.turnRate) {
        const tgt = st.ships[bullet.targetId];
        if (tgt && tgt.alive) {
          const desiredAngle = Math.atan2(tgt.y - bullet.y, tgt.x - bullet.x);
          bullet.angle += shortestAngleDelta(bullet.angle, desiredAngle) * bullet.turnRate;
          bullet.vx = Math.cos(bullet.angle) * WEAPON_STATS[bullet.kind].speed;
          bullet.vy = Math.sin(bullet.angle) * WEAPON_STATS[bullet.kind].speed;
        }
      }

      // 2. Movement
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life--;

      // 3. Detonation / Culling
      if (bullet.detonateAtLife !== undefined && bullet.life <= bullet.detonateAtLife) {
        this.detonateBullet(bid, bullet, alivePlayers, aliveEnemies);
        continue;
      }

      if (bullet.life <= 0) {
        delete st.bullets[bid];
        continue;
      }

      // 4. Hit Detection (Hybrid PvPvE logic)
      if (bullet.ownerController === "player") {
        this.resolvePlayerBulletHits(bid, bullet, aliveEnemies, alivePlayers);
      } else {
        this.resolveEnemyBulletHits(bid, bullet, alivePlayers);
      }
    }
  }

  private resolvePlayerBulletHits(bid: string, bullet: Bullet, aliveEnemies: EnemyShip[], alivePlayers: PlayerShip[]): void {
    const owner = this.state.ships[bullet.ownerId] as PlayerShip | undefined;

    // Check AI Enemies
    for (const enemy of aliveEnemies) {
      const hitRadius = collisionRadiusFor(enemy) + bullet.radius;
      if (distSq(bullet, enemy) >= Math.max(HITBOX_PLAYER_BULLET_DEFAULT_SQ, hitRadius * hitRadius)) continue;

      this.applyHitToShip(enemy, bullet, owner, bid, aliveEnemies);
      return; // Bullet consumed
    }

    // Check PvP (Enemy Players)
    if (owner && owner.team !== "spectator") {
      for (const p of alivePlayers) {
        if (p.team === owner.team || p.team === "spectator" || p.id === owner.id) continue;

        const hitRadius = collisionRadiusFor(p) + bullet.radius;
        if (distSq(bullet, p) >= Math.max(HITBOX_PLAYER_BULLET_DEFAULT_SQ, hitRadius * hitRadius)) continue;

        this.applyHitToShip(p, bullet, owner, bid, aliveEnemies);
        return; // Bullet consumed
      }
    }
  }

  private resolveEnemyBulletHits(bid: string, bullet: Bullet, alivePlayers: PlayerShip[]): void {
    for (const player of alivePlayers) {
      if (player.team === "spectator") continue;

      const hitRadius = collisionRadiusFor(player) + bullet.radius;
      if (distSq(bullet, player) >= Math.max(HITBOX_ENEMY_BULLET_SQ, hitRadius * hitRadius)) continue;

      this.applyHitToShip(player, bullet, undefined, bid, []);
      return; // Bullet consumed
    }
  }

  private applyHitToShip(target: Ship, bullet: Bullet, owner: PlayerShip | undefined, bid: string, aliveEnemies: EnemyShip[]): void {
    delete this.state.bullets[bid];

    if (bullet.statusEffect === "emp") {
      target.empTicks = Math.max(target.empTicks || 0, EMP_DURATION_TICKS);
      if (target.controller === "player") {
        this.safeBroadcast({ type: "emp_hit", playerId: target.id, x: target.x, y: target.y });
      }
    }

    const result = applyShipDamage(target, bullet.damage, false, bullet.kind === "railgun");

    // Handle specific Splash for AI dependencies without breaking them
    if (target.controller === "ai") {
      this.handleSplash(bullet, aliveEnemies, target.id, owner);
    } else if (bullet.splashRadius > 0 && target.controller === "player") {
      // PvP Splash requires manual handling since enemySystem strictly expects EnemyShip arrays
      this.handlePvPSplash(bullet, target.id, owner);
      this.handleSplash(bullet, aliveEnemies, undefined, owner); // Still hit AI around PvP target
    }

    // Feedback & Death handling
    if (result.dead) {
      delete this.state.ships[target.id];
      if (owner) {
        owner.score += target.controller === "ai" ? this.getEnemyScore(target as EnemyShip) : 100;
      }

      if (target.controller === "player") {
        this.safeBroadcast({ type: "player_dead", playerId: target.id, x: target.x, y: target.y });
      } else {
        this.safeBroadcast({ type: "explosion", x: target.x, y: target.y, kind: target.kind, shipClass: (target as EnemyShip).shipClass });
      }
      this.persistence.markDirty();
    } else {
      if (result.shieldHit && target.controller === "player") {
        this.safeBroadcast({ type: "shield_hit", playerId: target.id, reason: "weapon" });
      } else {
        this.safeBroadcast({ type: "hit", x: target.x, y: target.y, weapon: bullet.kind });
      }
    }
  }

  private detonateBullet(bid: string, bullet: Bullet, alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    delete this.state.bullets[bid];
    this.safeBroadcast({ type: "shockwave", x: bullet.x, y: bullet.y, weapon: bullet.kind });

    if (bullet.ownerController === "player") {
      const owner = this.state.ships[bullet.ownerId] as PlayerShip | undefined;
      this.handleSplash(bullet, aliveEnemies, undefined, owner);
      this.handlePvPSplash(bullet, undefined, owner);
    } else {
      // Enemy splash hits ALL alive non-spectator players
      for (const player of alivePlayers) {
        if (player.team === "spectator") continue;
        if (distSq(bullet, player) <= bullet.splashRadius * bullet.splashRadius) {
          const result = applyShipDamage(player, Math.max(1, Math.round(bullet.damage * 0.7)), false);
          if (result.dead) {
            this.safeBroadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
            delete this.state.ships[player.id];
          }
        }
      }
    }
  }

  private handleSplash(bullet: Bullet, aliveEnemies: EnemyShip[], excludedEnemyId?: string, owner?: PlayerShip): void {
    if (bullet.splashRadius <= 0) return;
    const kills = applyBulletSplash(bullet.ownerId, bullet.x, bullet.y, bullet.damage, bullet.splashRadius, aliveEnemies, excludedEnemyId);

    for (const k of kills) {
      delete this.state.ships[k.enemyId];
      if (owner) owner.score += k.score;
      this.safeBroadcast({ type: "explosion", x: k.x, y: k.y, kind: k.kind });
    }
    this.safeBroadcast({ type: "splash", x: bullet.x, y: bullet.y, radius: bullet.splashRadius, weapon: bullet.kind });
  }

  private handlePvPSplash(bullet: Bullet, excludedPlayerId?: string, owner?: PlayerShip): void {
    if (bullet.splashRadius <= 0 || !owner) return;

    const alivePlayers = this.getPlayerShips().filter(p => p.alive && p.team !== "spectator");
    const splashDmg = Math.max(1, Math.round(bullet.damage * 0.7));

    for (const p of alivePlayers) {
      if (p.id === excludedPlayerId || p.team === owner.team) continue;
      if (distSq(bullet, p) <= bullet.splashRadius * bullet.splashRadius) {
        const result = applyShipDamage(p, splashDmg, false);
        if (result.dead) {
          owner.score += 100;
          this.safeBroadcast({ type: "player_dead", playerId: p.id, x: p.x, y: p.y });
          delete this.state.ships[p.id];
        }
      }
    }
  }

  private resolveCollisions(alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    for (const enemy of aliveEnemies) {
      for (const player of alivePlayers) {
        if (player.team === "spectator") continue;

        const { aHurt } = resolveShipCollision(player, enemy);
        if (!aHurt) continue;

        const result = applyShipDamage(player, 1, true);
        if (result.shieldHit) {
          this.safeBroadcast({ type: "shield_hit", playerId: player.id, reason: "impact" });
        }
        if (result.dead) {
          this.safeBroadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
          this.persistence.markDirty();
        }
      }
    }
  }

  private resolveWaveCompletion(alivePlayers: PlayerShip[]): void {
    const remainingEnemies = this.getEnemyShips().filter(e => e.alive);
    if (remainingEnemies.length > 0 || alivePlayers.length === 0) return;

    this.state.wave++;
    for (const player of alivePlayers) {
      player.shield = player.shieldMax;
      player.armor = player.armorMax;
      player.shieldRegenDelay = 0;
      player.hp = player.maxHp;
      player.boostEnergy = 100;
      player.weaponHeat = Math.max(0, player.weaponHeat - 35);
      player.iFrames = 60;
    }

    for (const enemy of spawnWave(this.state.wave)) {
      this.state.ships[enemy.id] = enemy;
    }

    this.safeBroadcast({ type: "new_wave", wave: this.state.wave });
    this.persistence.markDirty();
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  private findTargetId(player: PlayerShip, weapon: WeaponKind): string | undefined {
    if (weapon !== "guided_missile" && weapon !== "torpedo") return undefined;

    let targetId: string | undefined;
    let closestDSq = weapon === "torpedo" ? 384400 : 577600; // 620^2 o 760^2

    for (const [id, ship] of Object.entries(this.state.ships)) {
      if (!ship.alive || id === player.id) continue;

      // No apuntar a aliados
      if (ship.controller === "player" && (ship as PlayerShip).team === player.team) continue;
      if (ship.controller === "player" && (ship as PlayerShip).team === "spectator") continue;

      const dSq = distSq(player, ship);
      if (dSq < closestDSq) {
        closestDSq = dSq;
        targetId = id;
      }
    }
    return targetId;
  }

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