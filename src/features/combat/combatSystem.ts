import type { GameState } from "../../core/state";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { EMP_DURATION_TICKS, WEAPON_STATS } from "../../core/combat/weaponStats";
import { createProjectile, type Projectile } from "../../core/combat/projectiles";
import { isAngleInArc } from "../../core/combat/patterns";
import type { EnemyShip, PlayerShip, Ship } from "../../core/ships/shipTypes";
import { AI_STATS, SHIP_HEAT_LIMIT } from "../../core/ships/shipStats";
import { distSq } from "../../core/math";
import { applyShipDamage, applyWeaponRecoil, resolveShipCollision } from "../physics/playerSystem";
import { applyBulletSplash, generateEnemyBullets, spawnWave } from "../ai/enemySystem";

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
  | { type: "shockwave"; x: number; y: number; weapon: WeaponKind; ownerId: string }
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
    const target = targetId ? state.ships[targetId] : undefined;
    if (target && !isAngleInArc(player.angle, Math.atan2(target.y - player.y, target.x - player.x), stats.arc)) {
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
    // Fallback seguro: si no existe preferredWeapon, usamos naval_cannon (siempre definido)
    const weapon = AI_STATS[enemy.kind]?.preferredWeapon ?? "naval_cannon";
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    const angle = Math.atan2(target.y + target.vy * 20 - enemy.y, target.x + target.vx * 20 - enemy.x);

    // Aplicamos el cooldown siempre, cargada o no
    const cooldownTicks = Math.round(stats.cooldown * (AI_STATS[enemy.kind]?.shootRateMul ?? 1));
    enemy.shootCooldown = cooldownTicks;
    enemy.weaponHeat = Math.min(130, enemy.weaponHeat + stats.heat);
    enemy.weapon = weapon;

    if (stats.chargeTicks > 0) {
      this.queueShot(enemy.id, "ai", weapon, angle, stats.chargeTicks, target.id);
    } else {
      const state = this.getState();
      const projectiles = generateEnemyBullets(enemy, target);
      for (const p of projectiles) state.projectiles[p.id] = p;
    }
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
    const allAlive: Record<string, Ship> = {};
    for (const p of alivePlayers) allAlive[p.id] = p;
    for (const e of aliveEnemies) allAlive[e.id] = e;

    for (const [pid, projectile] of Object.entries(state.projectiles)) {
      if (!projectile.alive) { delete state.projectiles[pid]; continue; }

      const result = projectile.tick(state.ships);

      if (!projectile.alive) delete state.projectiles[pid];

      for (const hit of result.hits) {
        this.processHit(hit, projectile, pid, state);
      }

      for (const explosion of result.explosions) {
        this.broadcast({ type: "explosion", x: explosion.x, y: explosion.y, kind: explosion.kind });
      }
    }
  }

  private processHit(hit: { targetId: string; damage: number; armorPierce: boolean; statusEffect?: string; splashRadius: number; splashDamage: number; x: number; y: number; kind: WeaponKind; ownerId: string }, projectile: Projectile, pid: string, state: GameState): void {
    const target = state.ships[hit.targetId];
    if (!target || !target.alive) return;

    if (hit.statusEffect === "emp") {
      target.empTicks = Math.max(target.empTicks || 0, EMP_DURATION_TICKS);
      if (target.controller === "player") {
        this.broadcast({ type: "emp_hit", playerId: target.id, x: target.x, y: target.y });
      }
    }

    const result = applyShipDamage(target, hit.damage, false, hit.armorPierce);

    const owner = state.ships[projectile.ownerId] as PlayerShip | undefined;

    if (target.controller === "ai") {
      this.applySplashToEnemies(hit, state, target.id, owner);
    } else if (hit.splashRadius > 0 && target.controller === "player") {
      this.applySplashToPlayers(hit, state, target.id, owner);
      this.applySplashToEnemies(hit, state, undefined, owner);
    }

    if (result.dead) {
      delete state.ships[target.id];
      if (owner) {
        owner.score += target.controller === "ai" ? AI_STATS[(target as EnemyShip).kind]?.score ?? 0 : 100;
      }
      if (target.controller === "player") {
        this.broadcast({ type: "player_dead", playerId: target.id, x: target.x, y: target.y });
      } else {
        this.broadcast({ type: "explosion", x: target.x, y: target.y, kind: (target as EnemyShip).kind, shipClass: target.shipClass });
      }
      this.markDirty();
    } else {
      if (result.shieldHit && target.controller === "player") {
        this.broadcast({ type: "shield_hit", playerId: target.id, reason: "weapon" });
      } else {
        this.broadcast({ type: "hit", x: target.x, y: target.y, weapon: hit.kind });
      }
    }
  }

  private applySplashToEnemies(hit: { splashRadius: number; splashDamage: number; x: number; y: number; ownerId: string }, state: GameState, excludedEnemyId?: string, owner?: PlayerShip): void {
    if (hit.splashRadius <= 0) return;
    const aliveEnemies = Object.values(state.ships).filter((s): s is EnemyShip => s.controller === "ai" && s.alive);
    const kills = applyBulletSplash(hit.ownerId, hit.x, hit.y, hit.splashDamage, hit.splashRadius, aliveEnemies, excludedEnemyId);
    for (const k of kills) {
      if (state.ships[k.enemyId]) delete state.ships[k.enemyId];
      if (owner) owner.score += k.score;
      this.broadcast({ type: "explosion", x: k.x, y: k.y, kind: k.kind });
    }
    this.broadcast({ type: "splash", x: hit.x, y: hit.y, radius: hit.splashRadius, weapon: "energy_bomb" });
  }

  private applySplashToPlayers(hit: { splashRadius: number; splashDamage: number; x: number; y: number }, state: GameState, excludedPlayerId?: string, owner?: PlayerShip): void {
    if (hit.splashRadius <= 0 || !owner) return;
    for (const player of Object.values(state.ships)) {
      if (player.controller !== "player" || !player.alive) continue;
      if (player.id === excludedPlayerId || player.team === owner.team || player.team === "spectator") continue;
      if (distSq(hit, player) <= hit.splashRadius * hit.splashRadius) {
        const result = applyShipDamage(player, hit.splashDamage, false, false);
        if (result.dead) {
          owner.score += 100;
          this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
          delete state.ships[player.id];
        }
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
      const projectile = createProjectile(ownerId, ownerController, originX, originY, angle + off, weapon, targetId);
      state.projectiles[projectile.id] = projectile;
    }
    this.broadcast({ type: "shockwave", x: originX, y: originY, weapon, ownerId });
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
}