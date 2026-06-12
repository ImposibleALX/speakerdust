import type { WeaponKind } from "../weapons/weaponDefs";
import type { ShipConfig } from "../physics/shipPhysics";
import type { Attachment } from "../sprite/spriteTypes";

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
  /** How many ticks to lock target before tracking perfectly */
  lockTicks: number;
  /** Lead multiplier for aim prediction */
  leadMul: number;
  /** Angular tolerance in radians for considering a shot on-target */
  aimTolerance: number;
  /** Speed multiplier when closing to ideal range */
  seekSpeed: number;
  /** Speed multiplier when backing away from ideal range */
  retreatSpeed: number;
  /** Lateral movement power for orbit/evasion */
  orbitPower: number;
  /** Whether this ship uses boost aggressively */
  boostAggression: number;
  /** Distance at which ship starts evading (0 = never) */
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
  readonly explosion: ExplosionConfig;
  readonly nearAudioDistance: number;
  readonly paletteKey: "scout" | "cruiser" | "capital";
  readonly glowColor: string;
  readonly pixels: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly attachments: readonly Attachment[];
  readonly spriteCenter: { readonly x: number; readonly y: number };
  readonly boundingRadius: number;
  readonly defaultLoadout: Record<string, WeaponKind>;
}
