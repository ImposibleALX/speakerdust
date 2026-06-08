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

export const SHIP_ATTACHMENTS: Record<string, ShipAttachments> = {
  player: {
    engines: [
      { id: "engine_main", x: 0, y: 8, mountArc: "forward", size: "medium" },
    ],
    weapons: [
      { id: "mount_front", x: 0, y: -8, mountArc: "forward", size: "medium" },
      { id: "mount_left", x: -4, y: 0, mountArc: "broadside", size: "small" },
      { id: "mount_right", x: 4, y: 0, mountArc: "broadside", size: "small" },
    ],
  },
  scout: {
    engines: [
      { id: "engine_main", x: 0, y: 5, mountArc: "forward", size: "small" },
    ],
    weapons: [
      { id: "mount_front", x: 0, y: -5, mountArc: "forward", size: "small" },
    ],
  },
  cruiser: {
    engines: [
      { id: "engine_left", x: -2, y: 6.5, mountArc: "forward", size: "medium" },
      { id: "engine_right", x: 2, y: 6.5, mountArc: "forward", size: "medium" },
    ],
    weapons: [
      { id: "mount_front", x: 0, y: -6.5, mountArc: "forward", size: "large" },
      { id: "mount_left", x: -5, y: -0.5, mountArc: "broadside", size: "medium" },
      { id: "mount_right", x: 5, y: -0.5, mountArc: "broadside", size: "medium" },
    ],
  },
  capital: {
    engines: [
      { id: "engine_left", x: -2, y: 9, mountArc: "forward", size: "large" },
      { id: "engine_right", x: 2, y: 9, mountArc: "forward", size: "large" },
    ],
    weapons: [
      { id: "mount_front", x: 0, y: -9, mountArc: "forward", size: "large" },
      { id: "mount_left", x: -6, y: -1, mountArc: "broadside", size: "large" },
      { id: "mount_right", x: 6, y: -1, mountArc: "broadside", size: "large" },
    ],
  },
};

export const DEFAULT_LOADOUTS: Record<string, Loadout> = {
  player: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "autocannon" },
  corvette: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "autocannon" },
  destroyer: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "torpedo" },
  missile_frigate: { mount_front: "guided_missile", mount_left: "autocannon", mount_right: "emp_launcher" },
  cruiser: { mount_front: "plasma_broadside", mount_left: "naval_cannon", mount_right: "energy_bomb" },
  battlecruiser: { mount_front: "railgun", mount_left: "naval_cannon", mount_right: "guided_missile" },
  battleship: { mount_front: "naval_cannon", mount_left: "railgun", mount_right: "plasma_broadside" },
  dreadnought: { mount_front: "railgun", mount_left: "plasma_broadside", mount_right: "naval_cannon" },
  scout: { mount_front: "autocannon" },
};
