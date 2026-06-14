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

export { Ship } from "./Ship";

export { Turret } from "../combat/Turret";

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
  rangeState: "closing" | "combat" | "retreating";
  rangeStateTimer: number;
}
