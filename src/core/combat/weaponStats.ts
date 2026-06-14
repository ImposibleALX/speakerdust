import type { WeaponKind } from "@speakerdust/shared";

export type { WeaponKind, WeaponStats, StatusEffect, WeaponArc, MovementType, GuidanceType } from "@speakerdust/shared";
export { WEAPON_STATS, EMP_DURATION_TICKS } from "@speakerdust/shared";
export type ProjectileKind = WeaponKind;

export const PLAYER_WEAPON_SEQUENCE: WeaponKind[] = [
  "naval_cannon",
  "autocannon",
  "torpedo",
  "railgun",
];
