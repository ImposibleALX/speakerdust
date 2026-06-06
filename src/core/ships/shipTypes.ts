import type { WeaponKind } from "../combat/weaponStats";

export type Controller = "player" | "ai";
export type Team = "red" | "blue" | "spectator";

export type ShipClass =
  | "corvette"
  | "destroyer"
  | "missile_frigate"
  | "cruiser"
  | "battlecruiser"
  | "battleship"
  | "dreadnought";

export type AiKind =
  | "corvette"
  | "destroyer"
  | "frigate"
  | "cruiser"
  | "battleship"
  | "dreadnought";

export interface BaseShip {
  id: string;
  controller: Controller;
  shipClass: ShipClass;
  role?: string;
  mass: number;
  turnRate: number;
  weaponSlots: WeaponKind[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  targetAngle: number;
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shieldMax: number;
  shield: number;
  shieldRegenDelay: number;
  weapon: WeaponKind;
  shootCooldown: number;
  weaponHeat: number;
  boostEnergy: number;
  boostCooldown: number;
  boostQueued: boolean;
  empTicks: number;
  inputForward: number;
  inputStrafe: number;
  iFrames: number;
  alive: boolean;
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;
}

export interface PlayerShip extends BaseShip {
  controller: "player";
  name: string;
  color: string;
  team: Team;
  score: number;
  isAdmin: boolean;
}

export interface EnemyShip extends BaseShip {
  controller: "ai";
  kind: AiKind;
  wave: number;
  formationIndex: number;
  aiTargetId?: string;
  aiLastSeenPos?: { x: number; y: number };
  aiReactionTicks: number;
  aiAimJitter: number;
  aiManeuverTimer: number;
  aiManeuverDir: number;
  aiStrafing: boolean;
  aiFrustration: number;
}

export type Ship = PlayerShip | EnemyShip;
