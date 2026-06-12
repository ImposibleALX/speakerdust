import type { Controller, ShipClass, Team, AiState, TurretMount } from "./shipTypes";
import type { WeaponKind } from "../combat/weaponStats";
import type { MountArc } from "../combat/patterns";
import { SHIP_CLASSES, checkMatrixOverlap, type ShipPhysicsState, type Sprite } from "@speakerdust/shared";
import {
  SHIP_BOOST_COST,
  SHIP_BOOST_COOLDOWN,
  SHIP_COLLISION_DAMAGE_SPEED,
} from "./shipStats";
import { clamp, shortestAngleDelta } from "../math";
import type { ShipZoneBonus } from "../world/zones";
import { createShipPhysics, initPhysicsFromShip, applyPhysicsToShip } from "../../features/physics/shipPhysics";

const PIXEL_SCALE = 3;

const EMPTY_BONUS: ShipZoneBonus = {
  heatCool: 0,
  energyRegen: 0,
  shieldDelay: 0,
  repairEveryTicks: 0,
  scoreEveryTicks: 0,
  pressureScale: 1,
};

function computeMountRestAngle(shipAngle: number, mountArc: MountArc, mx: number): number {
  if (mountArc === "forward") return shipAngle;
  if (mountArc === "omni") return shipAngle;
  if (mountArc === "broadside") {
    return shipAngle + (mx >= 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  return shipAngle;
}

function initTurretMounts(shipClass: ShipClass, shipAngle: number): TurretMount[] {
  const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
  const loadout = def.defaultLoadout;
  const mounts: TurretMount[] = [];
  for (const att of def.attachments) {
    if (att.kind !== "weapon_mount") continue;
    const weaponKind = loadout[att.id];
    if (!weaponKind) continue;
    const rest = computeMountRestAngle(shipAngle, att.mountArc, att.x);
    mounts.push({
      attachmentId: att.id,
      weaponKind,
      mountArc: att.mountArc,
      x: att.x,
      y: att.y,
      size: att.size,
      restAngle: rest,
      angle: rest,
      targetAngle: rest,
      cooldown: 0,
      heat: 0,
      enabled: true,
    });
  }
  return mounts;
}

export class Ship {
  id: string;
  controller: Controller;
  shipClass: ShipClass;
  role?: string;

  // Physics
  mass: number;
  turnRate: number;
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;

  // Weapons
  weaponSlots: WeaponKind[];
  weapon: WeaponKind;
  turretMounts: TurretMount[];

  // Defense
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shieldMax: number;
  shield: number;
  shieldRegenDelay: number;
  iFrames: number;

  // Boost
  boostEnergy: number;
  boostCooldown: number;
  boostQueued: boolean;

  // Status
  empTicks: number;
  alive: boolean;

  // Control Inputs
  inputForward: number;
  inputStrafe: number;
  inputTurn: number;
  angle: number;
  targetAngle: number;
  x: number;
  y: number;
  vx: number;
  vy: number;

  // New physics fields
  heading: number;
  angularVelocity: number;

  // Physics engine instance (non-serialized, attached at runtime)
  _physics?: import("@speakerdust/shared").ShipPhysics;

  // Optional stat overrides
  heatCoolRate?: number;
  shieldRegenInterval?: number;
  boostRegenRate?: number;

  // Relationships (Composition)
  /** Id of the Player piloting this ship, or null for AI ships */
  playerId: string | null = null;
  aiState?: AiState | null = null;

  // Identity — direct properties so Ship is self-contained (no Player back-ref)
  team: Team = "red";
  name: string = "";
  color: string = "";
  score: number = 0;
  isAdmin: boolean = false;
  godmode: boolean = false;
  inputSeq: number = 0;

  constructor(config: {
    id: string;
    controller: Controller;
    shipClass: ShipClass;
    x: number;
    y: number;
    angle?: number;
  }) {
    this.id = config.id;
    this.controller = config.controller;

    const def = SHIP_CLASSES[config.shipClass] ?? SHIP_CLASSES.corvette!;
    const stats = def.stats;
    const phys = def.physics;

    this.shipClass = config.shipClass;
    this.role = stats.role;

    this.mass = phys.mass;
    this.turnRate = phys.maxAngularSpeed;
    this.drag = phys.linearDrag;
    this.maxSpeed = phys.maxLinearSpeed;
    this.thrustForce = phys.thrustAccel;
    this.strafeThrustForce = phys.strafeAccel;

    this.weaponSlots = [...stats.weaponSlots];
    this.weapon = stats.weaponSlots[0]!;

    const startAngle = -Math.PI / 2;
    this.turretMounts = initTurretMounts(config.shipClass, startAngle);

    this.maxHp = stats.maxHp;
    this.hp = stats.maxHp;
    this.armorMax = stats.armorMax;
    this.armor = stats.armorMax;
    this.shieldMax = stats.shieldMax;
    this.shield = stats.shieldMax;
    this.shieldRegenDelay = 0;
    this.iFrames = 60;

    this.boostEnergy = 100;
    this.boostCooldown = 0;
    this.boostQueued = false;

    this.empTicks = 0;
    this.alive = true;

    this.inputForward = 0;
    this.inputStrafe = 0;
    this.inputTurn = 0;

    this.x = config.x;
    this.y = config.y;
    this.vx = 0;
    this.vy = 0;

    this.angle = startAngle;
    this.targetAngle = startAngle;
    this.heading = startAngle;
    this.angularVelocity = 0;

    this._physics = createShipPhysics(this.shipClass);
    initPhysicsFromShip(this._physics, this);
  }

  public getTeam(): Team {
    return this.team;
  }

  public tick(zoneBonus: Partial<ShipZoneBonus> | number = EMPTY_BONUS): void {
    const bonus = typeof zoneBonus === "number"
      ? { ...EMPTY_BONUS, heatCool: zoneBonus * 0.1, energyRegen: zoneBonus * 0.1, shieldDelay: zoneBonus }
      : { ...EMPTY_BONUS, ...zoneBonus };

    const empMul = this.empTicks > 0 ? 0.48 : 1;
    if (this.empTicks > 0) this.empTicks--;

    const targetAngle = this.targetAngle;
    const throttle = this.inputForward;
    const strafe = this.inputStrafe;

    let turn = this.inputTurn ?? 0;
    if (turn === 0 && targetAngle !== undefined && targetAngle !== this.angle) {
      const delta = shortestAngleDelta(this.heading, targetAngle);
      turn = clamp(delta * 6.0, -1, 1);
    }

    if (!this._physics) {
      this._physics = createShipPhysics(this.shipClass);
      initPhysicsFromShip(this._physics, this);
    }

    const modifiers: { empMul?: number; boostImpulse?: number } = { empMul };

    if (this.boostQueued && this.alive) {
      if (this.boostCooldown <= 0 && this.boostEnergy >= SHIP_BOOST_COST) {
        const impulse = (1.2 / Math.max(1, this.mass)) * empMul;
        modifiers.boostImpulse = impulse;
        this.boostEnergy -= SHIP_BOOST_COST;
        this.boostCooldown = 120;
      }
      this.boostQueued = false;
    }

    this._physics.update(
      { throttle, strafe, turn, aimAngle: targetAngle },
      1 / 30.303,
      modifiers
    );

    applyPhysicsToShip(this, this._physics);

    if (this.boostCooldown > 0) this.boostCooldown--;
    if (this.iFrames > 0) this.iFrames--;

    // Update turret mounts: track aim, rotate, cooldown, heat dissipation
    const def = SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!;
    const stats = def.stats;
    const heatCoolRate = (stats.heatCoolRate + (bonus?.heatCool ?? 0)) / Math.max(1, this.turretMounts.length);

    for (const mount of this.turretMounts) {
      if (mount.mountArc === "forward") {
        mount.targetAngle = this.angle;
      } else if (mount.mountArc === "omni") {
        mount.targetAngle = this.targetAngle;
      } else if (mount.mountArc === "broadside") {
        const restRel = mount.x >= 0 ? Math.PI / 2 : -Math.PI / 2;
        const aimRel = shortestAngleDelta(this.angle, this.targetAngle);
        const clampedRel = clamp(aimRel, restRel - Math.PI / 3, restRel + Math.PI / 3);
        mount.targetAngle = this.angle + clampedRel;
      }
      if (mount.angle !== mount.targetAngle) {
        const delta = shortestAngleDelta(mount.angle, mount.targetAngle);
        const step = this.turnRate * 0.06;
        mount.angle = Math.abs(delta) <= step ? mount.targetAngle : mount.angle + clamp(delta, -step, step);
      }
      if (mount.cooldown > 0) mount.cooldown--;
      if (mount.heat > 0) mount.heat = Math.max(0, mount.heat - heatCoolRate);
    }

    this.boostEnergy = Math.min(100, this.boostEnergy + stats.boostRegenRate + (bonus.energyRegen || 0));

    if (this.shieldMax > 0 && this.shield < this.shieldMax) {
      if (this.shieldRegenDelay > 0) {
        this.shieldRegenDelay -= Math.max(1, 1 + (bonus.shieldDelay || 0));
        if (this.shieldRegenDelay < 0) this.shieldRegenDelay = 0;
      } else {
        this.shield++;
        this.shieldRegenDelay = stats.shieldRegenInterval;
      }
    } else if (this.shield >= this.shieldMax) {
      this.shieldRegenDelay = 0;
    }
  }

  public takeDamage(
    damage: number,
    fromImpact = false,
    armorPierce = false,
  ): { dead: boolean; shieldHit: boolean; armorHit: boolean } {
    if (!this.alive) return { dead: false, shieldHit: false, armorHit: false };
    if (this.iFrames > 0 && !fromImpact) return { dead: false, shieldHit: false, armorHit: false };
    if (this.godmode) return { dead: false, shieldHit: false, armorHit: false };

    const stats = (SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!).stats;

    if (this.shield > 0) {
      this.shield = Math.max(0, this.shield - 1);
      this.shieldRegenDelay = stats.shieldRegenDelay;
      this.iFrames = fromImpact ? 8 : 14;
      return { dead: false, shieldHit: true, armorHit: false };
    }

    let hullDamage = damage;
    if (this.armor > 0 && !armorPierce) {
      const absorbable = Math.floor(this.armor * 0.45);
      const absorbed = Math.max(1, Math.min(this.armor, absorbable));
      this.armor -= absorbed;
      hullDamage = Math.max(0, damage - absorbed);
    }

    this.hp = Math.max(0, this.hp - hullDamage);
    this.iFrames = fromImpact ? 7 : 10;
    this.shieldRegenDelay = Math.max(this.shieldRegenDelay, stats.shieldRegenDelay);

    if (this.hp <= 0) {
      this.alive = false;
      return { dead: true, shieldHit: false, armorHit: this.armor > 0 };
    }
    return { dead: false, shieldHit: false, armorHit: this.armor > 0 };
  }

  public handleCollision(other: Ship): { aHurt: boolean; bHurt: boolean } {
    const defA = SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!;
    const defB = SHIP_CLASSES[other.shipClass] ?? SHIP_CLASSES.corvette!;

    const spriteA: Sprite = { pixels: defA.pixels, w: defA.w, h: defA.h, attachments: defA.attachments };
    const spriteB: Sprite = { pixels: defB.pixels, w: defB.w, h: defB.h, attachments: defB.attachments };

    const mtv = checkMatrixOverlap(
      spriteA, { x: this.x, y: this.y }, this.heading,
      spriteB, { x: other.x, y: other.y }, other.heading,
    );

    if (!mtv) return { aHurt: false, bHurt: false };

    const { overlap, normal } = mtv;
    const nx = normal.x;
    const ny = normal.y;

    const massA = Math.max(1, this.mass);
    const massB = Math.max(1, other.mass);
    const totalMass = massA + massB;

    const pushA = overlap * (massB / totalMass);
    const pushB = overlap * (massA / totalMass);
    this.x += nx * pushA;
    this.y += ny * pushA;
    other.x -= nx * pushB;
    other.y -= ny * pushB;

    const relVelX = this.vx - other.vx;
    const relVelY = this.vy - other.vy;
    const vn = relVelX * nx + relVelY * ny;

    if (vn < 0) {
      const invMassSum = 1 / massA + 1 / massB;
      const impulse = -vn / invMassSum;
      this.vx += (impulse * nx) / massA;
      this.vy += (impulse * ny) / massA;
      other.vx -= (impulse * nx) / massB;
      other.vy -= (impulse * ny) / massB;
    }

    const relSpeed = Math.hypot(this.vx - other.vx, this.vy - other.vy);
    const isHurt = relSpeed > SHIP_COLLISION_DAMAGE_SPEED;

    if (this._physics) {
      this._physics.setState({
        x: this.x, y: this.y, vx: this.vx, vy: this.vy,
        heading: this.heading, angularVelocity: this.angularVelocity,
      });
    }
    if (other._physics) {
      other._physics.setState({
        x: other.x, y: other.y, vx: other.vx, vy: other.vy,
        heading: other.heading, angularVelocity: other.angularVelocity,
      });
    }

    return { aHurt: isHurt, bHurt: isHurt };
  }

  public respawn(): void {
    const stats = (SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!).stats;
    this.x = 200 + Math.random() * 4600;
    this.y = 200 + Math.random() * 2600;
    this.vx = 0; this.vy = 0;
    this.angle = -Math.PI / 2;
    this.targetAngle = -Math.PI / 2;
    this.heading = -Math.PI / 2;
    this.angularVelocity = 0;
    this.alive = true;
    this.weapon = stats.weaponSlots[0]!;
    this.boostCooldown = 0;
    this.boostEnergy = 100;
    this.shieldMax = stats.shieldMax;
    this.shield = stats.shieldMax;
    this.armorMax = stats.armorMax;
    this.armor = stats.armorMax;
    this.shieldRegenDelay = 0;
    this.hp = stats.maxHp;
    this.maxHp = stats.maxHp;
    this.empTicks = 0;
    this.inputForward = 0;
    this.inputStrafe = 0;
    this.inputTurn = 0;
    this.boostQueued = false;
    this.iFrames = 60;
    this.turretMounts = initTurretMounts(this.shipClass, -Math.PI / 2);

    if (this._physics) {
      this._physics.setState({
        x: this.x, y: this.y, vx: this.vx, vy: this.vy,
        heading: this.heading, angularVelocity: this.angularVelocity,
      });
    }
  }

  public fullReset(): void {
    this.respawn();
    this.score = 0;
  }

  public cycleToNextWeapon(): WeaponKind {
    const slots = (SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!).stats.weaponSlots;
    const idx = slots.indexOf(this.weapon);
    this.weapon = slots[(idx + 1) % slots.length]!;
    return this.weapon;
  }
}
