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

export interface Ship {
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
  shootCooldown: number;
  weaponHeat: number;

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

  // Control
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

  // Player-only fields (defaults for AI)
  name: string;
  color: string;
  team: Team;
  score: number;
  isAdmin: boolean;
  godmode: boolean;
  inputSeq: number;
}

/** AI memory stored externally, keyed by ship id */
export interface AiState {
  targetId?: string;
  lastSeenPos?: { x: number; y: number };
  reactionTicks: number;
  aimJitter: number;
  maneuverTimer: number;
  maneuverDir: -1 | 1;
  strafing: boolean;
  frustration: number;
  wave: number;
  formationIndex: number;
}
