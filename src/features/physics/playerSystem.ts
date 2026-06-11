// playerSystem.ts
// Player lifecycle and shared naval ship physics.

import {
  Ship, ShipClass,
  Team,
} from "../../core/ships/shipTypes";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { WORLD_W, WORLD_H } from "../../core/world/mapConfig";
import { SHIP_CLASSES, checkShipCollision } from "@speakerdust/shared";
import {
  DEFAULT_PLAYER_CLASS,
  SHIP_BOOST_COST, SHIP_BOOST_COOLDOWN,
  SHIP_COLLISION_DAMAGE_SPEED, SHIP_HEAT_LIMIT,
} from "../../core/ships/shipStats";
import type { ShipZoneBonus } from "../../core/world/zones";
import { clamp, rand, shortestAngleDelta } from "../../core/math";
import {
  createShipPhysics,
  initShipPhysicsFromShip,
  syncShipToPhysics,
} from "./shipPhysics";

const EMPTY_BONUS: ShipZoneBonus = {
  heatCool: 0,
  energyRegen: 0,
  shieldDelay: 0,
  repairEveryTicks: 0,
  scoreEveryTicks: 0,
  pressureScale: 1,
};

function applyClassStats(ship: Ship, shipClass: ShipClass): void {
  const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
  const stats = def.stats;
  ship.shipClass = shipClass;
  ship.role = stats.role;
  ship.mass = def.physics.mass;
  ship.turnRate = def.physics.maxAngularSpeed;
  ship.drag = def.physics.linearDrag;
  ship.maxSpeed = def.physics.maxLinearSpeed;
  ship.thrustForce = def.physics.thrustAccel;
  ship.strafeThrustForce = def.physics.strafeAccel;
  ship.weaponSlots = [...stats.weaponSlots];
  if (!ship.weaponSlots.includes(ship.weapon)) ship.weapon = ship.weaponSlots[0]!;
}

export function createPlayer(playerId: string, team: Team): Ship {
  const hue = Math.floor(Math.random() * 360);
  const def = SHIP_CLASSES[DEFAULT_PLAYER_CLASS]!;
  const stats = def.stats;
  const phys = def.physics;
  const ship: Ship = {
    id: playerId,
    controller: "player",
    shipClass: DEFAULT_PLAYER_CLASS,
    role: stats.role,
    mass: phys.mass,
    turnRate: phys.maxAngularSpeed,
    weaponSlots: [...stats.weaponSlots],
    x: rand(200, WORLD_W - 200),
    y: rand(200, WORLD_H - 200),
    vx: 0, vy: 0,
    angle: -Math.PI / 2,
    targetAngle: -Math.PI / 2,
    color: `hsl(${hue}, 80%, 65%)`,
    name: `CAPT-${playerId.slice(0, 4).toUpperCase()}`,
    team,
    score: 0,
    alive: true,
    weapon: stats.weaponSlots[0]!,
    shootCooldown: 0,
    weaponHeat: 0,
    boostCooldown: 0,
    boostEnergy: 100,
    shieldMax: stats.shieldMax,
    shield: stats.shieldMax,
    armor: stats.armorMax,
    armorMax: stats.armorMax,
    shieldRegenDelay: 0,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    empTicks: 0,
    inputForward: 0,
    inputStrafe: 0,
    inputTurn: 0,
    boostQueued: false,
    iFrames: 60,
    isAdmin: false,
    godmode: false,
    inputSeq: 0,
    drag: phys.linearDrag,
    maxSpeed: phys.maxLinearSpeed,
    thrustForce: phys.thrustAccel,
    strafeThrustForce: phys.strafeAccel,
    heading: -Math.PI / 2,
    angularVelocity: 0,
    _physics: createShipPhysics(DEFAULT_PLAYER_CLASS),
  };
  initShipPhysicsFromShip(ship._physics!, ship);
  return ship;
}

export function respawnPlayer(player: Ship): void {
  const stats = (SHIP_CLASSES[player.shipClass || DEFAULT_PLAYER_CLASS] ?? SHIP_CLASSES.corvette!).stats;
  player.x = rand(200, WORLD_W - 200);
  player.y = rand(200, WORLD_H - 200);
  player.vx = 0; player.vy = 0;
  player.angle = -Math.PI / 2;
  player.targetAngle = -Math.PI / 2;
  player.alive = true;
  player.weapon = stats.weaponSlots[0]!;
  player.shootCooldown = 0;
  player.weaponHeat = 0;
  player.boostCooldown = 0;
  player.boostEnergy = 100;
  player.shieldMax = stats.shieldMax;
  player.shield = stats.shieldMax;
  player.armorMax = stats.armorMax;
  player.armor = stats.armorMax;
  player.shieldRegenDelay = 0;
  player.hp = stats.maxHp;
  player.maxHp = stats.maxHp;
  player.empTicks = 0;
  player.inputForward = 0;
  player.inputStrafe = 0;
  player.inputTurn = 0;
  player.boostQueued = false;
  player.iFrames = 60;
  player.heading = -Math.PI / 2;
  player.angularVelocity = 0;
  player._physics = createShipPhysics(player.shipClass || DEFAULT_PLAYER_CLASS);
  initShipPhysicsFromShip(player._physics, player);
  applyClassStats(player, player.shipClass || DEFAULT_PLAYER_CLASS);
}

export function resetPlayerFull(player: Ship): void {
  respawnPlayer(player);
  player.score = 0;
}

export function updateShipPhysics(ship: Ship, zoneBonus: Partial<ShipZoneBonus> | number = EMPTY_BONUS): void {
  const bonus = typeof zoneBonus === "number"
    ? { ...EMPTY_BONUS, heatCool: zoneBonus * 0.1, energyRegen: zoneBonus * 0.1, shieldDelay: zoneBonus }
    : { ...EMPTY_BONUS, ...zoneBonus };

  const empMul = ship.empTicks > 0 ? 0.48 : 1;
  if (ship.empTicks > 0) ship.empTicks--;

  const targetAngle = ship.targetAngle;
  const throttle = ship.inputForward;
  const strafe = ship.inputStrafe;

  let turn = ship.inputTurn ?? 0;
  if (turn === 0 && targetAngle !== undefined && targetAngle !== ship.angle) {
    const delta = shortestAngleDelta(ship.heading, targetAngle);
    turn = clamp(delta * 6.0, -1, 1);
  }

  // Ensure physics engine is initialized (required after hydration or AI spawn)
  if (!ship._physics) {
    ship._physics = createShipPhysics(ship.shipClass);
    initShipPhysicsFromShip(ship._physics, ship);
  }

  const modifiers: { empMul?: number; boostImpulse?: number } = { empMul };

  if (ship.boostQueued && ship.alive) {
    if (ship.boostCooldown <= 0 && ship.boostEnergy >= SHIP_BOOST_COST) {
      const impulse = (1.2 / Math.max(1, ship.mass)) * empMul;
      modifiers.boostImpulse = impulse;
      ship.boostEnergy -= SHIP_BOOST_COST;
      ship.boostCooldown = 120;
    }
    ship.boostQueued = false;
  }

  ship._physics.update(
    { throttle, strafe, turn, aimAngle: targetAngle },
    1 / 30.303,
    modifiers
  );

  syncShipToPhysics(ship, ship._physics!);

  if (ship.shootCooldown > 0) ship.shootCooldown--;
  if (ship.boostCooldown > 0) ship.boostCooldown--;
  if (ship.iFrames > 0) ship.iFrames--;

  const def = SHIP_CLASSES[ship.shipClass] ?? SHIP_CLASSES.corvette!;
  const stats = def.stats;
  const heatCoolRate = stats.heatCoolRate + (bonus?.heatCool ?? 0);
  ship.weaponHeat = Math.max(0, ship.weaponHeat - heatCoolRate);
  ship.boostEnergy = Math.min(100, ship.boostEnergy + stats.boostRegenRate + bonus.energyRegen);

  if (ship.shieldMax > 0 && ship.shield < ship.shieldMax) {
    if (ship.shieldRegenDelay > 0) {
      ship.shieldRegenDelay -= Math.max(1, 1 + bonus.shieldDelay);
      if (ship.shieldRegenDelay < 0) ship.shieldRegenDelay = 0;
    } else {
      ship.shield++;
      ship.shieldRegenDelay = stats.shieldRegenInterval;
    }
  } else if (ship.shield >= ship.shieldMax) {
    ship.shieldRegenDelay = 0;
  }

  ship.weaponHeat = clamp(ship.weaponHeat, 0, SHIP_HEAT_LIMIT + 40);
}

export interface DamageResult {
  dead: boolean;
  shieldHit: boolean;
  armorHit: boolean;
}

export function applyShipDamage(
  ship: Ship,
  damage: number,
  fromImpact = false,
  armorPierce = false,
): DamageResult {
  if (!ship.alive) return { dead: false, shieldHit: false, armorHit: false };
  if (ship.iFrames > 0 && !fromImpact) return { dead: false, shieldHit: false, armorHit: false };
  if (ship.godmode) return { dead: false, shieldHit: false, armorHit: false };

  const stats = (SHIP_CLASSES[ship.shipClass] ?? SHIP_CLASSES.corvette!).stats;
  // 1. Escudos (Absorción completa por carga)
  if (ship.shield > 0) {
    ship.shield = Math.max(0, ship.shield - 1);
    ship.shieldRegenDelay = stats.shieldRegenDelay;
    ship.iFrames = fromImpact ? 8 : 14;
    return { dead: false, shieldHit: true, armorHit: false };
  }

  // 2. Blindaje (mitigación consistente: cada punto de armadura absorbe al menos 1 daño)
  let hullDamage = damage;
  if (ship.armor > 0 && !armorPierce) {
    // La cantidad de daño que se absorbe es el mínimo entre la armadura actual y una porción de la misma
    const absorbable = Math.floor(ship.armor * 0.45);
    const absorbed = Math.max(1, Math.min(ship.armor, absorbable));
    ship.armor -= absorbed;
    hullDamage = Math.max(0, damage - absorbed);      // El daño sobrante llega al casco
  }

  ship.hp = Math.max(0, ship.hp - hullDamage);
  ship.iFrames = fromImpact ? 7 : 10;
  ship.shieldRegenDelay = Math.max(ship.shieldRegenDelay, stats.shieldRegenDelay);

  if (ship.hp <= 0) {
    ship.alive = false;
    return { dead: true, shieldHit: false, armorHit: ship.armor > 0 };
  }
  return { dead: false, shieldHit: false, armorHit: ship.armor > 0 };
}

// Interfaz para definir de manera estricta los resultados de la colisión
export interface CollisionResult {
  aHurt: boolean;
  bHurt: boolean;
}

export function resolveShipCollision(
  shipA: Ship,
  shipB: Ship,
): CollisionResult {
  const defA = SHIP_CLASSES[shipA.shipClass] ?? SHIP_CLASSES.corvette!;
  const defB = SHIP_CLASSES[shipB.shipClass] ?? SHIP_CLASSES.corvette!;

  const mtv = checkShipCollision(
    defA.rects, { x: shipA.x, y: shipA.y }, shipA.heading,
    defB.rects, { x: shipB.x, y: shipB.y }, shipB.heading,
  );
  if (!mtv) return { aHurt: false, bHurt: false };

  const { overlap, normal } = mtv;
  const nx = normal.x;
  const ny = normal.y;

  const massA = Math.max(1, shipA.mass);
  const massB = Math.max(1, shipB.mass);
  const totalMass = massA + massB;

  const pushA = overlap * (massB / totalMass);
  const pushB = overlap * (massA / totalMass);
  shipA.x += nx * pushA;
  shipA.y += ny * pushA;
  shipB.x -= nx * pushB;
  shipB.y -= ny * pushB;

  const relVelX = shipA.vx - shipB.vx;
  const relVelY = shipA.vy - shipB.vy;
  const vn = relVelX * nx + relVelY * ny;

  if (vn < 0) {
    const invMassSum = 1 / massA + 1 / massB;
    const impulse = -vn / invMassSum;
    shipA.vx += (impulse * nx) / massA;
    shipA.vy += (impulse * ny) / massA;
    shipB.vx -= (impulse * nx) / massB;
    shipB.vy -= (impulse * ny) / massB;
  }

  const relSpeed = Math.hypot(shipA.vx - shipB.vx, shipA.vy - shipB.vy);
  const isHurt = relSpeed > SHIP_COLLISION_DAMAGE_SPEED;

  return { aHurt: isHurt, bHurt: isHurt };
}

export function getWeaponSequenceForClass(shipClass: ShipClass): readonly WeaponKind[] {
  return (SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!).stats.weaponSlots;
}

export function cycleWeapon(ship: Ship): WeaponKind {
  const slots = getWeaponSequenceForClass(ship.shipClass);
  const idx = slots.indexOf(ship.weapon);
  ship.weapon = slots[(idx + 1) % slots.length]!;
  return ship.weapon;
}