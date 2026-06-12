import type { Controller } from "../ships/shipTypes";
import type { WeaponArc } from "./patterns";

export type WeaponKind =
  | "naval_cannon"
  | "autocannon"
  | "plasma_broadside"
  | "railgun"
  | "torpedo"
  | "guided_missile"
  | "energy_bomb"
  | "emp_launcher"
  | "point_defense";

export type BulletKind = WeaponKind;
export type StatusEffect = "emp";

export interface WeaponStats {
  cooldown: number;
  heat: number;
  damage: number;
  speed: number;
  life: number;
  splashRadius: number;
  chargeTicks: number;
  recoil: number;
  radius: number;
  turnRate?: number;
  statusEffect?: StatusEffect;
  detonateAtLife?: number;
  telegraphColor: string;
  arc: WeaponArc;
  fireOffsets: number[];
  muzzleOffset: number;
  role: string;
}

export interface Bullet {
  id: string;
  ownerId: string;
  ownerController: Controller;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  life: number;
  kind: BulletKind;
  targetId?: string;
  damage: number;
  splashRadius: number;
  radius: number;
  chargeOwnerId?: string;
  statusEffect?: StatusEffect;
  detonateAtLife?: number;
  turnRate?: number;
}

export const WEAPON_STATS: Record<WeaponKind, WeaponStats> = {
  naval_cannon: {
    cooldown: 54, heat: 24, damage: 3, speed: 8.2, life: 120, splashRadius: 28,
    chargeTicks: 0, recoil: 0, radius: 8, telegraphColor: "#ffd36a",
    arc: "forward", fireOffsets: [0], muzzleOffset: 28,
    role: "High-impact artillery shell",
  },
  autocannon: {
    cooldown: 16, heat: 7, damage: 2, speed: 10.5, life: 65, splashRadius: 4,
    chargeTicks: 0, recoil: 0, radius: 4, telegraphColor: "#a8ff78",
    arc: "forward", fireOffsets: [-0.04, 0.04], muzzleOffset: 24,
    role: "Close-range anti-corvette fire",
  },
  plasma_broadside: {
    cooldown: 82, heat: 34, damage: 2, speed: 5.4, life: 95, splashRadius: 42,
    chargeTicks: 18, recoil: 0, radius: 10, telegraphColor: "#d86bff",
    arc: "broadside", fireOffsets: [-Math.PI / 2, Math.PI / 2], muzzleOffset: 15,
    role: "Side-mounted area denial",
  },
  railgun: {
    cooldown: 104, heat: 48, damage: 7, speed: 18, life: 48, splashRadius: 18,
    chargeTicks: 28, recoil: 0, radius: 5, telegraphColor: "#7df9ff",
    arc: "forward", fireOffsets: [0], muzzleOffset: 32,
    role: "Long-range armor-piercing strike",
  },
  torpedo: {
    cooldown: 96, heat: 20, damage: 8, speed: 3.4, life: 190, splashRadius: 82,
    chargeTicks: 0, recoil: 0, radius: 12, turnRate: 0.018, telegraphColor: "#ff9030",
    arc: "forward", fireOffsets: [0], muzzleOffset: 30,
    role: "Slow avoidable ship killer",
  },
  guided_missile: {
    cooldown: 72, heat: 26, damage: 4, speed: 5.7, life: 150, splashRadius: 48,
    chargeTicks: 0, recoil: 0, radius: 9, turnRate: 0.055, telegraphColor: "#ff6a3d",
    arc: "omni", fireOffsets: [0], muzzleOffset: 20,
    role: "Tracking pressure with counterplay",
  },
  energy_bomb: {
    cooldown: 90, heat: 32, damage: 4, speed: 4.0, life: 84, splashRadius: 92,
    chargeTicks: 8, recoil: 0, radius: 11, detonateAtLife: 10, telegraphColor: "#ffe66d",
    arc: "omni", fireOffsets: [0], muzzleOffset: 0,
    role: "Delayed area control",
  },
  emp_launcher: {
    cooldown: 76, heat: 24, damage: 1, speed: 6.4, life: 100, splashRadius: 58,
    chargeTicks: 0, recoil: 0, radius: 9, statusEffect: "emp", telegraphColor: "#66ccff",
    arc: "omni", fireOffsets: [0], muzzleOffset: 22,
    role: "Utility disable pulse",
  },
  point_defense: {
    cooldown: 8, heat: 4, damage: 1, speed: 14, life: 25, splashRadius: 0,
    chargeTicks: 0, recoil: 0, radius: 2, telegraphColor: "#66ffcc",
    arc: "omni", fireOffsets: [0], muzzleOffset: 0,
    role: "Auto-targeting point defense",
  },
};

export const PLAYER_WEAPON_SEQUENCE: WeaponKind[] = [
  "naval_cannon",
  "autocannon",
  "torpedo",
  "railgun",
];

export const EMP_DURATION_TICKS = 80;

