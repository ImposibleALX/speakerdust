import type { WeaponKind } from "../weapons/weaponDefs";

export type MountArc = "forward" | "broadside" | "omni";

export interface AttachmentPoint {
  id: string;
  x: number;
  y: number;
  mountArc: MountArc;
  size: "small" | "medium" | "large";
}

export interface ShipAttachments {
  engines: AttachmentPoint[];
  weapons: AttachmentPoint[];
}

export type Loadout = Record<string, WeaponKind>;

export type PaletteIndex = number;

export type PixelGrid = PaletteIndex[][];

export type ShipBitmapKey = "player" | "scout" | "cruiser" | "capital";
