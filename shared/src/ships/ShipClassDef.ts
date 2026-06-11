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
  aimJitter: number;
  leadMul: number;
  aimNoise: number;
  maxAimError: number;
  seekSpeed: number;
  retreatSpeed: number;
  orbitPower: number;
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
