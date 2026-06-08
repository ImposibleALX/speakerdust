import type { Controller, Ship } from "../ships/shipTypes";
import type { BulletKind, StatusEffect, WeaponKind } from "./weaponStats";
import { WEAPON_STATS } from "./weaponStats";
import { distSq, shortestAngleDelta, uuid } from "../math";
import { collisionRadiusFor } from "../ships/shipStats";

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
  }

  get alive(): boolean { return this._alive; }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

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
      const hitRadius = collisionRadiusFor(ship) + this.radius;
      if (distSq(this, ship) >= hitRadius * hitRadius) continue;

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
  }

  get alive(): boolean { return this._alive; }

  tick(ships: Record<string, Ship>): TickResult {
    if (!this._alive) return { hits: [], explosions: [], x: this.x, y: this.y };

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
      const hitRadius = collisionRadiusFor(ship) + this.radius;
      if (distSq(this, ship) >= hitRadius * hitRadius) continue;

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
  ) {
    super(id, ownerId, ownerController, x, y, angle, radius);
    this.length = length;
    this.damage = damage;
    this.duration = duration;
    this.bulletKind = bulletKind;
    this.splashRadius = splashRadius;
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

      const t = ((ship.x - this.x) * cosA + (ship.y - this.y) * sinA) / (this.length || 1);
      if (t < 0 || t > 1) continue;
      const closestX = this.x + t * cosA * this.length;
      const closestY = this.y + t * sinA * this.length;
      const distSqToBeam = distSq({ x: ship.x, y: ship.y }, { x: closestX, y: closestY });
      const hitRadius = this.radius + collisionRadiusFor(ship);

      if (distSqToBeam < hitRadius * hitRadius) {
        hits.push({
          targetId: ship.id,
          ownerId: this.ownerId,
          damage: this.damage,
          armorPierce: false,
          splashRadius: this.splashRadius,
          splashDamage: splashDmg,
          x: closestX,
          y: closestY,
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
  ) {
    super(id, ownerId, ownerController, x, y, angle, radius);
    this.damage = damage;
    this.splashRadius = splashRadius;
    this.triggerRadius = triggerRadius;
    this.armingTicks = armingTicks;
    this.bulletKind = bulletKind;
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
    );
  }

  const vx = Math.cos(angle) * stats.speed;
  const vy = Math.sin(angle) * stats.speed;
  return new BulletProjectile(
    id, ownerId, ownerController, x, y, angle, stats.radius,
    vx, vy, stats.life, weapon, stats.damage, stats.splashRadius,
    stats.statusEffect, stats.detonateAtLife,
  );
}
