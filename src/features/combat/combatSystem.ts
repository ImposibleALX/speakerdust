import type { GameState } from "../../core/state";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { EMP_DURATION_TICKS, WEAPON_STATS } from "../../core/combat/weaponStats";
import { createProjectile, type Projectile } from "../../core/combat/projectiles";
import { isAngleInArc } from "../../core/combat/patterns";
import type { Ship, AiState, TurretMount } from "../../core/ships/shipTypes";
import { SHIP_CLASSES } from "@speakerdust/shared";
import { SHIP_HEAT_LIMIT } from "../../core/ships/shipStats";
import { distSq, shortestAngleDelta } from "../../core/math";

import { dealSplashDamage, predictLeadAngle, spawnWave } from "../ai/enemySystem";

const PIXEL_SCALE = 3;
const PDC_RANGE = 200;
const PDC_MAX_DIST_SQ = PDC_RANGE * PDC_RANGE;

function mountWorldPos(ship: Ship, mount: TurretMount): { x: number; y: number } {
  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  return {
    x: ship.x + (cos * mount.x - sin * mount.y) * PIXEL_SCALE,
    y: ship.y + (sin * mount.x + cos * mount.y) * PIXEL_SCALE,
  };
}

interface PendingShot {
  ownerId: string;
  ownerController: "player" | "ai";
  weapon: WeaponKind;
  angle: number;
  /** Visual origin for the charge telegraph */
  originX: number;
  originY: number;
  targetId?: string;
  fireTick: number;
}

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
  private static readonly GUIDED_MISSILE_MAX_DIST_SQ = 577600;
  private static readonly TORPEDO_MAX_DIST_SQ = 384400;

  private pendingShots: PendingShot[] = [];

  constructor(
    private readonly getState: () => GameState,
    private readonly broadcast: Broadcast,
    private readonly markDirty: () => void,
  ) { }

  removePendingShotsFor(ownerId: string): void {
    this.pendingShots = this.pendingShots.filter(s => s.ownerId !== ownerId);
  }

  tryFireWeapon(ship: Ship): void {
    if (ship.empTicks > 0) return;

    const weapon = ship.weapon;
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    const targetId = this.findTargetId(ship, weapon);

    let fired = false;
    for (const mount of ship.turretMounts) {
      if (mount.weaponKind !== weapon || !mount.enabled) continue;
      if (mount.cooldown > 0 || mount.heat >= SHIP_HEAT_LIMIT) continue;

      const pos = mountWorldPos(ship, mount);
      const shootAngle = mount.angle;

      mount.cooldown = stats.cooldown;
      mount.heat = Math.min(SHIP_HEAT_LIMIT + 40, mount.heat + stats.heat);

      if (stats.chargeTicks > 0) {
        this.queueShot(ship.id, ship.controller, weapon, shootAngle, stats.chargeTicks, targetId, pos.x, pos.y);
      } else {
        this.spawnWeaponBullets(ship.id, ship.controller, pos.x, pos.y, shootAngle, weapon, targetId);
      }
      fired = true;
    }

    if (fired) this.markDirty();
  }

  fireEnemyWeapon(enemy: Ship, target: Ship): void {
    for (const mount of enemy.turretMounts) {
      if (!mount.enabled || mount.weaponKind === "point_defense") continue;
      if (mount.cooldown > 0 || mount.heat >= SHIP_HEAT_LIMIT) continue;

      const stats = WEAPON_STATS[mount.weaponKind];
      if (!stats) continue;

      const targetAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
      if (!isAngleInArc(enemy.angle, targetAngle, mount.mountArc)) continue;

      const lead = mount.weaponKind === "railgun" ? 30 : 18;
      const angle = predictLeadAngle(enemy.x, enemy.y, target, lead);

      mount.targetAngle = angle;
      const pos = mountWorldPos(enemy, mount);

      mount.cooldown = stats.cooldown;
      mount.heat = Math.min(SHIP_HEAT_LIMIT + 40, mount.heat + stats.heat);

      if (stats.chargeTicks > 0) {
        this.queueShot(enemy.id, "ai", mount.weaponKind, angle, stats.chargeTicks, target.id, pos.x, pos.y);
      } else {
        this.spawnWeaponBullets(enemy.id, "ai", pos.x, pos.y, angle, mount.weaponKind, target.id);
      }
    }
  }

  resolvePendingShots(): void {
    const state = this.getState();
    const ready = this.pendingShots.filter(s => s.fireTick <= state.tick);
    this.pendingShots = this.pendingShots.filter(s => s.fireTick > state.tick);

    for (const shot of ready) {
      const owner = state.ships[shot.ownerId];
      if (!owner || !owner.alive) continue;
      this.spawnWeaponBullets(shot.ownerId, shot.ownerController, shot.originX, shot.originY, shot.angle, shot.weapon, shot.targetId);
    }
  }

  tickProjectiles(aliveShips: Ship[]): void {
    const state = this.getState();
    const allAlive: Record<string, Ship> = {};
    for (const s of aliveShips) allAlive[s.id] = s;

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

    this.tickPDC(state, allAlive);
  }

  private tickPDC(state: GameState, allAlive: Record<string, Ship>): void {
    const enemyProjectiles = Object.values(state.projectiles).filter(p => {
      const owner = state.ships[p.ownerId];
      return p.alive && owner?.controller === "ai";
    });
    if (enemyProjectiles.length === 0) return;

    const pdcStats = WEAPON_STATS.point_defense;
    if (!pdcStats) return;

    for (const ship of Object.values(allAlive)) {
      for (const mount of ship.turretMounts) {
        if (mount.weaponKind !== "point_defense" || !mount.enabled) continue;
        if (mount.cooldown > 0 || mount.heat >= SHIP_HEAT_LIMIT) continue;

        let closestProj: Projectile | null = null;
        let closestDSq = PDC_MAX_DIST_SQ;

        for (const proj of enemyProjectiles) {
          if (proj.ownerId === ship.id) continue;
          const dSq = distSq(ship, proj);
          if (dSq < closestDSq) {
            closestDSq = dSq;
            closestProj = proj;
          }
        }

        if (!closestProj) continue;

        const targetAngle = Math.atan2(closestProj.y - ship.y, closestProj.x - ship.x);
        if (!isAngleInArc(ship.angle, targetAngle, mount.mountArc)) continue;

        mount.targetAngle = targetAngle;
        const pos = mountWorldPos(ship, mount);
        mount.cooldown = pdcStats.cooldown;
        mount.heat = Math.min(SHIP_HEAT_LIMIT + 40, mount.heat + pdcStats.heat);

        this.spawnWeaponBullets(ship.id, ship.controller, pos.x, pos.y, targetAngle, "point_defense");
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

    const result = target.takeDamage(hit.damage, false, hit.armorPierce);

    const owner = state.ships[projectile.ownerId] as Ship | undefined;

    if (target.controller === "ai") {
      this.applySplashToEnemies(hit, state, target.id, owner);
    } else if (hit.splashRadius > 0 && target.controller === "player") {
      this.applySplashToPlayers(hit, state, target.id, owner);
      this.applySplashToEnemies(hit, state, undefined, owner);
    }

    if (result.dead) {
      if (target.controller === "ai") {
        delete state.ships[target.id];
      }
      if (owner) {
        owner.score += target.controller === "ai" ? (SHIP_CLASSES[target.shipClass] ?? SHIP_CLASSES.corvette!).stats.score : 100;
      }
      if (target.controller === "player") {
        this.broadcast({ type: "player_dead", playerId: target.id, x: target.x, y: target.y });
      } else {
        this.broadcast({ type: "explosion", x: target.x, y: target.y, kind: target.shipClass, shipClass: target.shipClass });
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

  private applySplashToEnemies(hit: { splashRadius: number; splashDamage: number; x: number; y: number; ownerId: string }, state: GameState, excludedEnemyId?: string, owner?: Ship): void {
    if (hit.splashRadius <= 0) return;
    const aliveEnemies = Object.values(state.ships).filter(s => s.controller === "ai" && s.alive);
    const kills = dealSplashDamage(hit.ownerId, hit.x, hit.y, hit.splashDamage, hit.splashRadius, aliveEnemies, excludedEnemyId);
    for (const k of kills) {
      if (state.ships[k.enemyId]) delete state.ships[k.enemyId];
      if (owner) owner.score += k.score;
      this.broadcast({ type: "explosion", x: k.x, y: k.y, kind: k.shipClass });
    }
    this.broadcast({ type: "splash", x: hit.x, y: hit.y, radius: hit.splashRadius, weapon: "energy_bomb" });
  }

  private applySplashToPlayers(hit: { splashRadius: number; splashDamage: number; x: number; y: number }, state: GameState, excludedPlayerId?: string, owner?: Ship): void {
    if (hit.splashRadius <= 0 || !owner) return;
    for (const player of Object.values(state.ships)) {
      if (player.controller !== "player" || !player.alive) continue;
      if (player.id === excludedPlayerId || player.getTeam() === owner.getTeam() || player.getTeam() === "spectator") continue;
      if (distSq(hit, player) <= hit.splashRadius * hit.splashRadius) {
        const result = player.takeDamage(hit.splashDamage, false, false);
        if (result.dead) {
          if (owner && owner.getTeam() !== player.getTeam() && owner.getTeam() !== "spectator") owner.score += 100;
          this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
        }
      }
    }
  }

  resolveCollisions(aliveShips: Ship[]): void {
    const state = this.getState();
    const players = aliveShips.filter(s => s.controller === "player");
    const enemies = aliveShips.filter(s => s.controller === "ai");
    for (const enemy of enemies) {
      for (const player of players) {
        if (player.getTeam() === "spectator") continue;

        const { aHurt, bHurt } = player.handleCollision(enemy);

        if (aHurt) {
          const result = player.takeDamage(1, true);
          if (result.shieldHit) {
            this.broadcast({ type: "shield_hit", playerId: player.id, reason: "impact" });
          }
          if (result.dead) {
            this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
            this.markDirty();
          }
        }

        if (bHurt) {
          const result = enemy.takeDamage(1, true);
          if (result.dead) {
            enemy.alive = false;
            delete state.ships[enemy.id];
            this.broadcast({ type: "explosion", x: enemy.x, y: enemy.y, kind: enemy.shipClass, shipClass: enemy.shipClass });
            this.markDirty();
            break;
          }
        }
      }
    }
  }

  checkAndAdvanceWave(alivePlayers: Ship[]): Array<{ ship: Ship; ai: AiState }> {
    const state = this.getState();
    const remainingEnemies = Object.values(state.ships).filter(s => s.controller === "ai" && s.alive);
    if (remainingEnemies.length > 0 || alivePlayers.length === 0) return [];

    state.wave++;

    const allPlayers = Object.values(state.ships).filter(s => s.controller === "player");
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
      for (const m of player.turretMounts) m.heat = Math.max(0, m.heat - 35);
      player.iFrames = 60;
    }

    const spawned = spawnWave(state.wave);
    for (const { ship } of spawned) {
      state.ships[ship.id] = ship;
    }

    this.broadcast({ type: "new_wave", wave: state.wave });
    this.markDirty();

    return spawned;
  }

  private queueShot(ownerId: string, ownerController: "player" | "ai", weapon: WeaponKind, angle: number, delay: number, targetId?: string, originX?: number, originY?: number): void {
    const state = this.getState();
    const owner = state.ships[ownerId];
    if (!owner) return;

    const ox = originX ?? owner.x;
    const oy = originY ?? owner.y;
    this.pendingShots.push({ ownerId, ownerController, weapon, angle, targetId, fireTick: state.tick + delay, originX: ox, originY: oy });
    this.broadcast({
      type: "weapon_charge",
      ownerId,
      weapon,
      x: ox,
      y: oy,
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
    const currentTick = state.tick;

    for (const off of stats.fireOffsets) {
      const projectile = createProjectile(ownerId, ownerController, x, y, angle + off, weapon, targetId, currentTick);
      state.projectiles[projectile.id] = projectile;
    }
    this.broadcast({ type: "shockwave", x, y, weapon, ownerId });
  }

  private findTargetId(ship: Ship, weapon: WeaponKind): string | undefined {
    if (weapon !== "guided_missile" && weapon !== "torpedo") return undefined;

    const state = this.getState();
    let targetId: string | undefined;

    let closestDSq = weapon === "torpedo"
      ? CombatSystem.TORPEDO_MAX_DIST_SQ
      : CombatSystem.GUIDED_MISSILE_MAX_DIST_SQ;

    for (const [id, other] of Object.entries(state.ships)) {
      if (!other.alive || id === ship.id) continue;
      if (other.controller === "player" && (other.getTeam() === ship.getTeam() || other.getTeam() === "spectator")) continue;

      const dSq = distSq(ship, other);
      if (dSq < closestDSq) {
        closestDSq = dSq;
        targetId = id;
      }
    }
    return targetId;
  }
}
