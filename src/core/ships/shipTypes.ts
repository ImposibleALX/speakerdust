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

  /** Flavour text describing the intended combat role */
  role?: string;

  // ========== Física y movilidad ==========
  mass: number;
  turnRate: number;
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;

  // ========== Armamento ==========
  weaponSlots: WeaponKind[];
  weapon: WeaponKind;
  shootCooldown: number;
  weaponHeat: number;

  // ========== Defensa y vida ==========
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shieldMax: number;
  shield: number;
  shieldRegenDelay: number;
  iFrames: number;

  // ========== Energía y turbo ==========
  boostEnergy: number;
  boostCooldown: number;
  boostQueued: boolean;

  // ========== Estados ==========
  empTicks: number;
  alive: boolean;

  // ========== Control ==========
  inputForward: number;
  inputStrafe: number;
  angle: number;
  targetAngle: number;
  x: number;
  y: number;
  vx: number;
  vy: number;

  // ====== Atributos estratégicos opcionales (caché de rendimiento) ======
  /** Velocidad de enfriamiento de calor; si no se define se usa classStats */
  heatCoolRate?: number;
  /** Intervalo entre regeneraciones de escudo; si no se define se usa classStats */
  shieldRegenInterval?: number;
  /** Tasa de regeneración de energía de turbo; si no se define se usa classStats */
  boostRegenRate?: number;
}

export interface PlayerShip extends BaseShip {
  controller: "player";
  name: string;
  color: string;
  team: Team;
  score: number;
  isAdmin: boolean;
  godmode: boolean;
  inputSeq: number;
}

export interface EnemyShip extends BaseShip {
  controller: "ai";
  kind: AiKind;
  wave: number;
  formationIndex: number;

  // IA específica
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