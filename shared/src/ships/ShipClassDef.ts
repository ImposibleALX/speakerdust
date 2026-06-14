import type { WeaponKind } from "../weapons/weaponDefs";
import type { ShipConfig } from "../physics/shipPhysics";
import type { ShipVisualDef } from "./ShipVisualDef";

export interface ShipGameplayStats {
  label: string;
  role: string;
  maxHp: number;
  shieldMax: number;
  armorMax: number;
  heatCoolRate: number;
  boostRegenRate: number;
  shieldRegenDelay: number;
  shieldRegenInterval: number;
  weaponSlots: readonly WeaponKind[];
  score: number;
  idealRange: number;
}

export interface ShipAI {
  lockTicks: number;
  leadMul: number;
  aimTolerance: number;
  seekSpeed: number;
  retreatSpeed: number;
  orbitPower: number;
  boostAggression: number;
  evasionRange: number;
}

export interface ExplosionConfig {
  primaryColors: readonly string[];
  primaryCount: number;
  primarySize: number;
  scale: number;
  shakeIntensity: number;
  shakeDuration: number;
  screenShakeRadius: number;
}

export interface ShipClassDef {
  readonly physics: ShipConfig;
  readonly stats: ShipGameplayStats;
  readonly ai: ShipAI;
  readonly nearAudioDistance: number;
  readonly defaultLoadout: Record<string, WeaponKind>;
  readonly visual: ShipVisualDef;
}
