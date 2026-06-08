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

export type { AttachmentPoint, ShipAttachments, Loadout, MountArc, PaletteIndex, PixelGrid, ShipBitmapKey } from "./ships/shipAttachments";

export { SHIP_ATTACHMENTS, DEFAULT_LOADOUTS } from "./ships/shipAttachments";
