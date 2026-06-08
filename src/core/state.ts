import type { Projectile } from "./combat/projectiles";
import type { ControlPoint, ObjectiveKind, ZoneOwner } from "./world/zones";
import type { Controller, Ship, ShipClass, Team } from "./ships/shipTypes";

export interface GameState {
  ships: Record<string, Ship>;
  projectiles: Record<string, Projectile>;
  zones: Record<string, ControlPoint>;
  wave: number;
  tick: number;
}

export interface PublicShip {
  id: string;
  controller: Controller;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shield: number;
  shieldMax: number;
  alive: boolean;
  weapon: string;
  weaponSlots: string[];
  shipClass: ShipClass;
  role?: string;
  mass: number;
  turnRate: number;
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;
  boostEnergy: number;
  weaponHeat: number;
  empTicks: number;
  name?: string;
  color?: string;
  team?: Team;
  score?: number;
  isAdmin?: boolean;
  inputSeq?: number;
}

export interface PublicZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  label: string;
  objectiveKind: ObjectiveKind;
  owner: ZoneOwner;
  redProgress: number;
  blueProgress: number;
  enemyProgress: number;
}

export function toPublicShip(s: Ship): PublicShip {
  const pub: PublicShip = {
    id: s.id,
    controller: s.controller,
    x: Math.round(s.x * 10) / 10,
    y: Math.round(s.y * 10) / 10,
    vx: Math.round(s.vx * 100) / 100,
    vy: Math.round(s.vy * 100) / 100,
    angle: Math.round(s.angle * 100) / 100,
    hp: Math.round(s.hp),
    maxHp: s.maxHp,
    armor: Math.round(s.armor),
    armorMax: s.armorMax,
    shield: s.shield,
    shieldMax: s.shieldMax,
    alive: s.alive,
    weapon: s.weapon,
    weaponSlots: s.weaponSlots,
    shipClass: s.shipClass,
    role: s.role,
    mass: s.mass,
    turnRate: s.turnRate,
    drag: s.drag,
    maxSpeed: s.maxSpeed,
    thrustForce: s.thrustForce,
    strafeThrustForce: s.strafeThrustForce,
    boostEnergy: Math.round(s.boostEnergy),
    weaponHeat: Math.round(s.weaponHeat),
    empTicks: s.empTicks,
  };
  pub.name = s.name;
  pub.color = s.color;
  pub.team = s.team;
  pub.score = s.score;
  pub.isAdmin = s.isAdmin;
  pub.inputSeq = s.inputSeq;
  return pub;
}

export function toPublicZone(z: ControlPoint): PublicZone {
  return {
    id: z.id,
    x: z.x,
    y: z.y,
    radius: z.radius,
    label: z.label,
    objectiveKind: z.objectiveKind,
    owner: z.owner,
    redProgress: Math.round(z.redProgress),
    blueProgress: Math.round(z.blueProgress),
    enemyProgress: Math.round(z.enemyProgress),
  };
}
