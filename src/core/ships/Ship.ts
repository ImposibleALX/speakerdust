import type { Controller, ShipClass, Team, AiState } from "./shipTypes";
import type { WeaponKind } from "../combat/weaponStats";
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

import { createTurret, Turret } from "../combat/Turret";

function initTurrets(shipClass: ShipClass, shipAngle: number): Turret[] {
  const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
  const loadout = def.defaultLoadout;
  const mounts: Turret[] = [];
  for (const att of def.visual.attachments) {
    if (att.kind !== "weapon_mount") continue;
    const weaponKind = loadout[att.id];
    if (!weaponKind) continue;
    let minAngle = att.minAngle;
    let maxAngle = att.maxAngle;
    let turnRate = att.turnRate;
    if (weaponKind === "railgun") { minAngle = 0; maxAngle = 0; turnRate = 0; }
    const rest = shipAngle + (minAngle + maxAngle) / 2;
    mounts.push(createTurret({
      attachmentId: att.id,
      weaponKind,
      x: att.x,
      y: att.y,
      minAngle,
      maxAngle,
      turnRate,
      size: att.size,
      restAngle: rest,
    }));
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
  turrets: Turret[];

  // Defense
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shieldMax: number;
  shield: number;
  shieldRegenDelay: number;

  // Boost
  boostEnergy: number;
  boostCooldown: number;
  boostQueued: boolean;
  boostTicks: number;

  // Status
  empTicks: number;
  iFrames: number;
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

    const startAngle = 0;
    this.turrets = initTurrets(config.shipClass, startAngle);

    this.maxHp = stats.maxHp;
    this.hp = stats.maxHp;
    this.armorMax = stats.armorMax;
    this.armor = stats.armorMax;
    this.shieldMax = stats.shieldMax;
    this.shield = stats.shieldMax;
    this.shieldRegenDelay = 0;

    this.boostEnergy = 100;
    this.boostCooldown = 0;
    this.boostQueued = false;
    this.boostTicks = 0;

    this.empTicks = 0;
    this.iFrames = 0;
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

    const def = SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!;
    const stats = def.stats;

    const isEmped = this.empTicks > 0;
    const empMul = isEmped ? 0.48 : 1;

    if (isEmped) {
      this.empTicks--;
      this.boostQueued = false; // Cancela cualquier intento de boost bajo EMP
    }

    const targetAngle = this.targetAngle;
    const throttle = this.inputForward;
    const strafe = this.inputStrafe;
    let turn = this.inputTurn ?? 0;

    if (!this._physics) {
      this._physics = createShipPhysics(this.shipClass);
      initPhysicsFromShip(this._physics, this);
    }

    const modifiers: { empMul?: number; speedMul?: number; thrustMul?: number } = { empMul };

    if (this.boostQueued && this.alive) {
      if (this.boostCooldown <= 0 && this.boostEnergy >= SHIP_BOOST_COST) {
        this.boostTicks = 5;
        this.boostEnergy -= SHIP_BOOST_COST;
        this.boostCooldown = 120;
      }
      this.boostQueued = false;
    }

    if (this.boostTicks > 0) {
      modifiers.speedMul = 1.6;
      modifiers.thrustMul = 1.6;
      this.boostTicks--;
    }

    this._physics.update(
      { throttle, strafe, turn },
      1 / 30.303,
      modifiers
    );

    applyPhysicsToShip(this, this._physics);

    if (this.boostCooldown > 0) this.boostCooldown--;

    // Torretas (El EMP ralentiza severamente su rotación)
    const heatCoolRate = (stats.heatCoolRate + (bonus?.heatCool ?? 0)) / Math.max(1, this.turrets.length);
    const turretTurnMul = isEmped ? 0.1 : 1; // Giran al 10% de su capacidad si hay EMP

    for (const turret of this.turrets) {
      turret.update(this.angle, this.targetAngle, this.turnRate * turretTurnMul, heatCoolRate);
    }

    this.boostEnergy = Math.min(100, this.boostEnergy + stats.boostRegenRate + (bonus.energyRegen || 0));

    // Regeneración de escudos
    if (this.shieldMax > 0 && this.shield < this.shieldMax) {
      if (isEmped) {
        // El EMP frena por completo la regeneración, manteniendo el delay
        this.shieldRegenDelay = Math.max(this.shieldRegenDelay, stats.shieldRegenDelay);
      } else if (this.shieldRegenDelay > 0) {
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
    if (!this.alive || this.godmode) return { dead: false, shieldHit: false, armorHit: false };

    const stats = (SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!).stats;
    let remainingDamage = damage;
    let shieldHit = false;

    // 1. Escudo absorbe DAÑO REAL
    if (this.shield > 0) {
      shieldHit = true;
      if (this.shield >= remainingDamage) {
        this.shield -= remainingDamage;
        remainingDamage = 0;
      } else {
        remainingDamage -= this.shield;
        this.shield = 0;
      }
      this.shieldRegenDelay = stats.shieldRegenDelay;
    }

    let armorHit = false;

    // 2. Armadura Plana (Absorbe un 50% de todo daño hasta romperse)
    if (remainingDamage > 0 && this.armor > 0 && !armorPierce) {
      armorHit = true;
      const ABSORPTION_PERCENT = 0.50; // Bloquea 50% del daño entrante
      let damageToArmor = remainingDamage * ABSORPTION_PERCENT;

      if (this.armor >= damageToArmor) {
        this.armor -= damageToArmor;
        remainingDamage -= damageToArmor; // El otro 50% pasa al casco
      } else {
        // Se rompe la armadura, absorbe el sobrante y todo lo demás va al HP
        remainingDamage -= this.armor;
        this.armor = 0;
      }
    }

    // 3. Daño restante al Casco (HP)
    if (remainingDamage > 0) {
      this.hp = Math.max(0, this.hp - remainingDamage);
      this.shieldRegenDelay = Math.max(this.shieldRegenDelay, stats.shieldRegenDelay);
    }

    if (this.hp <= 0) {
      this.alive = false;
      return { dead: true, shieldHit: false, armorHit: this.armor > 0 };
    }

    return { dead: false, shieldHit, armorHit };
  }

  public handleCollision(other: Ship): { aHurt: boolean; bHurt: boolean; aDamage: number; bDamage: number } {
    const defA = SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!;
    const defB = SHIP_CLASSES[other.shipClass] ?? SHIP_CLASSES.corvette!;

    const spriteA: Sprite = { pixels: defA.visual.pixels, w: defA.visual.w, h: defA.visual.h, attachments: defA.visual.attachments };
    const spriteB: Sprite = { pixels: defB.visual.pixels, w: defB.visual.w, h: defB.visual.h, attachments: defB.visual.attachments };

    const mtv = checkMatrixOverlap(
      spriteA, { x: this.x, y: this.y }, this.heading,
      spriteB, { x: other.x, y: other.y }, other.heading,
    );

    if (!mtv) return { aHurt: false, bHurt: false, aDamage: 0, bDamage: 0 };

    const { overlap, normal } = mtv;
    const nx = normal.x;
    const ny = normal.y;

    const massA = Math.max(1, this.mass);
    const massB = Math.max(1, other.mass);
    const totalMass = massA + massB;

    // Desplazamiento por colisión (Empuje)
    const pushA = overlap * (massB / totalMass);
    const pushB = overlap * (massA / totalMass);
    this.x += nx * pushA;
    this.y += ny * pushA;
    other.x -= nx * pushB;
    other.y -= ny * pushB;

    // Transferencia de Impulso Físico
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

    // Cálculo de Daño por Colisión Basado en Masa y Velocidad Relativa
    const relSpeed = Math.hypot(this.vx - other.vx, this.vy - other.vy);
    const threshold = SHIP_COLLISION_DAMAGE_SPEED; // Umbral a partir del cual duele

    let aDamage = 0;
    let bDamage = 0;

    if (relSpeed > threshold) {
      const speedFactor = relSpeed - threshold;
      const damageMultiplier = 0.5; // Multiplicador general del daño

      // Te haces más daño si el oponente pesa más.
      aDamage = speedFactor * massB * damageMultiplier;
      bDamage = speedFactor * massA * damageMultiplier;
    }

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

    return {
      aHurt: aDamage > 0,
      bHurt: bDamage > 0,
      aDamage,
      bDamage
    };
  }

  public respawn(): void {
    const stats = (SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!).stats;
    this.x = 200 + Math.random() * 4600;
    this.y = 200 + Math.random() * 2600;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.targetAngle = 0;
    this.heading = 0;
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
    this.iFrames = 0;
    this.inputForward = 0;
    this.inputStrafe = 0;
    this.inputTurn = 0;
    this.boostQueued = false;
    this.boostTicks = 0;
    this.turrets = initTurrets(this.shipClass, 0);

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
    this.godmode = false;
    this.isAdmin = false;
  }

  public cycleToNextWeapon(): WeaponKind {
    const slots = (SHIP_CLASSES[this.shipClass] ?? SHIP_CLASSES.corvette!).stats.weaponSlots;
    const idx = slots.indexOf(this.weapon);
    this.weapon = slots[(idx + 1) % slots.length]!;
    return this.weapon;
  }
}