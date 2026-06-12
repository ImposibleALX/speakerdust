import type { Controller, Ship } from "../ships/shipTypes";
import type { BulletKind, StatusEffect, WeaponKind } from "./weaponStats";
import { WEAPON_STATS } from "./weaponStats";
import { distSq, shortestAngleDelta, uuid } from "../math";
import { SHIP_CLASSES, checkBulletHit, checkBeamHit } from "@speakerdust/shared";
import type { CollisionGrid } from "@speakerdust/shared";

function shipToCollisionGrid(ship: Ship): CollisionGrid {
  const def = SHIP_CLASSES[ship.shipClass] ?? SHIP_CLASSES.corvette!;
  return {
    pixels: def.pixels,
    w: def.w,
    h: def.h,
    centerX: def.spriteCenter.x,
    centerY: def.spriteCenter.y,
    boundingRadius: def.boundingRadius,
  };
}

export type ProjectileKind = "bullet" | "beam" | "missile" | "mine";

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
  kind: string;
  radius: number;
  spawnTick: number;
}

export abstract class Projectile {
  abstract get kind(): ProjectileKind;

  id: string;
  ownerId: string;
  ownerController: Controller;
  x: number;
  y: number;
  angle: number;
  radius: number;

  constructor(
    id: string,
    ownerId: string,
    ownerController: Controller,
    x: number,
    y: number,
    angle: number,
    radius: number,
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.ownerController = ownerController;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.radius = radius;
  }

  abstract tick(ships: Record<string, Ship>): TickResult;
  abstract toPublic(): PublicProjectile;
  abstract get alive(): boolean;
}

export class BulletProjectile extends Projectile {
  get kind(): ProjectileKind { return "bullet"; }

  vx: number;
  vy: number;
  life: number;
  bulletKind: WeaponKind;
  damage: number;
  splashRadius: number;
  statusEffect?: StatusEffect;
  detonateAtLife?: number;
  spawnTick: number;

  private _alive = true;

  constructor(
    id: string,
    ownerId: string,
    ownerController: Controller,
    x: number,
    y: number,
    angle: number,
    radius: number,
    vx: number,
    vy: number,
    life: number,
    bulletKind: WeaponKind,
    damage: number,
    splashRadius: number,
    statusEffect?: StatusEffect,
    detonateAtLife?: number,
    spawnTick: number = 0,
  ) {
    super(id, ownerId, ownerController, x, y, angle, radius);
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.bulletKind = bulletKind;
    this.damage = damage;
    this.splashRadius = splashRadius;
    this.statusEffect = statusEffect;
    this.detonateAtLife = detonateAtLife;
    this.spawnTick = spawnTick;
  }

  get alive(): boolean { return this._alive; }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

    const prevX = this.x;
    const prevY = this.y;
    this.x += this.vx;
    this.y += this.vy;
    this.life--;

    if (this.detonateAtLife !== undefined && this.life <= this.detonateAtLife) {
      this._alive = false;
      const splashDmg = Math.max(1, Math.round(this.damage * 0.7));
      return {
        hits: [],
        explosions: [{ x: this.x, y: this.y, kind: this.bulletKind }],
        x: this.x, y: this.y,
      };
    }

    if (this.life <= 0) {
      this._alive = false;
      return { hits: [], explosions: [], x: this.x, y: this.y };
    }

    const hits: HitEvent[] = [];
    const armorPierce = this.bulletKind === "railgun";
    const splashDmg = Math.max(1, Math.round(this.damage * 0.7));

    for (const ship of Object.values(ships)) {
      if (ship.id === this.ownerId || !ship.alive) continue;
      if (ship.controller === "player" && this.ownerController === "player") {
        const owner = ships[this.ownerId];
        if (owner?.controller === "player" && ship.team === owner.team) continue;
        if (ship.team === "spectator") continue;
      }
      if (!checkBulletHit(shipToCollisionGrid(ship), ship.x, ship.y, ship.heading, this.x, this.y, this.radius, prevX, prevY)) continue;

      this._alive = false;
      hits.push({
        targetId: ship.id,
        ownerId: this.ownerId,
        damage: this.damage,
        armorPierce,
        statusEffect: this.statusEffect,
        splashRadius: this.splashRadius,
        splashDamage: splashDmg,
        x: this.x,
        y: this.y,
        kind: this.bulletKind,
      });
      return { hits, explosions: [], x: this.x, y: this.y };
    }

    return { hits: [], explosions: [], x: this.x, y: this.y };
  }

  toPublic(): PublicProjectile {
    return {
      id: this.id,
      ownerId: this.ownerId,
      ownerController: this.ownerController,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      angle: this.angle,
      kind: this.bulletKind,
      radius: this.radius,
      spawnTick: this.spawnTick,
    };
  }
}

export class MissileProjectile extends Projectile {
  get kind(): ProjectileKind { return "missile"; }

  vx: number;
  vy: number;
  life: number;
  bulletKind: WeaponKind;
  damage: number;
  splashRadius: number;
  turnRate: number;
  targetId?: string;
  speed: number;
  spawnTick: number;

  private _alive = true;

  constructor(
    id: string,
    ownerId: string,
    ownerController: Controller,
    x: number,
    y: number,
    angle: number,
    radius: number,
    vx: number,
    vy: number,
    life: number,
    bulletKind: WeaponKind,
    damage: number,
    splashRadius: number,
    turnRate: number,
    targetId?: string,
    speed?: number,
    spawnTick: number = 0,
  ) {
    super(id, ownerId, ownerController, x, y, angle, radius);
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.bulletKind = bulletKind;
    this.damage = damage;
    this.splashRadius = splashRadius;
    this.turnRate = turnRate;
    this.targetId = targetId;
    this.speed = speed ?? Math.hypot(vx, vy);
    this.spawnTick = spawnTick;
  }

  get alive(): boolean { return this._alive; }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

    const prevX = this.x;
    const prevY = this.y;

    if (this.targetId) {
      const target = ships[this.targetId];
      if (target?.alive) {
        const desiredAngle = Math.atan2(target.y - this.y, target.x - this.x);
        this.angle += shortestAngleDelta(this.angle, desiredAngle) * this.turnRate;
        this.vx = Math.cos(this.angle) * this.speed;
        this.vy = Math.sin(this.angle) * this.speed;
      } else {
        this.targetId = undefined;
      }
    }

    this.x += this.vx;
    this.y += this.vy;
    this.life--;

    if (this.life <= 0) {
      this._alive = false;
      return { hits: [], explosions: [], x: this.x, y: this.y };
    }

    const hits: HitEvent[] = [];
    const armorPierce = false;
    const splashDmg = Math.max(1, Math.round(this.damage * 0.7));

    for (const ship of Object.values(ships)) {
      if (ship.id === this.ownerId || !ship.alive) continue;
      if (ship.controller === "player" && this.ownerController === "player") {
        const owner = ships[this.ownerId];
        if (owner?.controller === "player" && ship.team === owner.team) continue;
        if (ship.team === "spectator") continue;
      }
      if (!checkBulletHit(shipToCollisionGrid(ship), ship.x, ship.y, ship.heading, this.x, this.y, this.radius, prevX, prevY)) continue;

      this._alive = false;
      hits.push({
        targetId: ship.id,
        ownerId: this.ownerId,
        damage: this.damage,
        armorPierce,
        statusEffect: undefined,
        splashRadius: this.splashRadius,
        splashDamage: splashDmg,
        x: this.x,
        y: this.y,
        kind: this.bulletKind,
      });
      return { hits, explosions: [], x: this.x, y: this.y };
    }

    return { hits: [], explosions: [], x: this.x, y: this.y };
  }

  toPublic(): PublicProjectile {
    return {
      id: this.id,
      ownerId: this.ownerId,
      ownerController: this.ownerController,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      angle: this.angle,
      kind: this.bulletKind,
      radius: this.radius,
      spawnTick: this.spawnTick,
    };
  }
}

export class BeamProjectile extends Projectile {
  get kind(): ProjectileKind { return "beam"; }

  length: number;
  damage: number;
  duration: number;
  bulletKind: WeaponKind;
  splashRadius: number;
  spawnTick: number;

  private _alive = true;

  constructor(
    id: string,
    ownerId: string,
    ownerController: Controller,
    x: number,
    y: number,
    angle: number,
    radius: number,
    length: number,
    damage: number,
    duration: number,
    bulletKind: WeaponKind,
    splashRadius: number,
    spawnTick: number = 0,
  ) {
    super(id, ownerId, ownerController, x, y, angle, radius);
    this.length = length;
    this.damage = damage;
    this.duration = duration;
    this.bulletKind = bulletKind;
    this.splashRadius = splashRadius;
    this.spawnTick = spawnTick;
  }

  get alive(): boolean { return this._alive; }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

    const hits: HitEvent[] = [];
    const splashDmg = Math.max(1, Math.round(this.damage * 0.7));
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    const endX = this.x + cosA * this.length;
    const endY = this.y + sinA * this.length;

    for (const ship of Object.values(ships)) {
      if (ship.id === this.ownerId || !ship.alive) continue;
      if (ship.controller === "player" && this.ownerController === "player") {
        const owner = ships[this.ownerId];
        if (owner?.controller === "player" && ship.team === owner.team) continue;
        if (ship.team === "spectator") continue;
      }

      const beamHit = checkBeamHit(shipToCollisionGrid(ship), ship.x, ship.y, ship.heading, this.x, this.y, this.angle, this.length, this.radius);
      if (beamHit) {
        hits.push({
          targetId: ship.id,
          ownerId: this.ownerId,
          damage: this.damage,
          armorPierce: false,
          splashRadius: this.splashRadius,
          splashDamage: splashDmg,
          x: beamHit.cx,
          y: beamHit.cy,
          kind: this.bulletKind,
        });
      }
    }

    this.duration--;
    if (this.duration <= 0) this._alive = false;

    return { hits, explosions: [], x: this.x, y: this.y };
  }

  toPublic(): PublicProjectile {
    return {
      id: this.id,
      ownerId: this.ownerId,
      ownerController: this.ownerController,
      x: this.x,
      y: this.y,
      vx: 0,
      vy: 0,
      angle: this.angle,
      kind: this.bulletKind,
      radius: this.radius,
      spawnTick: this.spawnTick,
    };
  }
}

export class MineProjectile extends Projectile {
  get kind(): ProjectileKind { return "mine"; }

  damage: number;
  splashRadius: number;
  triggerRadius: number;
  armingTicks: number;
  bulletKind: WeaponKind;
  spawnTick: number;

  private _alive = true;
  private _armed = false;

  constructor(
    id: string,
    ownerId: string,
    ownerController: Controller,
    x: number,
    y: number,
    angle: number,
    radius: number,
    damage: number,
    splashRadius: number,
    triggerRadius: number,
    armingTicks: number,
    bulletKind: WeaponKind,
    spawnTick: number = 0,
  ) {
    super(id, ownerId, ownerController, x, y, angle, radius);
    this.damage = damage;
    this.splashRadius = splashRadius;
    this.triggerRadius = triggerRadius;
    this.armingTicks = armingTicks;
    this.bulletKind = bulletKind;
    this.spawnTick = spawnTick;
  }

  get alive(): boolean { return this._alive; }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

    if (!this._armed) {
      this.armingTicks--;
      if (this.armingTicks <= 0) this._armed = true;
      return { hits: [], explosions: [], x: this.x, y: this.y };
    }

    const splashDmg = Math.max(1, Math.round(this.damage * 0.7));
    const triggerSq = this.triggerRadius * this.triggerRadius;

    for (const ship of Object.values(ships)) {
      if (ship.id === this.ownerId || !ship.alive) continue;
      if (ship.controller === "player" && this.ownerController === "player") {
        const owner = ships[this.ownerId];
        if (owner?.controller === "player" && ship.team === owner.team) continue;
        if (ship.team === "spectator") continue;
      }
      if (distSq(this, ship) >= triggerSq) continue;

      this._alive = false;
      return {
        hits: [{
          targetId: ship.id,
          ownerId: this.ownerId,
          damage: this.damage,
          armorPierce: false,
          splashRadius: this.splashRadius,
          splashDamage: splashDmg,
          x: this.x,
          y: this.y,
          kind: this.bulletKind,
        }],
        explosions: [{ x: this.x, y: this.y, kind: this.bulletKind }],
        x: this.x,
        y: this.y,
      };
    }

    return { hits: [], explosions: [], x: this.x, y: this.y };
  }

  toPublic(): PublicProjectile {
    return {
      id: this.id,
      ownerId: this.ownerId,
      ownerController: this.ownerController,
      x: this.x,
      y: this.y,
      vx: 0,
      vy: 0,
      angle: this.angle,
      kind: "mine",
      radius: this.radius + (this._armed ? this.triggerRadius : 0),
      spawnTick: this.spawnTick,
    };
  }
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
): Projectile {
  const id = uuid();
  const stats = WEAPON_STATS[weapon];

  if (weapon === "torpedo" || weapon === "guided_missile") {
    const vx = Math.cos(angle) * stats.speed;
    const vy = Math.sin(angle) * stats.speed;
    return new MissileProjectile(
      id, ownerId, ownerController, x, y, angle, stats.radius,
      vx, vy, stats.life, weapon, stats.damage, stats.splashRadius,
      stats.turnRate ?? 0.02, targetId, stats.speed,
      spawnTick,
    );
  }

  const vx = Math.cos(angle) * stats.speed;
  const vy = Math.sin(angle) * stats.speed;
  return new BulletProjectile(
    id, ownerId, ownerController, x, y, angle, stats.radius,
    vx, vy, stats.life, weapon, stats.damage, stats.splashRadius,
    stats.statusEffect, stats.detonateAtLife,
    spawnTick,
  );
}
