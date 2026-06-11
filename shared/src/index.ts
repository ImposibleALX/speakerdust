export type {
  WeaponKind,
  WeaponStats,
  BulletKind,
  StatusEffect,
  WeaponDefinition,
  WeaponRenderConfig,
  StaticRenderConfig,
  DynamicRenderConfig,
  WeaponArc,
} from "./weapons/weaponDefs";

export { WEAPON_DEFS, WEAPON_STATS, EMP_DURATION_TICKS, HITBOX_PLAYER_BULLET_DEFAULT_SQ, HITBOX_ENEMY_BULLET_SQ } from "./weapons/weaponDefs";

export type { ShipClassDef, ShipGameplayStats, ShipAI, ExplosionConfig } from "./ships";

export { SHIP_CLASSES } from "./ships";

export * from "./sprite";
export * from "./physics";
export { checkBulletHit, checkBeamHit } from "./collision/pixelCollision";
export type { CollisionGrid } from "./collision/pixelCollision";
export { decomposePixels, checkShipCollision } from "./collision/convexDecomposition";
export type { Rect } from "./collision/convexDecomposition";
