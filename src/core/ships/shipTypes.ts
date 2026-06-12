import type { WeaponKind } from "../combat/weaponStats";
import type { MountArc } from "../combat/patterns";

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

export { Ship } from "./Ship";

export interface TurretMount {
  attachmentId: string;
  weaponKind: WeaponKind;
  mountArc: MountArc;
  x: number;
  y: number;
  size: "small" | "medium" | "large";
  restAngle: number;
  angle: number;
  targetAngle: number;
  cooldown: number;
  heat: number;
  enabled: boolean;
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
