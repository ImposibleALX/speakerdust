import type { GameState } from "../../core/state";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { EMP_DURATION_TICKS, WEAPON_STATS } from "../../core/combat/weaponStats";
import { createProjectile, checkProjectileCollision, type Projectile } from "../../core/combat/projectiles";
import { releaseProjectile } from "../../core/combat/projectiles";
import type { Ship, AiState } from "../../core/ships/shipTypes";
import { Turret } from "../../core/combat/Turret";
import { SHIP_CLASSES } from "@speakerdust/shared";
import { distSq, shortestAngleDelta } from "../../core/math";
import { dealSplashDamage, predictLeadAngle, spawnWave } from "../ai/enemySystem";

const PIXEL_SCALE = 3;
const PDC_RANGE = 200;
const PDC_MAX_DIST_SQ = PDC_RANGE * PDC_RANGE;

function mountWorldPos(ship: Ship, mount: Turret): { x: number; y: number } {
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
  | { type: "hit"; x: number; y: number; weapon: WeaponKind; damage?: number }
  | { type: "splash"; x: number; y: number; radius: number; weapon: WeaponKind; damage?: number };

type Broadcast = (payload: GameEvent) => void;

export class CombatSystem {
  private static readonly GUIDED_MISSILE_MAX_DIST_SQ = 700000;
  private static readonly TORPEDO_MAX_DIST_SQ = 415000;

  private pendingShots: PendingShot[] = [];
  private interceptBuffer: Projectile[] = [];

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
    if (ship.controller === "player" && ship.getTeam() === "spectator") return;

    const weapon = ship.weapon;
    const stats = WEAPON_STATS[weapon];
    if (!stats) return;

    const targetId = (weapon === "guided_missile" || weapon === "torpedo")
      ? this.findTargetId(ship, weapon)
      : undefined;

    let fired = false;
    for (const turret of ship.turrets) {
      if (turret.weaponKind !== weapon || !turret.canFire()) continue;

      const pos = mountWorldPos(ship, turret);
      const shootAngle = turret.angle;

      turret.fire();

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
    if (enemy.empTicks > 0) return;

    for (const turret of enemy.turrets) {
      if (turret.weaponKind === "point_defense" || !turret.canFire()) continue;

      const stats = WEAPON_STATS[turret.weaponKind];
      if (!stats) continue;

      const targetAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
      const relAngle = shortestAngleDelta(enemy.angle, targetAngle);
      if (relAngle < turret.minAngle || relAngle > turret.maxAngle) continue;

      const dist = Math.hypot(target.x - enemy.x, target.y - enemy.y);
      const lead = dist / stats.speed;
      const perfectLeadAngle = predictLeadAngle(enemy.x, enemy.y, target, lead);

      // SO: Turret alignment tolerance increased from 0.2 to 0.5 rad.
      // R: https://stackoverflow.com/questions/1731899/ai-turret-aiming-vs-body-rotation
      //    0.2 rad (~11°) was too tight: agile targets change lead angle faster
      //    than the turret turn rate, causing perpetual check failure → AI never fires.
      if (Math.abs(shortestAngleDelta(turret.angle, perfectLeadAngle)) > 0.5) continue;

      const shootAngle = turret.angle;
      const pos = mountWorldPos(enemy, turret);

      turret.fire();

      if (stats.chargeTicks > 0) {
        this.queueShot(enemy.id, "ai", turret.weaponKind, shootAngle, stats.chargeTicks, target.id, pos.x, pos.y);
      } else {
        this.spawnWeaponBullets(enemy.id, "ai", pos.x, pos.y, shootAngle, turret.weaponKind, target.id);
      }
    }
  }

  resolvePendingShots(): void {
    const state = this.getState();
    if (this.pendingShots.length === 0) return;

    const remainingShots: PendingShot[] = [];
    const currentTick = state.tick;

    for (const shot of this.pendingShots) {
      if (shot.fireTick <= currentTick) {
        const owner = state.ships[shot.ownerId];
        if (owner && owner.alive) {
          this.spawnWeaponBullets(shot.ownerId, shot.ownerController, shot.originX, shot.originY, shot.angle, shot.weapon, shot.targetId);
        }
      } else {
        remainingShots.push(shot);
      }
    }

    this.pendingShots = remainingShots;
  }

  tickProjectiles(aliveShips: Ship[]): void {
    const state = this.getState();

    for (const [pid, projectile] of Object.entries(state.projectiles)) {
      if (!projectile.alive) {
        releaseProjectile(projectile);
        delete state.projectiles[pid];
        continue;
      }

      const result = projectile.tick(state.ships);

      if (!projectile.alive) {
        releaseProjectile(projectile);
        delete state.projectiles[pid];
      }

      for (const hit of result.hits) {
        this.processHit(hit, projectile, pid, state);
      }

      for (const explosion of result.explosions) {
        this.broadcast({ type: "explosion", x: explosion.x, y: explosion.y, kind: explosion.kind });
      }
    }

    this.tickPDC(state, aliveShips);

    this.resolveProjectileCollisions(state);
  }

  private tickPDC(state: GameState, aliveShips: Ship[]): void {
    const pdcStats = WEAPON_STATS.point_defense;
    if (!pdcStats) return;

    const interceptableProjectiles = this.interceptBuffer;
    interceptableProjectiles.length = 0;
    for (const p of Object.values(state.projectiles)) {
      if (p.alive && p.interceptable) {
        interceptableProjectiles.push(p);
      }
    }

    if (interceptableProjectiles.length === 0) return;

    for (const ship of aliveShips) {
      if (ship.controller === "player" && ship.getTeam() === "spectator") continue;

      for (const turret of ship.turrets) {
        if (turret.weaponKind !== "point_defense" || !turret.canFire()) continue;

        let closestProj: Projectile | null = null;
        let closestDSq = PDC_MAX_DIST_SQ;

        for (const proj of interceptableProjectiles) {
          if (!proj.alive || proj.ownerId === ship.id) continue;

          const projOwner = state.ships[proj.ownerId];
          if (projOwner) {
            if (ship.controller === "player" && projOwner.controller === "player" && (ship.getTeam() === projOwner.getTeam() || projOwner.getTeam() === "spectator")) continue;
            if (ship.controller === "ai" && projOwner.controller === "ai") continue;
          }

          const dSq = distSq(ship, proj);
          if (dSq < closestDSq) {
            closestDSq = dSq;
            closestProj = proj;
          }
        }

        if (!closestProj) continue;

        const targetAngle = Math.atan2(closestProj.y - ship.y, closestProj.x - ship.x);
        const relAngle = shortestAngleDelta(ship.angle, targetAngle);
        if (relAngle < turret.minAngle || relAngle > turret.maxAngle) continue;

        turret.setIndependentTarget(targetAngle);
        const pos = mountWorldPos(ship, turret);

        turret.fire();

        this.spawnWeaponBullets(ship.id, ship.controller, pos.x, pos.y, targetAngle, "point_defense");
      }
    }
  }

  private resolveProjectileCollisions(state: GameState): void {
    const projs = Object.values(state.projectiles);
    const len = projs.length;
    for (let i = 0; i < len; i++) {
      const a = projs[i];
      if (!a || !a.alive) continue;
      for (let j = i + 1; j < len; j++) {
        const b = projs[j];
        if (!b || !b.alive || a.ownerId === b.ownerId) continue;
        if (checkProjectileCollision(a, b)) {
          a.takeDamage(1);
          b.takeDamage(1);
          if (!a.alive) {
            releaseProjectile(a);
            delete state.projectiles[a.id];
          }
          if (!b.alive) {
            releaseProjectile(b);
            delete state.projectiles[b.id];
          }
        }
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
    const owner = state.ships[projectile.ownerId];

    if (hit.splashRadius > 0) {
      this.applySplashToEnemies(hit, state, target.controller === "ai" ? target.id : undefined, owner);
      this.applySplashToPlayers(hit, state, target.controller === "player" ? target.id : undefined, owner);
      this.broadcast({ type: "splash", x: hit.x, y: hit.y, radius: hit.splashRadius, weapon: hit.kind, damage: hit.splashDamage });
    }

    if (result.dead) {
      if (target.controller === "ai") {
        delete state.ships[target.id];
      }

      if (owner) {
        const isFriendlyFire = target.controller === "player" && owner.controller === "player" && owner.getTeam() === target.getTeam();
        if (!isFriendlyFire) {
          const scoreValue = target.controller === "ai" && target.shipClass
            ? (SHIP_CLASSES[target.shipClass]?.stats.score ?? SHIP_CLASSES.corvette?.stats.score ?? 100)
            : 100;
          owner.score += scoreValue;
        }
      }

      if (target.controller === "player") {
        this.broadcast({ type: "player_dead", playerId: target.id, x: target.x, y: target.y });
      } else {
        this.broadcast({ type: "explosion", x: target.x, y: target.y, kind: target.shipClass || "unknown", shipClass: target.shipClass });
      }
      this.markDirty();
    } else {
      if (result.shieldHit && target.controller === "player") {
        this.broadcast({ type: "shield_hit", playerId: target.id, reason: "weapon" });
      } else {
        this.broadcast({ type: "hit", x: target.x, y: target.y, weapon: hit.kind, damage: hit.damage });
      }
    }
  }

  private applySplashToEnemies(hit: { splashRadius: number; splashDamage: number; x: number; y: number; ownerId: string }, state: GameState, excludedEnemyId?: string, owner?: Ship): void {
    if (hit.splashRadius <= 0) return;

    const aliveEnemies: Ship[] = [];
    for (const s of Object.values(state.ships)) {
      if (s.controller === "ai" && s.alive) aliveEnemies.push(s);
    }

    if (aliveEnemies.length === 0) return;

    const kills = dealSplashDamage(hit.ownerId, hit.x, hit.y, hit.splashDamage, hit.splashRadius, aliveEnemies, excludedEnemyId);

    for (const k of kills) {
      delete state.ships[k.enemyId];
      if (owner) owner.score += k.score;
      this.broadcast({ type: "explosion", x: k.x, y: k.y, kind: k.shipClass, shipClass: k.shipClass });
    }
  }

  private applySplashToPlayers(hit: { splashRadius: number; splashDamage: number; x: number; y: number }, state: GameState, excludedPlayerId?: string, owner?: Ship): void {
    if (hit.splashRadius <= 0) return;
    const splashSq = hit.splashRadius * hit.splashRadius;

    for (const player of Object.values(state.ships)) {
      if (player.controller !== "player" || !player.alive) continue;
      if (player.id === excludedPlayerId || player.getTeam() === "spectator") continue;
      if (owner && player.getTeam() === owner.getTeam()) continue;

      if (distSq(hit, player) <= splashSq) {
        const result = player.takeDamage(hit.splashDamage, false, false);
        if (result.dead) {
          if (owner && owner.getTeam() !== player.getTeam()) owner.score += 100;
          this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
        }
      }
    }
  }

  resolveCollisions(aliveShips: Ship[]): void {
    const state = this.getState();
    const players: Ship[] = [];
    const enemies: Ship[] = [];

    for (const s of aliveShips) {
      if (s.controller === "player" && s.getTeam() !== "spectator") players.push(s);
      else if (s.controller === "ai") enemies.push(s);
    }

    if (players.length === 0 || enemies.length === 0) return;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      for (const player of players) {
        if (!player.alive) continue;

        const { aHurt, bHurt, aDamage, bDamage } = player.handleCollision(enemy);

        if (aHurt) {
          const result = player.takeDamage(aDamage, true);
          if (result.shieldHit) {
            this.broadcast({ type: "shield_hit", playerId: player.id, reason: "impact" });
          }
          if (result.dead) {
            this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
            this.markDirty();
          }
        }

        if (bHurt) {
          const result = enemy.takeDamage(bDamage, true);
          if (result.dead) {
            enemy.alive = false;
            delete state.ships[enemy.id];
            this.broadcast({ type: "explosion", x: enemy.x, y: enemy.y, kind: enemy.shipClass || "unknown", shipClass: enemy.shipClass });
            this.markDirty();
            break;
          }
        }
      }
    }
  }

  checkAndAdvanceWave(alivePlayers: Ship[]): Array<{ ship: Ship; ai: AiState }> {
    const state = this.getState();

    let hasEnemies = false;
    for (const s of Object.values(state.ships)) {
      if (s.controller === "ai" && s.alive) {
        hasEnemies = true;
        break;
      }
    }

    if (hasEnemies || alivePlayers.length === 0) return [];

    state.wave++;

    for (const player of Object.values(state.ships)) {
      if (player.controller !== "player" || player.getTeam() === "spectator") continue;

      if (!player.alive) {
        player.alive = true;
      }

      player.shield = player.shieldMax;
      player.armor = player.armorMax;
      player.shieldRegenDelay = 0;
      player.hp = player.maxHp;
      player.boostEnergy = 100;

      for (const t of player.turrets) {
        t.heat = Math.max(0, t.heat - 35);
      }
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
    const currentTick = state.tick;
    const projectile = createProjectile(ownerId, ownerController, x, y, angle, weapon, targetId, currentTick);
    state.projectiles[projectile.id] = projectile;
    this.broadcast({ type: "shockwave", x, y, weapon, ownerId });
  }

  private findTargetId(ship: Ship, weapon: WeaponKind): string | undefined {
    const state = this.getState();
    let targetId: string | undefined;

    let closestDSq = weapon === "torpedo"
      ? CombatSystem.TORPEDO_MAX_DIST_SQ
      : CombatSystem.GUIDED_MISSILE_MAX_DIST_SQ;

    const isPlayer = ship.controller === "player";
    const team = ship.getTeam();

    for (const [id, other] of Object.entries(state.ships)) {
      if (!other.alive || id === ship.id) continue;

      if (isPlayer) {
        if (team === "spectator") continue;
        if (other.controller === "player" && (other.getTeam() === team || other.getTeam() === "spectator")) continue;
      } else {
        if (other.controller === "ai") continue;
        if (other.controller === "player" && other.getTeam() === "spectator") continue;
      }

      const dSq = distSq(ship, other);
      if (dSq < closestDSq) {
        closestDSq = dSq;
        targetId = id;
      }
    }
    return targetId;
  }
}