import type { Controller, Ship } from "../ships/shipTypes";
import type { StatusEffect, WeaponKind, MovementType, GuidanceType } from "./weaponStats";
import { WEAPON_STATS } from "./weaponStats";
import { shortestAngleDelta, uuid } from "../math";
import { SHIP_CLASSES, checkBulletHit } from "@speakerdust/shared";
import type { CollisionGrid } from "@speakerdust/shared";

const _gridCache: Record<string, CollisionGrid> = {};

function getShipCollisionGrid(shipClass: string): CollisionGrid {
  let grid = _gridCache[shipClass];
  if (!grid) {
    const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
    grid = {
      pixels: def.visual.pixels,
      w: def.visual.w,
      h: def.visual.h,
      centerX: def.visual.spriteCenter.x,
      centerY: def.visual.spriteCenter.y,
    };
    _gridCache[shipClass] = grid;
  }
  return grid;
}

export interface HitEvent {
  targetId: string;
  ownerId: string;
  damage: number;
  armorPierce: boolean;
  statusEffect?: StatusEffect;
  splashRadius: number;
  splashDamage: number;
  x: number;
  y: number;
  kind: WeaponKind;
}

export interface ExplosionEvent {
  x: number;
  y: number;
  kind: string;
}

export interface TickResult {
  hits: HitEvent[];
  explosions: ExplosionEvent[];
  x: number;
  y: number;
}

export interface PublicProjectile {
  id: string;
  ownerId: string;
  ownerController: Controller;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  kind: WeaponKind;
  radius: number;
  spawnTick: number;
  hp: number;
  maxHp: number;
  guidance: GuidanceType;
}

export interface ProjectileData {
  id: string;
  ownerId: string;
  ownerController: Controller;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
  radius: number;
  weaponKind: WeaponKind;
  damage: number;
  splashDamage: number;
  splashRadius: number;
  armorPierce: boolean;
  statusEffect?: StatusEffect;
  spawnTick: number;
  hp: number;
  maxHp: number;
  movement: MovementType;
  guidance: GuidanceType;
  interceptable: boolean;
  life: number;
  detonateAtLife?: number;
  turnRate: number;
  targetId?: string;
}

function canHitTarget(target: Ship, ownerId: string, ownerController: Controller, ships: Record<string, Ship>): boolean {
  if (target.id === ownerId || !target.alive) return false;

  if (target.controller === "player" && ownerController === "player") {
    const owner = ships[ownerId];
    if (owner) {
      if (target.getTeam() === owner.getTeam()) return false;
    } else {
      return false;
    }
    if (target.getTeam() === "spectator") return false;
  }

  return true;
}

export class Projectile {
  public id: string;
  public ownerId: string;
  public ownerController: Controller;
  public x: number;
  public y: number;
  public vx: number;
  public vy: number;
  public angle: number;
  public speed: number;
  public radius: number;
  public weaponKind: WeaponKind;
  public damage: number;
  public splashDamage: number;
  public splashRadius: number;
  public armorPierce: boolean;
  public statusEffect?: StatusEffect;
  public spawnTick: number;
  public hp: number;
  public maxHp: number;
  public movement: MovementType;
  public guidance: GuidanceType;
  public interceptable: boolean;
  public life: number;
  public detonateAtLife?: number;
  public turnRate: number;
  public targetId?: string;

  protected _alive = true;

  constructor(data: ProjectileData) {
    this.id = data.id;
    this.ownerId = data.ownerId;
    this.ownerController = data.ownerController;
    this.x = data.x;
    this.y = data.y;
    this.vx = data.vx;
    this.vy = data.vy;
    this.angle = data.angle;
    this.speed = data.speed;
    this.radius = data.radius;
    this.weaponKind = data.weaponKind;
    this.damage = data.damage;
    this.splashDamage = data.splashDamage;
    this.splashRadius = data.splashRadius;
    this.armorPierce = data.armorPierce;
    this.statusEffect = data.statusEffect;
    this.spawnTick = data.spawnTick;
    this.hp = data.hp;
    this.maxHp = data.maxHp;
    this.movement = data.movement;
    this.guidance = data.guidance;
    this.interceptable = data.interceptable;
    this.life = data.life;
    this.detonateAtLife = data.detonateAtLife;
    this.turnRate = data.turnRate;
    this.targetId = data.targetId;
  }

  reuse(data: ProjectileData): void {
    Object.assign(this, data);
    this._alive = true;
  }

  get alive(): boolean { return this._alive; }

  takeDamage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this._alive = false;
    }
  }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

    // Stationary: never moves, just counts down life
    if (this.movement === "stationary") {
      return this.tickStationary(ships);
    }

    // Instant: hitscan, check collision at origin
    if (this.movement === "instant") {
      return this.tickInstant(ships);
    }

    // Physical: travels through space
    const prevX = this.x;
    const prevY = this.y;

    // Guidance: steer toward target before moving
    if (this.guidance === "guided") {
      this.updateGuidance(ships);
    }

    this.x += this.vx;
    this.y += this.vy;
    this.life--;

    // Detonate at specific life (e.g. energy_bomb)
    if (this.detonateAtLife !== undefined && this.life <= this.detonateAtLife) {
      this._alive = false;
      return { hits: [], explosions: [{ x: this.x, y: this.y, kind: this.weaponKind }], x: this.x, y: this.y };
    }

    // Expired — guided weapons explode visibly
    if (this.life <= 0) {
      this._alive = false;
      const explode = this.guidance === "guided";
      return { hits: [], explosions: explode ? [{ x: this.x, y: this.y, kind: this.weaponKind }] : [], x: this.x, y: this.y };
    }

    // Collision check
    for (const shipId in ships) {
      const ship = ships[shipId]!;
      if (!canHitTarget(ship, this.ownerId, this.ownerController, ships)) continue;

      const grid = getShipCollisionGrid(ship.shipClass);
      if (!checkBulletHit(grid, ship.x, ship.y, ship.angle, this.x, this.y, this.radius, prevX, prevY)) continue;

      this._alive = false;
      return {
        hits: [{
          targetId: ship.id, ownerId: this.ownerId, damage: this.damage,
          armorPierce: this.armorPierce, statusEffect: this.statusEffect,
          splashRadius: this.splashRadius, splashDamage: this.splashDamage,
          x: this.x, y: this.y, kind: this.weaponKind,
        }],
        explosions: [], x: this.x, y: this.y
      };
    }

    return { hits: [], explosions: [], x: this.x, y: this.y };
  }

  private updateGuidance(ships: Record<string, Ship>): void {
    if (!this.targetId) return;
    const target = ships[this.targetId];
    if (!target?.alive) {
      this.targetId = undefined;
      return;
    }

    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const desiredAngle = Math.atan2(dy, dx);
    const delta = shortestAngleDelta(this.angle, desiredAngle);
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const closeBoost = Math.max(1.0, Math.min(3.0, 200 / Math.max(40, dist)));
    const maxTurn = this.turnRate * closeBoost;
    const actualTurn = Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);

    this.angle += actualTurn;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
  }

  private tickStationary(ships: Record<string, Ship>): TickResult {
    this.life--;
    if (this.life <= 0) {
      this._alive = false;
      return { hits: [], explosions: [], x: this.x, y: this.y };
    }

    // Check collision at current position (mines, stationary traps)
    for (const shipId in ships) {
      const ship = ships[shipId]!;
      if (!canHitTarget(ship, this.ownerId, this.ownerController, ships)) continue;
      const grid = getShipCollisionGrid(ship.shipClass);
      if (!checkBulletHit(grid, ship.x, ship.y, ship.angle, this.x, this.y, this.radius, this.x, this.y)) continue;
      this._alive = false;
      return {
        hits: [{
          targetId: ship.id, ownerId: this.ownerId, damage: this.damage,
          armorPierce: this.armorPierce, statusEffect: this.statusEffect,
          splashRadius: this.splashRadius, splashDamage: this.splashDamage,
          x: this.x, y: this.y, kind: this.weaponKind,
        }],
        explosions: [], x: this.x, y: this.y
      };
    }

    return { hits: [], explosions: [], x: this.x, y: this.y };
  }

  private tickInstant(ships: Record<string, Ship>): TickResult {
    // Hitscan: immediately check collision at firing point
    this._alive = false;
    for (const shipId in ships) {
      const ship = ships[shipId]!;
      if (!canHitTarget(ship, this.ownerId, this.ownerController, ships)) continue;
      const grid = getShipCollisionGrid(ship.shipClass);
      if (!checkBulletHit(grid, ship.x, ship.y, ship.angle, this.x, this.y, this.radius, this.x, this.y)) continue;
      return {
        hits: [{
          targetId: ship.id, ownerId: this.ownerId, damage: this.damage,
          armorPierce: this.armorPierce, statusEffect: this.statusEffect,
          splashRadius: this.splashRadius, splashDamage: this.splashDamage,
          x: this.x, y: this.y, kind: this.weaponKind,
        }],
        explosions: [], x: this.x, y: this.y
      };
    }
    return { hits: [], explosions: [], x: this.x, y: this.y };
  }

  toPublic(): PublicProjectile {
    return {
      id: this.id, ownerId: this.ownerId, ownerController: this.ownerController,
      x: this.x, y: this.y, vx: this.vx, vy: this.vy, angle: this.angle,
      kind: this.weaponKind, radius: this.radius, spawnTick: this.spawnTick,
      hp: this.hp, maxHp: this.maxHp, guidance: this.guidance,
    };
  }
}

export function checkProjectileCollision(a: Projectile, b: Projectile): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distSq = dx * dx + dy * dy;
  const radii = a.radius + b.radius;
  return distSq <= radii * radii;
}

class ProjectilePool {
  private pool: Projectile[] = [];

  acquire(data: ProjectileData): Projectile {
    const p = this.pool.pop();
    if (p) { p.reuse(data); return p; }
    return new Projectile(data);
  }

  release(p: Projectile): void {
    this.pool.push(p);
  }
}

const _pool = new ProjectilePool();

export function releaseProjectile(p: Projectile): void {
  _pool.release(p);
}

export function createProjectile(
  ownerId: string,
  ownerController: Controller,
  x: number,
  y: number,
  angle: number,
  weapon: WeaponKind,
  targetId?: string,
  spawnTick: number = 0,
  damageMultiplier: number = 1,
): Projectile {
  const id = uuid();
  const stats = WEAPON_STATS[weapon];

  const projectileHp = weapon === "torpedo" ? 5 : weapon === "guided_missile" ? 3 : 1;
  const speed = stats.speed;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;

  const data: ProjectileData = {
    id, ownerId, ownerController, x, y, vx, vy, angle, speed,
    radius: stats.radius, weaponKind: weapon,
    damage: stats.damage * damageMultiplier,
    splashDamage: stats.splashDamage * damageMultiplier,
    splashRadius: stats.splashRadius,
    armorPierce: stats.armorPierce,
    statusEffect: stats.statusEffect,
    spawnTick, hp: projectileHp, maxHp: projectileHp,
    movement: stats.movement,
    guidance: stats.guidance,
    interceptable: stats.interceptable,
    life: stats.life,
    detonateAtLife: stats.detonateAtLife,
    turnRate: stats.turnRate ?? 0.02,
    targetId,
  };

  return _pool.acquire(data);
}