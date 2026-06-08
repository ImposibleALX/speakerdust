export type WeaponKind =
  | "naval_cannon"
  | "autocannon"
  | "plasma_broadside"
  | "railgun"
  | "torpedo"
  | "guided_missile"
  | "energy_bomb"
  | "emp_launcher";

export type BulletKind = WeaponKind;
export type StatusEffect = "emp";

export type WeaponArc = "forward" | "broadside" | "omni";

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

export interface StaticRenderConfig {
  type: "static";
  bitmapId: string;
}

export interface DynamicRenderConfig {
  type: "dynamic";
  renderId: string;
}

export type WeaponRenderConfig = StaticRenderConfig | DynamicRenderConfig;

export interface WeaponDefinition {
  kind: WeaponKind;
  stats: WeaponStats;
  render: WeaponRenderConfig;
}

export const WEAPON_STATS: Record<WeaponKind, WeaponStats> = {
  naval_cannon: {
    cooldown: 52, heat: 22, damage: 3, speed: 8.5, life: 125, splashRadius: 30,
    chargeTicks: 0, recoil: 1.2, radius: 8, telegraphColor: "#ffd36a",
    arc: "forward", fireOffsets: [0], muzzleOffset: 28,
    role: "High-impact artillery shell",
  },
  autocannon: {
    cooldown: 18, heat: 8, damage: 2, speed: 10.5, life: 60, splashRadius: 4,
    chargeTicks: 0, recoil: 0.3, radius: 4, telegraphColor: "#a8ff78",
    arc: "forward", fireOffsets: [-0.04, 0.04], muzzleOffset: 24,
    role: "Close-range anti-corvette fire",
  },
  plasma_broadside: {
    cooldown: 74, heat: 32, damage: 4, speed: 5.8, life: 100, splashRadius: 44,
    chargeTicks: 16, recoil: 0.8, radius: 10, telegraphColor: "#d86bff",
    arc: "broadside", fireOffsets: [-Math.PI / 2, Math.PI / 2], muzzleOffset: 15,
    role: "Side-mounted area denial",
  },
  railgun: {
    cooldown: 100, heat: 46, damage: 8, speed: 18, life: 45, splashRadius: 18,
    chargeTicks: 26, recoil: 2.4, radius: 5, telegraphColor: "#7df9ff",
    arc: "forward", fireOffsets: [0], muzzleOffset: 32,
    role: "Long-range armor-piercing strike",
  },
  torpedo: {
    cooldown: 100, heat: 22, damage: 6, speed: 4.0, life: 180, splashRadius: 64,
    chargeTicks: 0, recoil: 0.5, radius: 12, turnRate: 0.018, telegraphColor: "#ff9030",
    arc: "forward", fireOffsets: [0], muzzleOffset: 30,
    role: "Slow avoidable ship killer",
  },
  guided_missile: {
    cooldown: 70, heat: 26, damage: 5, speed: 6.0, life: 150, splashRadius: 50,
    chargeTicks: 0, recoil: 0.4, radius: 9, turnRate: 0.06, telegraphColor: "#ff6a3d",
    arc: "omni", fireOffsets: [0], muzzleOffset: 20,
    role: "Tracking pressure with counterplay",
  },
  energy_bomb: {
    cooldown: 88, heat: 30, damage: 5, speed: 4.5, life: 88, splashRadius: 86,
    chargeTicks: 6, recoil: 0.5, radius: 11, detonateAtLife: 12, telegraphColor: "#ffe66d",
    arc: "omni", fireOffsets: [0], muzzleOffset: 0,
    role: "Delayed area control",
  },
  emp_launcher: {
    cooldown: 62, heat: 22, damage: 1, speed: 6.8, life: 105, splashRadius: 66,
    chargeTicks: 0, recoil: 0.3, radius: 9, statusEffect: "emp", telegraphColor: "#66ccff",
    arc: "omni", fireOffsets: [0], muzzleOffset: 22,
    role: "Utility disable pulse",
  },
};

export const WEAPON_DEFS: Record<WeaponKind, WeaponDefinition> = {
  naval_cannon: {
    kind: "naval_cannon",
    stats: WEAPON_STATS.naval_cannon,
    render: { type: "static", bitmapId: "naval_cannon" },
  },
  autocannon: {
    kind: "autocannon",
    stats: WEAPON_STATS.autocannon,
    render: { type: "static", bitmapId: "autocannon" },
  },
  plasma_broadside: {
    kind: "plasma_broadside",
    stats: WEAPON_STATS.plasma_broadside,
    render: { type: "dynamic", renderId: "plasma_bolt" },
  },
  railgun: {
    kind: "railgun",
    stats: WEAPON_STATS.railgun,
    render: { type: "dynamic", renderId: "railgun_shot" },
  },
  torpedo: {
    kind: "torpedo",
    stats: WEAPON_STATS.torpedo,
    render: { type: "dynamic", renderId: "torpedo" },
  },
  guided_missile: {
    kind: "guided_missile",
    stats: WEAPON_STATS.guided_missile,
    render: { type: "dynamic", renderId: "missile" },
  },
  energy_bomb: {
    kind: "energy_bomb",
    stats: WEAPON_STATS.energy_bomb,
    render: { type: "dynamic", renderId: "energy_bomb" },
  },
  emp_launcher: {
    kind: "emp_launcher",
    stats: WEAPON_STATS.emp_launcher,
    render: { type: "dynamic", renderId: "emp_pulse" },
  },
};

export const EMP_DURATION_TICKS = 80;
export const HITBOX_PLAYER_BULLET_DEFAULT_SQ = 18 * 18;
export const HITBOX_ENEMY_BULLET_SQ = 18 * 18;