import type { Ship, ShipClass } from "./shipTypes";

export interface ShipClassStats {
  label: string;
  role: string;
  maxHp: number;
  shieldMax: number;
  armorMax: number;
  mass: number;
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;
  turnRate: number;
  heatCoolRate: number;
  boostRegenRate: number;
  shieldRegenDelay: number;
  shieldRegenInterval: number;
  collisionRadius: number;
  weaponSlots: WeaponKind[];
}

import type { WeaponKind } from "../combat/weaponStats";
export const DEFAULT_PLAYER_CLASS: ShipClass = "corvette";

export const SHIP_CLASS_STATS: Record<ShipClass, ShipClassStats> = {
  corvette: {
    label: "Scout Corvette",
    role: "Fast screen ship",
    maxHp: 5, shieldMax: 2, armorMax: 1, mass: 1.0, drag: 0.982,
    maxSpeed: 3.6, thrustForce: 0.20, strafeThrustForce: 0.08,
    turnRate: 0.085, heatCoolRate: 0.65, boostRegenRate: 0.42,
    shieldRegenDelay: 120, shieldRegenInterval: 140, collisionRadius: 23,
    weaponSlots: ["autocannon", "naval_cannon", "guided_missile", "torpedo"],
  },
  destroyer: {
    label: "Destroyer", role: "Line combatant",
    maxHp: 8, shieldMax: 1, armorMax: 3, mass: 1.6, drag: 0.988,
    maxSpeed: 2.7, thrustForce: 0.16, strafeThrustForce: 0.035,
    turnRate: 0.055, heatCoolRate: 0.55, boostRegenRate: 0.38,
    shieldRegenDelay: 150, shieldRegenInterval: 190, collisionRadius: 30,
    weaponSlots: ["naval_cannon", "autocannon", "torpedo", "emp_launcher"],
  },
  missile_frigate: {
    label: "Missile Frigate", role: "Standoff pressure",
    maxHp: 7, shieldMax: 1, armorMax: 2, mass: 1.45, drag: 0.987,
    maxSpeed: 2.9, thrustForce: 0.17, strafeThrustForce: 0.04,
    turnRate: 0.06, heatCoolRate: 0.58, boostRegenRate: 0.40,
    shieldRegenDelay: 140, shieldRegenInterval: 170, collisionRadius: 28,
    weaponSlots: ["guided_missile", "torpedo", "autocannon", "emp_launcher"],
  },
  cruiser: {
    label: "Cruiser", role: "Area control",
    maxHp: 11, shieldMax: 2, armorMax: 4, mass: 2.3, drag: 0.991,
    maxSpeed: 2.15, thrustForce: 0.12, strafeThrustForce: 0.02,
    turnRate: 0.043, heatCoolRate: 0.48, boostRegenRate: 0.35,
    shieldRegenDelay: 180, shieldRegenInterval: 220, collisionRadius: 37,
    weaponSlots: ["plasma_broadside", "naval_cannon", "energy_bomb", "emp_launcher"],
  },
  battlecruiser: {
    label: "Battlecruiser", role: "Heavy pursuit",
    maxHp: 14, shieldMax: 2, armorMax: 5, mass: 2.8, drag: 0.992,
    maxSpeed: 1.95, thrustForce: 0.105, strafeThrustForce: 0.015,
    turnRate: 0.034, heatCoolRate: 0.45, boostRegenRate: 0.32,
    shieldRegenDelay: 200, shieldRegenInterval: 240, collisionRadius: 44,
    weaponSlots: ["railgun", "naval_cannon", "guided_missile", "plasma_broadside"],
  },
  battleship: {
    label: "Battleship", role: "Dominant artillery",
    maxHp: 18, shieldMax: 2, armorMax: 7, mass: 3.4, drag: 0.994,
    maxSpeed: 1.55, thrustForce: 0.08, strafeThrustForce: 0.008,
    turnRate: 0.027, heatCoolRate: 0.40, boostRegenRate: 0.30,
    shieldRegenDelay: 220, shieldRegenInterval: 280, collisionRadius: 52,
    weaponSlots: ["railgun", "plasma_broadside", "naval_cannon", "emp_launcher"],
  },
  dreadnought: {
    label: "Dreadnought", role: "Fleet anchor",
    maxHp: 26, shieldMax: 3, armorMax: 10, mass: 4.6, drag: 0.996,
    maxSpeed: 1.15, thrustForce: 0.055, strafeThrustForce: 0.004,
    turnRate: 0.018, heatCoolRate: 0.35, boostRegenRate: 0.25,
    shieldRegenDelay: 250, shieldRegenInterval: 320, collisionRadius: 66,
    weaponSlots: ["energy_bomb", "plasma_broadside", "railgun", "emp_launcher"],
  },
};

export const AI_STATS: Record<ShipClass, { score: number; idealRange: number }> = {
  corvette:        { score: 120,  idealRange: 250 },
  destroyer:       { score: 260,  idealRange: 330 },
  missile_frigate: { score: 320,  idealRange: 410 },
  cruiser:         { score: 520,  idealRange: 430 },
  battlecruiser:   { score: 700,  idealRange: 480 },
  battleship:      { score: 900,  idealRange: 520 },
  dreadnought:     { score: 2000, idealRange: 580 },
};

export const SHIP_BOOST_COST = 34;
export const SHIP_BOOST_COOLDOWN = 120;
export const SHIP_HEAT_LIMIT = 100;
export const SHIP_COLLISION_DAMAGE_SPEED = 5.8;

export function classStats(shipClass: ShipClass): ShipClassStats {
  return SHIP_CLASS_STATS[shipClass] ?? SHIP_CLASS_STATS.corvette;
}

export function collisionRadiusFor(ship: Pick<Ship, "shipClass">): number {
  return classStats(ship.shipClass).collisionRadius;
}
