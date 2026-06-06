import type { GameState } from "../../core/state";
import type { Bullet, WeaponKind } from "../../core/combat/weaponStats";
import { EMP_DURATION_TICKS, WEAPON_STATS } from "../../core/combat/weaponStats";
import { isAngleInArc } from "../../core/combat/patterns";
import type { EnemyShip, PlayerShip, Ship } from "../../core/ships/shipTypes";
import { AI_STATS, SHIP_HEAT_LIMIT, collisionRadiusFor } from "../../core/ships/shipStats";
import { distSq, shortestAngleDelta } from "../../core/math";
import { applyShipDamage, applyWeaponRecoil, resolveShipCollision } from "../physics/playerSystem";
import { applyBulletSplash, generateEnemyBullets, makeBullet, spawnWave } from "../ai/enemySystem";

// 12. Tipado mejorado para incluir ownerController
interface PendingShot {
  ownerId: string;
  ownerController: "player" | "ai";
  weapon: WeaponKind;
  angle: number;
  targetId?: string;
  fireTick: number;
}

// 13. Anti-patrón resuelto con unión discriminada para los eventos emitidos
export type GameEvent =
  | { type: "weapon_charge"; ownerId: string; weapon: WeaponKind; x: number; y: number; angle: number; ticks: number; color: string }
  | { type: "shockwave"; x: number; y: number; weapon: WeaponKind }
  | { type: "shield_hit"; playerId: string; reason: "impact" | "weapon" }
  | { type: "player_dead"; playerId: string; x: number; y: number }
  | { type: "explosion"; x: number; y: number; kind: string; shipClass?: string }
  | { type: "new_wave"; wave: number }
  | { type: "emp_hit"; playerId: string; x: number; y: number }
  | { type: "hit"; x: number; y: number; weapon: WeaponKind }
  | { type: "splash"; x: number; y: number; radius: number; weapon: WeaponKind };

type Broadcast = (payload: GameEvent) => void;

export class CombatSystem {
  // 9. Constantes claras para distancias en lugar de números mágicos
  private static readonly GUIDED_MISSILE_MAX_DIST_SQ = 577600; // 760^2
  private static readonly TORPEDO_MAX_DIST_SQ = 384400;      // 620^2

  private pendingShots: PendingShot[] = [];

  constructor(
    private readonly getState: () => GameState,
    private readonly broadcast: Broadcast,
    private readonly markDirty: () => void,
  ) { }

  discardPendingShotsFor(ownerId: string): void {
    this.pendingShots = this.pendingShots.filter(s => s.ownerId !== ownerId);
  }

  tryFireWeapon(player: PlayerShip): void {
    if (player.shootCooldown > 0 || player.weaponHeat >= SHIP_HEAT_LIMIT || player.empTicks > 0) return;

    const weapon = player.weapon;
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    const targetId = this.findTargetId(player, weapon);
    const state = this.getState();
    if (targetId && !isAngleInArc(player.angle, Math.atan2(state.ships[targetId].y - player.y, state.ships[targetId].x - player.x), stats.arc)) {
      // Preserve existing behavior
    }

    player.shootCooldown = stats.cooldown;
    player.weaponHeat = Math.min(SHIP_HEAT_LIMIT + 40, player.weaponHeat + stats.heat);
    applyWeaponRecoil(player, player.angle, stats.recoil);

    if (stats.chargeTicks > 0) {
      this.queueShot(player.id, "player", weapon, player.angle, stats.chargeTicks, targetId);
    } else {
      this.spawnWeaponBullets(player.id, "player", player.x, player.y, player.angle, weapon, targetId);
    }
    this.markDirty();
  }

  fireEnemyWeapon(enemy: EnemyShip, target: PlayerShip): void {
    // 3. Fallback seguro por si no existe preferredWeapon en las stats
    const weapon = AI_STATS[enemy.kind]?.preferredWeapon ?? "basic";
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    const angle = Math.atan2(target.y + target.vy * 20 - enemy.y, target.x + target.vx * 20 - enemy.x);

    if (stats.chargeTicks > 0) {
      enemy.weapon = weapon;
      enemy.shootCooldown = Math.round(stats.cooldown * AI_STATS[enemy.kind].shootRateMul);
      enemy.weaponHeat = Math.min(130, enemy.weaponHeat + stats.heat);
      this.queueShot(enemy.id, "ai", weapon, angle, stats.chargeTicks, target.id);
    } else {
      const state = this.getState();
      const bullets = generateEnemyBullets(enemy, target);
      for (const b of bullets) state.bullets[b.id] = b;
    }
    // Nota (Puntos 2 y 7): La reducción de cooldowns y empTicks debe procesarse en el sistema de Ticks principal iterando las entidades.
  }

  resolvePendingShots(): void {
    const state = this.getState();
    const ready = this.pendingShots.filter(s => s.fireTick <= state.tick);
    this.pendingShots = this.pendingShots.filter(s => s.fireTick > state.tick);

    for (const shot of ready) {
      const owner = state.ships[shot.ownerId];
      if (!owner || !owner.alive) continue;
      this.spawnWeaponBullets(shot.ownerId, shot.ownerController, owner.x, owner.y, shot.angle, shot.weapon, shot.targetId);
    }
  }

  updateBullets(alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    const state = this.getState();

    for (const [bid, bullet] of Object.entries(state.bullets)) {
      if ((bullet.kind === "guided_missile" || bullet.kind === "torpedo") && bullet.targetId) {
        const target = state.ships[bullet.targetId];
        // 5. Los misiles guiados pierden el track y siguen recto si el objetivo muere
        if (target && target.alive) {
          if (bullet.turnRate) {
            const desiredAngle = Math.atan2(target.y - bullet.y, target.x - bullet.x);
            bullet.angle += shortestAngleDelta(bullet.angle, desiredAngle) * bullet.turnRate;
            bullet.vx = Math.cos(bullet.angle) * WEAPON_STATS[bullet.kind].speed;
            bullet.vy = Math.sin(bullet.angle) * WEAPON_STATS[bullet.kind].speed;
          }
        } else {
          bullet.turnRate = 0;
          bullet.targetId = undefined;
        }
      }

      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life--;

      if (bullet.detonateAtLife !== undefined && bullet.life <= bullet.detonateAtLife) {
        this.detonateBullet(bid, bullet, alivePlayers, aliveEnemies);
        continue;
      }

      if (bullet.life <= 0) {
        delete state.bullets[bid];
        continue;
      }

      if (bullet.ownerController === "player") {
        this.resolvePlayerBulletHits(bid, bullet, aliveEnemies, alivePlayers);
      } else {
        this.resolveEnemyBulletHits(bid, bullet, alivePlayers);
      }
    }
  }

  resolveCollisions(alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    const state = this.getState();
    for (const enemy of aliveEnemies) {
      for (const player of alivePlayers) {
        // 8. Omitimos a los espectadores (ya no actúan de muros invisibles)
        if (player.team === "spectator") continue;

        // 1. Colisiones con daño simétrico evaluando bHurt
        const { aHurt, bHurt } = resolveShipCollision(player, enemy);

        if (aHurt) {
          const result = applyShipDamage(player, 1, true);
          if (result.shieldHit) {
            this.broadcast({ type: "shield_hit", playerId: player.id, reason: "impact" });
          }
          if (result.dead) {
            this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
            this.markDirty();
          }
        }

        if (bHurt) {
          const result = applyShipDamage(enemy, 1, true);
          if (result.dead) {
            enemy.alive = false; // Flag crucial para romper colisiones fantasma en la misma iteración
            delete state.ships[enemy.id];
            this.broadcast({ type: "explosion", x: enemy.x, y: enemy.y, kind: enemy.kind, shipClass: enemy.shipClass });
            this.markDirty();
            break; // Pasamos al siguiente enemigo para no dañar a más jugadores si ya explotó
          }
        }
      }
    }
  }

  resolveWaveCompletion(alivePlayers: PlayerShip[]): void {
    const state = this.getState();
    const remainingEnemies = this.getEnemyShips().filter(e => e.alive);
    if (remainingEnemies.length > 0 || alivePlayers.length === 0) return;

    state.wave++;

    // 14. Revivir a todos los jugadores aliados que cayeron en la wave (spectators omitidos)
    const allPlayers = this.getPlayerShips();
    for (const player of allPlayers) {
      if (player.team === "spectator") continue;

      if (!player.alive) {
        player.alive = true;
      }

      player.shield = player.shieldMax;
      player.armor = player.armorMax;
      player.shieldRegenDelay = 0;
      player.hp = player.maxHp;
      player.boostEnergy = 100;
      player.weaponHeat = Math.max(0, player.weaponHeat - 35);
      player.iFrames = 60;
    }

    for (const enemy of spawnWave(state.wave)) {
      state.ships[enemy.id] = enemy;
    }

    this.broadcast({ type: "new_wave", wave: state.wave });
    this.markDirty();
  }

  private queueShot(ownerId: string, ownerController: "player" | "ai", weapon: WeaponKind, angle: number, delay: number, targetId?: string): void {
    const state = this.getState();
    const owner = state.ships[ownerId];
    if (!owner) return;

    this.pendingShots.push({ ownerId, ownerController, weapon, angle, targetId, fireTick: state.tick + delay });
    this.broadcast({
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

  private spawnWeaponBullets(
    ownerId: string,
    ownerController: "player" | "ai",
    x: number,
    y: number,
    angle: number,
    weapon: WeaponKind,
    targetId?: string,
  ): void {
    const state = this.getState();
    const stats = WEAPON_STATS[weapon];
    const originX = x + Math.cos(angle) * stats.muzzleOffset;
    const originY = y + Math.sin(angle) * stats.muzzleOffset;

    for (const off of stats.fireOffsets) {
      const bullet = makeBullet(ownerId, ownerController, originX, originY, angle + off, weapon, targetId);
      state.bullets[bullet.id] = bullet;
    }
    this.broadcast({ type: "shockwave", x: originX, y: originY, weapon });
  }

  private resolvePlayerBulletHits(bid: string, bullet: Bullet, aliveEnemies: EnemyShip[], alivePlayers: PlayerShip[]): void {
    const state = this.getState();
    const owner = state.ships[bullet.ownerId] as PlayerShip | undefined;

    for (const enemy of aliveEnemies) {
      // 16. Dinámica precisa para hitboxes (se elimina el hardcode _SQ)
      const hitRadius = collisionRadiusFor(enemy) + bullet.radius;
      if (distSq(bullet, enemy) >= hitRadius * hitRadius) continue;

      this.applyHitToShip(enemy, bullet, owner, bid, aliveEnemies, alivePlayers);
      return;
    }

    if (owner && owner.team !== "spectator") {
      for (const player of alivePlayers) {
        if (player.team === owner.team || player.team === "spectator" || player.id === owner.id) continue;

        const hitRadius = collisionRadiusFor(player) + bullet.radius;
        if (distSq(bullet, player) >= hitRadius * hitRadius) continue;

        this.applyHitToShip(player, bullet, owner, bid, aliveEnemies, alivePlayers);
        return;
      }
    }
  }

  private resolveEnemyBulletHits(bid: string, bullet: Bullet, alivePlayers: PlayerShip[]): void {
    for (const player of alivePlayers) {
      if (player.team === "spectator") continue;

      const hitRadius = collisionRadiusFor(player) + bullet.radius;
      if (distSq(bullet, player) >= hitRadius * hitRadius) continue;

      this.applyHitToShip(player, bullet, undefined, bid, [], alivePlayers);
      return;
    }
  }

  private applyHitToShip(target: Ship, bullet: Bullet, owner: PlayerShip | undefined, bid: string, aliveEnemies: EnemyShip[], alivePlayers: PlayerShip[]): void {
    const state = this.getState();
    delete state.bullets[bid];

    if (bullet.statusEffect === "emp") {
      target.empTicks = Math.max(target.empTicks || 0, EMP_DURATION_TICKS);
      if (target.controller === "player") {
        this.broadcast({ type: "emp_hit", playerId: target.id, x: target.x, y: target.y });
      }
    }

    const result = applyShipDamage(target, bullet.damage, false, bullet.kind === "railgun");

    if (target.controller === "ai") {
      this.handleSplash(bullet, aliveEnemies, target.id, owner);
    } else if (bullet.splashRadius > 0 && target.controller === "player") {
      this.handlePvPSplash(bullet, alivePlayers, target.id, owner); // 4. Evitamos redescubrir "alivePlayers" internamente
      this.handleSplash(bullet, aliveEnemies, undefined, owner);
    }

    if (result.dead) {
      delete state.ships[target.id];
      if (owner) {
        owner.score += target.controller === "ai" ? this.getEnemyScore(target as EnemyShip) : 100;
      }

      if (target.controller === "player") {
        this.broadcast({ type: "player_dead", playerId: target.id, x: target.x, y: target.y });
      } else {
        this.broadcast({ type: "explosion", x: target.x, y: target.y, kind: target.kind, shipClass: (target as EnemyShip).shipClass });
      }
      this.markDirty();
    } else {
      if (result.shieldHit && target.controller === "player") {
        this.broadcast({ type: "shield_hit", playerId: target.id, reason: "weapon" });
      } else {
        this.broadcast({ type: "hit", x: target.x, y: target.y, weapon: bullet.kind });
      }
    }
  }

  private detonateBullet(bid: string, bullet: Bullet, alivePlayers: PlayerShip[], aliveEnemies: EnemyShip[]): void {
    const state = this.getState();
    delete state.bullets[bid];
    this.broadcast({ type: "shockwave", x: bullet.x, y: bullet.y, weapon: bullet.kind });

    // 6. Fórmula splashDmg consistente para toda explosión
    const splashDmg = Math.max(1, Math.round(bullet.damage * 0.7));
    const isRailgun = bullet.kind === "railgun";

    if (bullet.ownerController === "player") {
      const owner = state.ships[bullet.ownerId] as PlayerShip | undefined;
      this.handleSplash(bullet, aliveEnemies, undefined, owner);
      this.handlePvPSplash(bullet, alivePlayers, undefined, owner);
    } else {
      for (const player of alivePlayers) {
        if (player.team === "spectator") continue;
        if (distSq(bullet, player) <= bullet.splashRadius * bullet.splashRadius) {
          // 10. `ignoreArmor` pasado también en el daño del enemigo
          const result = applyShipDamage(player, splashDmg, false, isRailgun);
          if (result.dead) {
            this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
            delete state.ships[player.id];
          }
        }
      }
    }
  }

  private handleSplash(bullet: Bullet, aliveEnemies: EnemyShip[], excludedEnemyId?: string, owner?: PlayerShip): void {
    if (bullet.splashRadius <= 0) return;
    const state = this.getState();
    const kills = applyBulletSplash(bullet.ownerId, bullet.x, bullet.y, bullet.damage, bullet.splashRadius, aliveEnemies, excludedEnemyId);

    for (const k of kills) {
      // 11. Evitamos doble eliminación ineficiente si applyBulletSplash ya los procesó
      if (state.ships[k.enemyId]) delete state.ships[k.enemyId];
      if (owner) owner.score += k.score;
      this.broadcast({ type: "explosion", x: k.x, y: k.y, kind: k.kind });
    }
    this.broadcast({ type: "splash", x: bullet.x, y: bullet.y, radius: bullet.splashRadius, weapon: bullet.kind });
  }

  private handlePvPSplash(bullet: Bullet, alivePlayers: PlayerShip[], excludedPlayerId?: string, owner?: PlayerShip): void {
    if (bullet.splashRadius <= 0 || !owner) return;

    const splashDmg = Math.max(1, Math.round(bullet.damage * 0.7));
    const isRailgun = bullet.kind === "railgun";
    const state = this.getState();

    for (const player of alivePlayers) {
      if (player.id === excludedPlayerId || player.team === owner.team || player.team === "spectator") continue;
      if (distSq(bullet, player) <= bullet.splashRadius * bullet.splashRadius) {
        // 10. El daño de salpicadura respeta isRailgun de manera consistente
        const result = applyShipDamage(player, splashDmg, false, isRailgun);
        if (result.dead) {
          owner.score += 100;
          this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
          delete state.ships[player.id];
        }
      }
    }
  }

  private findTargetId(player: PlayerShip, weapon: WeaponKind): string | undefined {
    if (weapon !== "guided_missile" && weapon !== "torpedo") return undefined;

    const state = this.getState();
    let targetId: string | undefined;

    // 9. Uso de variables semánticas en lugar de distancias mágicas
    let closestDSq = weapon === "torpedo"
      ? CombatSystem.TORPEDO_MAX_DIST_SQ
      : CombatSystem.GUIDED_MISSILE_MAX_DIST_SQ;

    for (const [id, ship] of Object.entries(state.ships)) {
      if (!ship.alive || id === player.id) continue;
      if (ship.controller === "player" && (ship.team === player.team || ship.team === "spectator")) continue;

      const dSq = distSq(player, ship);
      if (dSq < closestDSq) {
        closestDSq = dSq;
        targetId = id;
      }
    }
    return targetId;
  }

  private getPlayerShips(): PlayerShip[] {
    return Object.values(this.getState().ships).filter((s): s is PlayerShip => s.controller === "player");
  }

  private getEnemyShips(): EnemyShip[] {
    return Object.values(this.getState().ships).filter((s): s is EnemyShip => s.controller === "ai");
  }

  private getEnemyScore(enemy: EnemyShip): number {
    return AI_STATS[enemy.kind]?.score ?? 0;
  }
}