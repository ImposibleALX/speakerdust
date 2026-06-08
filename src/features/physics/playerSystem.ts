// playerSystem.ts
// Player lifecycle and shared naval ship physics.

import {
  Ship, ShipClass,
  Team,
} from "../../core/ships/shipTypes";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { WORLD_W, WORLD_H } from "../../core/world/mapConfig";
import {
  DEFAULT_PLAYER_CLASS, SHIP_CLASS_STATS, classStats,
  SHIP_BOOST_COST, SHIP_BOOST_COOLDOWN,
  SHIP_COLLISION_DAMAGE_SPEED, SHIP_HEAT_LIMIT, collisionRadiusFor,
} from "../../core/ships/shipStats";
import type { ShipZoneBonus } from "../../core/world/zones";
import { clamp, rand, shortestAngleDelta } from "../../core/math";

const EMPTY_BONUS: ShipZoneBonus = {
  heatCool: 0,
  energyRegen: 0,
  shieldDelay: 0,
  repairEveryTicks: 0,
  scoreEveryTicks: 0,
  pressureScale: 1,
};

function applyClassStats(ship: Ship, shipClass: ShipClass): void {
  const stats = classStats(shipClass);
  ship.shipClass = shipClass;
  ship.role = stats.role;
  ship.mass = stats.mass;
  ship.turnRate = stats.turnRate;
  ship.drag = stats.drag;
  ship.maxSpeed = stats.maxSpeed;
  ship.thrustForce = stats.thrustForce;
  ship.strafeThrustForce = stats.strafeThrustForce;
  ship.weaponSlots = [...stats.weaponSlots];
  if (!ship.weaponSlots.includes(ship.weapon)) ship.weapon = ship.weaponSlots[0]!;
}

export function createPlayer(playerId: string, team: Team): Ship {
  const hue = Math.floor(Math.random() * 360);
  const stats = SHIP_CLASS_STATS[DEFAULT_PLAYER_CLASS];
  return {
    id: playerId,
    controller: "player",
    shipClass: DEFAULT_PLAYER_CLASS,
    role: stats.role,
    mass: stats.mass,
    turnRate: stats.turnRate,
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
    boostQueued: false,
    iFrames: 60,
    isAdmin: false,
    godmode: false,
    inputSeq: 0,
    drag: stats.drag,
    maxSpeed: stats.maxSpeed,
    thrustForce: stats.thrustForce,
    strafeThrustForce: stats.strafeThrustForce,
  };
}

export function respawnPlayer(player: Ship): void {
  const stats = classStats(player.shipClass || DEFAULT_PLAYER_CLASS);
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
  player.boostQueued = false;
  player.iFrames = 60;
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

  ship.angle += shortestAngleDelta(ship.angle, ship.targetAngle) * ship.turnRate * empMul;
  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  const rightX = -sin;
  const rightY = cos;

  ship.vx += cos * ship.inputForward * ship.thrustForce * empMul;
  ship.vy += sin * ship.inputForward * ship.thrustForce * empMul;
  ship.vx += rightX * ship.inputStrafe * ship.strafeThrustForce * empMul;
  ship.vy += rightY * ship.inputStrafe * ship.strafeThrustForce * empMul;

  if (ship.boostQueued && ship.alive) {
    if (ship.boostCooldown <= 0 && ship.boostEnergy >= SHIP_BOOST_COST) {
      const impulse = (1.2 / Math.max(1, ship.mass)) * empMul;
      ship.vx += cos * impulse;
      ship.vy += sin * impulse;
      ship.boostEnergy -= SHIP_BOOST_COST;
      ship.boostCooldown = SHIP_BOOST_COOLDOWN;
    }
    ship.boostQueued = false;
  }

  ship.vx *= ship.drag;
  ship.vy *= ship.drag;
  const spd = Math.hypot(ship.vx, ship.vy);
  if (spd > ship.maxSpeed) {
    const s = ship.maxSpeed / spd;
    ship.vx *= s; ship.vy *= s;
  }

  // La física es puramente acumulativa, sin limites de mapa.
  ship.x += ship.vx;
  ship.y += ship.vy;

  if (ship.shootCooldown > 0) ship.shootCooldown--;
  if (ship.boostCooldown > 0) ship.boostCooldown--;
  if (ship.iFrames > 0) ship.iFrames--;

  const stats = classStats(ship.shipClass);
  const heatCoolRate = stats.heatCoolRate + (bonus?.heatCool ?? 0);
  ship.weaponHeat = Math.max(0, ship.weaponHeat - heatCoolRate);
  ship.boostEnergy = Math.min(100, ship.boostEnergy + stats.boostRegenRate + bonus.energyRegen);

  if (ship.shieldMax > 0 && ship.shield < ship.shieldMax) {
    if (ship.shieldRegenDelay > 0) {
      ship.shieldRegenDelay -= Math.max(1, 1 + bonus.shieldDelay);
      // Aseguramos que el retardo nunca sea negativo
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

  const stats = classStats(ship.shipClass);
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
  const radA = collisionRadiusFor(shipA);
  const radB = collisionRadiusFor(shipB);
  const combined = radA + radB;

  const dx = shipA.x - shipB.x;
  const dy = shipA.y - shipB.y;
  const dist = Math.hypot(dx, dy) || 0.001;

  // Si no hay superposición, no hay daño para ninguno
  if (dist >= combined) return { aHurt: false, bHurt: false };

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = combined - dist;

  const massA = Math.max(1, shipA.mass);
  const massB = Math.max(1, shipB.mass);
  const totalMass = massA + massB;

  // Separación completa sin sobrereacción:
  // cada nave se desplaza proporcionalmente a la masa del otro.
  const pushA = overlap * (massB / totalMass);
  const pushB = overlap * (massA / totalMass);
  shipA.x += nx * pushA;
  shipA.y += ny * pushA;
  shipB.x -= nx * pushB;
  shipB.y -= ny * pushB;

  // Ajuste de velocidad: colisión perfectamente inelástica a lo largo de la normal.
  // Esto evita que las naves reboten indefinidamente y elimina el jitter.
  const relVelX = shipA.vx - shipB.vx;
  const relVelY = shipA.vy - shipB.vy;
  const vn = relVelX * nx + relVelY * ny;

  // Solo aplicamos impulso si se acercan (vn < 0)
  if (vn < 0) {
    const invMassSum = 1 / massA + 1 / massB;
    const impulse = -vn / invMassSum; // sin restitución = 0
    shipA.vx += (impulse * nx) / massA;
    shipA.vy += (impulse * ny) / massA;
    shipB.vx -= (impulse * nx) / massB;
    shipB.vy -= (impulse * ny) / massB;
  }

  // Daño por colisión si la velocidad relativa supera el umbral
  const relSpeed = Math.hypot(shipA.vx - shipB.vx, shipA.vy - shipB.vy);
  const isHurt = relSpeed > SHIP_COLLISION_DAMAGE_SPEED;

  return { aHurt: isHurt, bHurt: isHurt };
}

export function getWeaponSequenceForClass(shipClass: ShipClass): WeaponKind[] {
  return classStats(shipClass).weaponSlots;
}

export function cycleWeapon(ship: Ship): WeaponKind {
  const slots = getWeaponSequenceForClass(ship.shipClass);
  const idx = slots.indexOf(ship.weapon);
  ship.weapon = slots[(idx + 1) % slots.length]!;
  return ship.weapon;
}