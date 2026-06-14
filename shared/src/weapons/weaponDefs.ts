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

export type WeaponArc = "forward" | "broadside" | "omni";
export type MovementType = "instant" | "physical" | "stationary";
export type GuidanceType = "none" | "guided";

export interface WeaponStats {
  cooldown: number;
  heat: number;
  chargeTicks: number;
  damage: number;
  armorPierce: boolean;
  splashDamage: number;
  splashRadius: number;
  speed: number;
  life: number;
  radius: number;
  recoil: number;
  turnRate?: number;
  statusEffect?: StatusEffect;
  detonateAtLife?: number;
  telegraphColor: string;
  arc: WeaponArc;
  movement: MovementType;
  guidance: GuidanceType;
  interceptable: boolean;
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

export interface NoRenderConfig {
  type: "none";
}

export type WeaponRenderConfig = StaticRenderConfig | DynamicRenderConfig | NoRenderConfig;

export interface WeaponDefinition {
  kind: WeaponKind;
  stats: WeaponStats;
  render: WeaponRenderConfig;
  hasSprite: boolean;
}

export const WEAPON_STATS: Record<WeaponKind, WeaponStats> = {
  naval_cannon: {
    cooldown: 45, heat: 12, damage: 4, splashDamage: 2, splashRadius: 30, armorPierce: false,
    speed: 9.5, life: 120, radius: 8, recoil: 2.5, chargeTicks: 0,
    telegraphColor: "#cfd8dc", // Plata elegante / Silver
    arc: "forward",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Artillería pesada de impacto gemelo",
  },
  autocannon: {
    cooldown: 12, heat: 3, damage: 2, splashDamage: 0, splashRadius: 0, armorPierce: false,
    speed: 12.0, life: 70, radius: 4, recoil: 0.3, chargeTicks: 0,
    telegraphColor: "#00e676", // Verde Esmeralda Neón
    arc: "forward",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Supresión anti-corbeta de alta cadencia",
  },
  plasma_broadside: {
    cooldown: 65, heat: 16, damage: 3, splashDamage: 3, splashRadius: 45, armorPierce: false,
    speed: 6.0, life: 100, radius: 10, recoil: 1.0, chargeTicks: 12,
    telegraphColor: "#b388ff", // Violeta Profundo / Amatista
    arc: "broadside",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Control de área lateral con plasma",
  },
  railgun: {
    cooldown: 85, heat: 22, damage: 8, splashDamage: 0, splashRadius: 20, armorPierce: true,
    speed: 22, life: 55, radius: 5, recoil: 5.0, chargeTicks: 24,
    telegraphColor: "#00e5ff", // Cyan brillante / Neón
    arc: "forward",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Francotirador perforablindaje a larga distancia",
  },
  torpedo: {
    cooldown: 80, heat: 10, damage: 9, splashDamage: 8, splashRadius: 85, armorPierce: false,
    speed: 7.0, life: 115, radius: 12, recoil: 0.8, chargeTicks: 0, turnRate: 0.10,
    telegraphColor: "#448aff", // Azul Zafiro luminoso
    arc: "forward",
    movement: "physical", guidance: "guided", interceptable: true,
    role: "Destructor de naves insignia evitable pero letal",
  },
  guided_missile: {
    cooldown: 55, heat: 14, damage: 3, splashDamage: 3, splashRadius: 50, armorPierce: false,
    speed: 11.0, life: 95, radius: 8, recoil: 0.5, chargeTicks: 0, turnRate: 0.15,
    telegraphColor: "#d500f9", // Magenta futurista
    arc: "omni",
    movement: "physical", guidance: "guided", interceptable: true,
    role: "Presión de seguimiento en enjambre",
  },
  energy_bomb: {
    cooldown: 75, heat: 18, damage: 6, splashDamage: 6, splashRadius: 100, armorPierce: false,
    speed: 4.5, life: 80, radius: 11, recoil: 0, chargeTicks: 5, detonateAtLife: 10,
    telegraphColor: "#ea80fc", // Púrpura eléctrico
    arc: "omni",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Bomba de control de área retrasada",
  },
  emp_launcher: {
    cooldown: 60, heat: 12, damage: 1, splashDamage: 1, splashRadius: 60, armorPierce: true,
    speed: 7.0, life: 100, radius: 9, recoil: 0.5, chargeTicks: 0, statusEffect: "emp",
    telegraphColor: "#84ffff", // Hielo / Cyan claro
    arc: "omni",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Pulso inmovilizador de área (Starburst)",
  },
  point_defense: {
    cooldown: 6, heat: 0, damage: 1, splashDamage: 0, splashRadius: 0, armorPierce: false,
    speed: 18, life: 30, radius: 2, recoil: 0.1, chargeTicks: 0,
    telegraphColor: "#ffffff", // Blanco puro para los láseres defensivos
    arc: "omni",
    movement: "physical", guidance: "none", interceptable: false,
    role: "Red de defensa automatizada impecable",
  },
};

export const WEAPON_DEFS: Record<WeaponKind, WeaponDefinition> = {
  naval_cannon: {
    kind: "naval_cannon", hasSprite: true,
    stats: WEAPON_STATS.naval_cannon,
    render: { type: "static", bitmapId: "naval_cannon" },
  },
  autocannon: {
    kind: "autocannon", hasSprite: false,
    stats: WEAPON_STATS.autocannon,
    render: { type: "none" },
  },
  plasma_broadside: {
    kind: "plasma_broadside", hasSprite: true,
    stats: WEAPON_STATS.plasma_broadside,
    render: { type: "dynamic", renderId: "plasma_bolt" },
  },
  railgun: {
    kind: "railgun", hasSprite: false,
    stats: WEAPON_STATS.railgun,
    render: { type: "none" },
  },
  torpedo: {
    kind: "torpedo", hasSprite: true,
    stats: WEAPON_STATS.torpedo,
    render: { type: "dynamic", renderId: "torpedo" },
  },
  guided_missile: {
    kind: "guided_missile", hasSprite: true,
    stats: WEAPON_STATS.guided_missile,
    render: { type: "dynamic", renderId: "missile" },
  },
  energy_bomb: {
    kind: "energy_bomb", hasSprite: true,
    stats: WEAPON_STATS.energy_bomb,
    render: { type: "dynamic", renderId: "energy_bomb" },
  },
  emp_launcher: {
    kind: "emp_launcher", hasSprite: true,
    stats: WEAPON_STATS.emp_launcher,
    render: { type: "dynamic", renderId: "emp_pulse" },
  },
  point_defense: {
    kind: "point_defense", hasSprite: true,
    stats: WEAPON_STATS.point_defense,
    render: { type: "static", bitmapId: "point_defense" },
  },
};

export const EMP_DURATION_TICKS = 80;