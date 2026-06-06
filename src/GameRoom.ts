import { DurableObject } from "cloudflare:workers";
import {
  Env, GameState, PlayerShip, EnemyShip, Ship, Bullet, Team, WeaponKind,
  WORLD_W, WORLD_H, TICK_MS, SAVE_EVERY_TICKS, SNAPSHOT_KEY,
  SHIP_HEAT_LIMIT, SHIP_BOOST_COST, WEAPON_STATS, AI_STATS,
  HITBOX_PLAYER_BULLET_DEFAULT_SQ, HITBOX_ENEMY_BULLET_SQ,
  EMP_DURATION_TICKS, collisionRadiusFor,
  clamp, uuid, distSq, shortestAngleDelta,
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

    try { server.send(JSON.stringify(buildInitPayload(playerId, this.state))); } catch { }

    broadcast(this.ctx.getWebSockets(), {
      type: "player_join",
      player: { id: player.id, name: player.name, color: player.color, team: player.team },
    });

    this.startLoop();
    this.persistence.markDirty();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string) {
    const { playerId } = ws.deserializeAttachment() as { playerId: string };
    const ship = this.state.ships[playerId];
    if (!ship || ship.controller !== "player") return;
    const player = ship as PlayerShip;

    const msg = validateMessage(raw);
    if (!msg) return;

    if (msg.type.startsWith("admin_")) {
      const effect = handleAdmin(msg, player, this.state, this.env);
      switch (effect.kind) {
        case "authed":
          try { ws.send(JSON.stringify({ type: "admin_authed", ok: effect.ok })); } catch { }
          break;
        case "reset_all":
          broadcast(this.ctx.getWebSockets(), { type: "admin_event", action: "reset_all" });
          this.persistence.markDirty();
          break;
        case "kick": {
          const targetWs = this.ctx.getWebSockets().find(sock => {
            try { return (sock.deserializeAttachment() as any)?.playerId === effect.playerId; } catch { return false; }
          });
          if (targetWs) { try { targetWs.close(1000, "Kicked by admin"); } catch { } }
          broadcast(this.ctx.getWebSockets(), { type: "player_leave", playerId: effect.playerId });
          this.persistence.markDirty();
          break;
        }
        case "set_wave":
          broadcast(this.ctx.getWebSockets(), { type: "new_wave", wave: effect.wave });
          this.persistence.markDirty();
          break;
        case "clear_enemies":
          broadcast(this.ctx.getWebSockets(), { type: "admin_event", action: "clear_enemies" });
          this.persistence.markDirty();
          break;
      }
      return;
    }

    switch (msg.type) {
      case "set_team": {
        const t = msg.team as Team;
        if (t === "red" || t === "blue" || t === "spectator") {
          player.team = t;
          broadcast(this.ctx.getWebSockets(), { type: "player_team", playerId, team: t });
        }
        break;
      }

      case "respawn":
        if (!player.alive) {
          respawnPlayer(player);
          this.persistence.markDirty();
        }
        break;

      case "boost":
        if (!player.alive || !checkBoostRate(ws)) return;
        if (player.boostCooldown <= 0 && player.boostEnergy >= SHIP_BOOST_COST) player.boostQueued = true;
        break;

      case "move": {
        if (!player.alive || !checkMoveRate(ws)) return;
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
          player.inputForward = 0; player.inputStrafe = 0;
        }
        if (typeof msg.angle === "number") player.targetAngle = msg.angle;
        break;
      }

      case "switch_weapon": {
        if (!player.alive) return;
        const weapon = cycleWeapon(player);
        try { ws.send(JSON.stringify({ type: "weapon_changed", weapon })); } catch { }
        break;
      }

      case "shoot":
        if (!player.alive || !checkShootRate(ws)) return;
        this.tryFireWeapon(player);
        break;
    }
  }

  webSocketClose(ws: WebSocket) {
    const { playerId } = ws.deserializeAttachment() as { playerId?: string };
    if (playerId && this.state.ships[playerId]) {
      delete this.state.ships[playerId];
      broadcast(this.ctx.getWebSockets(), { type: "player_leave", playerId });
      this.pendingShots = this.pendingShots.filter(s => s.ownerId !== playerId);
      this.persistence.markDirty();
    }
    if (this.getPlayerShips().length === 0) {
      this.stopLoop();
      this.persistence.markDirty();
    }
  }

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

    const zoneEvents = updateControlPoints(st.zones, alivePlayers, aliveEnemies, st.wave);
    for (const ev of zoneEvents) broadcast(this.ctx.getWebSockets(), { type: "objective", ...ev });

    for (const player of alivePlayers) {
      const zoneBonus = getZoneBonusForShip(player, st.zones);
      updateShipPhysics(player, zoneBonus);
      if (zoneBonus.repairEveryTicks > 0 && st.tick % zoneBonus.repairEveryTicks === 0 && player.hp < player.maxHp) player.hp++;
      if (zoneBonus.scoreEveryTicks > 0 && st.tick % zoneBonus.scoreEveryTicks === 0) player.score += 1;
    }

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
          if (dSq < closestDSq) { closestDSq = dSq; closestPlayer = p; }
        }
        if (closestPlayer && shouldEnemyFire(enemy, closestDSq)) this.fireEnemyWeapon(enemy, closestPlayer);
      }
    }

    this.resolvePendingShots();
    this.updateBullets(alivePlayers, aliveEnemies);
    this.resolveCollisions(alivePlayers, aliveEnemies);
    this.resolveWaveCompletion(alivePlayers);

    if (st.tick % SAVE_EVERY_TICKS === 0) this.persistence.markDirty();
    broadcast(this.ctx.getWebSockets(), buildTickPayload(st));
  }

  private tryFireWeapon(player: PlayerShip): void {
    if (player.shootCooldown > 0 || player.weaponHeat >= SHIP_HEAT_LIMIT || player.empTicks > 0) return;
    const weapon = player.weapon;
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    const angle = player.angle;
    const targetId = this.findTargetId(player, weapon);
    player.shootCooldown = stats.cooldown;
    player.weaponHeat = Math.min(SHIP_HEAT_LIMIT + 40, player.weaponHeat + stats.heat);
    applyWeaponRecoil(player, angle, stats.recoil);

    if (stats.chargeTicks > 0) {
      this.queueShot(player.id, weapon, angle, stats.chargeTicks, targetId);
    } else {
      this.spawnWeaponBullets(player.id, "player", player.x, player.y, angle, weapon, targetId);
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
    broadcast(this.ctx.getWebSockets(), {
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
    x: number,
    y: number,
    angle: number,
    weapon: WeaponKind,
    targetId?: string,
  ): void {
    const originX = x + Math.cos(angle) * 28;
    const originY = y + Math.sin(angle) * 28;
    const offsets = weapon === "plasma_broadside" ? [-Math.PI / 2, Math.PI / 2] : weapon === "autocannon" ? [-0.04, 0.04] : [0];
    for (const off of offsets) {
      const a = angle + off;
      const bullet = makeBullet(ownerId, ownerController, originX, originY, a, weapon, targetId);
      this.state.bullets[bullet.id] = bullet;
    }
    broadcast(this.ctx.getWebSockets(), { type: "shockwave", x: originX, y: originY, weapon });
  }

  private updateBullets(alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    const st = this.state;
    for (const [bid, bullet] of Object.entries(st.bullets)) {
      if ((bullet.kind === "guided_missile" || bullet.kind === "torpedo") && bullet.targetId && bullet.turnRate) {
        const tgt = st.ships[bullet.targetId];
        if (tgt && tgt.alive) {
          const desiredAngle = Math.atan2(tgt.y - bullet.y, tgt.x - bullet.x);
          bullet.angle += shortestAngleDelta(bullet.angle, desiredAngle) * bullet.turnRate;
          bullet.vx = Math.cos(bullet.angle) * WEAPON_STATS[bullet.kind].speed;
          bullet.vy = Math.sin(bullet.angle) * WEAPON_STATS[bullet.kind].speed;
        }
      }

      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life--;

      const shouldDetonate = bullet.detonateAtLife !== undefined && bullet.life <= bullet.detonateAtLife;
      if (shouldDetonate) {
        this.detonateBullet(bid, bullet, alivePlayers, aliveEnemies);
        continue;
      }

      if (bullet.life <= 0 || bullet.x < -120 || bullet.x > WORLD_W + 120 || bullet.y < -120 || bullet.y > WORLD_H + 120) {
        delete st.bullets[bid];
        continue;
      }

      if (bullet.ownerController === "player") this.resolveBulletAgainstEnemies(bid, bullet, aliveEnemies);
      else this.resolveBulletAgainstPlayers(bid, bullet, alivePlayers);
    }
  }

  private resolveBulletAgainstEnemies(bid: string, bullet: Bullet, aliveEnemies: EnemyShip[]): void {
    for (const enemy of aliveEnemies) {
      if (!enemy.alive) continue;
      const hitRadius = collisionRadiusFor(enemy) + bullet.radius;
      if (distSq(bullet, enemy) >= Math.max(HITBOX_PLAYER_BULLET_DEFAULT_SQ, hitRadius * hitRadius)) continue;

      const owner = this.state.ships[bullet.ownerId] as PlayerShip | undefined;
      const result = applyShipDamage(enemy, bullet.damage, false, bullet.kind === "railgun");
      if (bullet.statusEffect === "emp") enemy.empTicks = Math.max(enemy.empTicks, EMP_DURATION_TICKS);
      this.handleSplash(bullet, aliveEnemies, enemy.id, owner);
      delete this.state.bullets[bid];

      if (result.dead) {
        delete this.state.ships[enemy.id];
        if (owner) owner.score += this.getEnemyScore(enemy);
        broadcast(this.ctx.getWebSockets(), { type: "explosion", x: enemy.x, y: enemy.y, kind: enemy.kind, shipClass: enemy.shipClass });
        this.persistence.markDirty();
      } else {
        broadcast(this.ctx.getWebSockets(), { type: "hit", x: enemy.x, y: enemy.y, weapon: bullet.kind });
      }
      break;
    }
  }

  private resolveBulletAgainstPlayers(bid: string, bullet: Bullet, alivePlayers: PlayerShip[]): void {
    for (const player of alivePlayers) {
      if (!player.alive) continue;
      const hitRadius = collisionRadiusFor(player) + bullet.radius;
      if (distSq(bullet, player) >= Math.max(HITBOX_ENEMY_BULLET_SQ, hitRadius * hitRadius)) continue;

      delete this.state.bullets[bid];
      if (bullet.statusEffect === "emp") {
        player.empTicks = Math.max(player.empTicks, EMP_DURATION_TICKS);
        broadcast(this.ctx.getWebSockets(), { type: "emp_hit", playerId: player.id, x: player.x, y: player.y });
      }
      const result = applyShipDamage(player, bullet.damage, false, bullet.kind === "railgun");
      if (result.shieldHit) broadcast(this.ctx.getWebSockets(), { type: "shield_hit", playerId: player.id, reason: "weapon" });
      else if (result.armorHit) broadcast(this.ctx.getWebSockets(), { type: "hit", x: player.x, y: player.y, weapon: bullet.kind });
      if (result.dead) {
        broadcast(this.ctx.getWebSockets(), { type: "player_dead", playerId: player.id, x: player.x, y: player.y });
        this.persistence.markDirty();
      }
      break;
    }
  }

  private detonateBullet(bid: string, bullet: Bullet, alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    delete this.state.bullets[bid];
    broadcast(this.ctx.getWebSockets(), { type: "shockwave", x: bullet.x, y: bullet.y, weapon: bullet.kind });
    if (bullet.ownerController === "player") {
      const owner = this.state.ships[bullet.ownerId] as PlayerShip | undefined;
      this.handleSplash(bullet, aliveEnemies, undefined, owner);
    } else {
      for (const player of alivePlayers) {
        if (distSq(bullet, player) <= bullet.splashRadius * bullet.splashRadius) {
          const result = applyShipDamage(player, Math.max(1, Math.round(bullet.damage * 0.7)), false);
          if (result.dead) broadcast(this.ctx.getWebSockets(), { type: "player_dead", playerId: player.id, x: player.x, y: player.y });
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
      broadcast(this.ctx.getWebSockets(), { type: "explosion", x: k.x, y: k.y, kind: k.kind });
    }
    broadcast(this.ctx.getWebSockets(), { type: "splash", x: bullet.x, y: bullet.y, radius: bullet.splashRadius, weapon: bullet.kind });
  }

  private resolveCollisions(alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    for (const enemy of aliveEnemies) {
      for (const player of alivePlayers) {
        if (!player.alive || !enemy.alive) continue;
        const { aHurt } = resolveShipCollision(player, enemy);
        if (!aHurt) continue;
        const result = applyShipDamage(player, 1, true);
        if (result.shieldHit) broadcast(this.ctx.getWebSockets(), { type: "shield_hit", playerId: player.id, reason: "impact" });
        if (result.dead) {
          broadcast(this.ctx.getWebSockets(), { type: "player_dead", playerId: player.id, x: player.x, y: player.y });
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
    for (const enemy of spawnWave(this.state.wave)) this.state.ships[enemy.id] = enemy;
    broadcast(this.ctx.getWebSockets(), { type: "new_wave", wave: this.state.wave });
    this.persistence.markDirty();
  }

  private findTargetId(player: PlayerShip, weapon: WeaponKind): string | undefined {
    if (weapon !== "guided_missile" && weapon !== "torpedo") return undefined;
    let targetId: string | undefined;
    let bestScore = -Infinity;
    const rangeSq = weapon === "torpedo" ? 620 * 620 : 760 * 760;
    for (const [id, ship] of Object.entries(this.state.ships)) {
      if (ship.controller !== "ai" || !ship.alive) continue;
      const dSq = distSq(player, ship);
      if (dSq > rangeSq) continue;
      const sc = ship.hp * 2 + ship.armor - Math.sqrt(dSq) * 0.03;
      if (sc > bestScore) { bestScore = sc; targetId = id; }
    }
    return targetId;
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
