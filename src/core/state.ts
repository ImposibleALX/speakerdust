import type { Bullet } from "./combat/weaponStats";
import type { ControlPoint, ObjectiveKind, ZoneOwner } from "./world/zones";
import type { AiKind, Controller, PlayerShip, Ship, ShipClass, Team } from "./ships/shipTypes";

export interface GameState {
  ships: Record<string, Ship>;
  bullets: Record<string, Bullet>;
  zones: Record<string, ControlPoint>;
  wave: number;
  tick: number;
}

export interface PublicShip {
  id: string;
  controller: Controller;
  x: number;
  y: number;
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
  boostEnergy: number;
  weaponHeat: number;
  empTicks: number;
  name?: string;
  color?: string;
  team?: Team;
  score?: number;
  isAdmin?: boolean;
  kind?: AiKind;
  aiFrustration?: number;
}

export interface PublicBullet {
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
    boostEnergy: Math.round(s.boostEnergy),
    weaponHeat: Math.round(s.weaponHeat),
    empTicks: s.empTicks,
  };
  if (s.controller === "player") {
    const player = s as PlayerShip;
    pub.name = player.name;
    pub.color = player.color;
    pub.team = player.team;
    pub.score = player.score;
    pub.isAdmin = player.isAdmin;
  } else {
    pub.kind = s.kind;
    pub.aiFrustration = Math.round(s.aiFrustration);
  }
  return pub;
}

export function toPublicBullet(b: Bullet): PublicBullet {
  return {
    id: b.id,
    ownerId: b.ownerId,
    ownerController: b.ownerController,
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    vx: Math.round(b.vx * 10) / 10,
    vy: Math.round(b.vy * 10) / 10,
    angle: Math.round(b.angle * 100) / 100,
    kind: b.kind,
    radius: b.radius,
  };
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
