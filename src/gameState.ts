// gameState.ts
// Unified types, naval tuning tables, pure helpers, and public serializers.

// Environment
export interface Env {
  /** Set via: wrangler secret put ADMIN_KEY */
  ADMIN_KEY: string;
  /** Durable Object binding declared in wrangler.json */
  GAME_ROOM: DurableObjectNamespace;
}

// Primitive types
export interface Vec2 { x: number; y: number; }

export type Controller = "player" | "ai";
export type Team = "red" | "blue" | "spectator";
export type ZoneOwner = "neutral" | "red" | "blue" | "enemies";

export type ShipClass =
  | "corvette"
  | "destroyer"
  | "missile_frigate"
  | "cruiser"
  | "battlecruiser"
  | "battleship"
  | "dreadnought";

export type AiKind =
  | "corvette"
  | "destroyer"
  | "frigate"
  | "cruiser"
  | "battleship"
  | "dreadnought";

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
export type ObjectiveKind =
  | "resource_platform"
  | "comms_relay"
  | "energy_refinery"
  | "naval_base"
  | "radar_station"
  | "supply_convoy";

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
  role: string;
}

export interface ShipClassStats {
  label: string;
  role: string;
  maxHp: number;
  shieldMax: number;
  armorMax: number;
  mass: number;
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;
  turnRate: number;
  heatCoolRate: number;
  boostRegenRate: number;
  shieldRegenDelay: number;
  shieldRegenInterval: number;
  collisionRadius: number;
  weaponSlots: WeaponKind[];
}

// Unified Ship
export interface BaseShip {
  id: string;
  controller: Controller;

  // Class identity
  shipClass: ShipClass;
  role?: string;
  mass: number;
  turnRate: number;
  weaponSlots: WeaponKind[];

  // Position and velocity
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  targetAngle: number;

  // Health
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shieldMax: number;
  shield: number;
  shieldRegenDelay: number;

  // Weapons
  weapon: WeaponKind;
  shootCooldown: number;
  weaponHeat: number;

  // Engine surge
  boostEnergy: number;
  boostCooldown: number;
  boostQueued: boolean;

  // Status effects
  empTicks: number;

  // Input state
  inputForward: number;
  inputStrafe: number;

  // Misc
  iFrames: number;
  alive: boolean;

  // Per-ship physics parameters
  drag: number;
  maxSpeed: number;
  thrustForce: number;
  strafeThrustForce: number;
}

export interface PlayerShip extends BaseShip {
  controller: "player";
  name: string;
  color: string;
  team: Team;
  score: number;
  isAdmin: boolean;
}

export interface EnemyShip extends BaseShip {
  controller: "ai";
  kind: AiKind;
  wave: number;
  formationIndex: number;
  // --- Memoria y comportamiento humano ---
  aiTargetId?: string;                // a quién está siguiendo
  aiLastSeenPos?: { x: number; y: number }; // última posición conocida del blanco
  aiReactionTicks: number;            // retraso en apuntar (disminuye cada tick)
  aiAimJitter: number;                // error angular aleatorio
  aiManeuverTimer: number;            // temporizador para cambiar patrón de movimiento
  aiManeuverDir: number;              // dirección de órbita (-1 o 1)
  aiStrafing: boolean;                // ¿está haciendo strafing lateral?
  aiFrustration: number;              // crece si no acierta, provoca cambios de blanco
}

export type Ship = PlayerShip | EnemyShip;

// Unified projectile. ownerController determines legal targets.
export interface Bullet {
  id: string;
  ownerId: string;
  ownerController: Controller;
  x: number; y: number;
  vx: number; vy: number;
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

export interface ControlPoint {
  id: string;
  x: number;
  y: number;
  radius: number;
  owner: ZoneOwner;
  redProgress: number;
  blueProgress: number;
  enemyProgress: number;
  label: string;
  objectiveKind: ObjectiveKind;
}

export interface GameState {
  ships: Record<string, Ship>;
  bullets: Record<string, Bullet>;
  zones: Record<string, ControlPoint>;
  wave: number;
  tick: number;
}

export interface ShipZoneBonus {
  heatCool: number;
  energyRegen: number;
  shieldDelay: number;
  repairEveryTicks: number;
  scoreEveryTicks: number;
  pressureScale: number;
}

// Public wire types
export interface PublicShip {
  id: string;
  controller: Controller;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  armor: number;
  armorMax: number;
  shield: number;
  shieldMax: number;
  alive: boolean;
  weapon: string;
  weaponSlots: string[];
  shipClass: ShipClass;
  role?: string;
  mass: number;
  boostEnergy: number;
  weaponHeat: number;
  empTicks: number;
  name?: string;
  color?: string;
  team?: Team;
  score?: number;
  isAdmin?: boolean;
  kind?: AiKind;
  aiFrustration?: number;
}

export interface PublicBullet {
  id: string;
  ownerId: string;
  ownerController: Controller;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  kind: string;
  radius: number;
}

export interface PublicZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  label: string;
  objectiveKind: ObjectiveKind;
  owner: ZoneOwner;
  redProgress: number;
  blueProgress: number;
  enemyProgress: number;
}

// Constants
// WORLD_W/H ahora son solo para el spawn inicial y referencia HUD. 
// La física soporta coordenadas infinitas.
export const WORLD_W = 1200;
export const WORLD_H = 800;
export const TICK_MS = 33;

export const SNAPSHOT_VERSION = 4;
export const SNAPSHOT_KEY = "speakerdust:state:v4";
export const SAVE_EVERY_TICKS = 30;

export const DEFAULT_PLAYER_CLASS: ShipClass = "corvette";

export const SHIP_CLASS_STATS: Record<ShipClass, ShipClassStats> = {
  corvette: {
    label: "Scout Corvette",
    role: "Fast screen ship",
    maxHp: 5,
    shieldMax: 2,
    armorMax: 1,
    mass: 1.0,
    drag: 0.982,
    maxSpeed: 3.6,
    thrustForce: 0.22,
    strafeThrustForce: 0.08,
    turnRate: 0.085,
    heatCoolRate: 0.65,
    boostRegenRate: 0.42,
    shieldRegenDelay: 120,
    shieldRegenInterval: 140,
    collisionRadius: 23,
    weaponSlots: ["naval_cannon", "autocannon", "torpedo", "railgun"],
  },
  destroyer: {
    label: "Destroyer",
    role: "Line combatant",
    maxHp: 8,
    shieldMax: 1,
    armorMax: 3,
    mass: 1.6,
    drag: 0.988,
    maxSpeed: 2.7,
    thrustForce: 0.16,
    strafeThrustForce: 0.035,
    turnRate: 0.055,
    heatCoolRate: 0.55,
    boostRegenRate: 0.38,
    shieldRegenDelay: 150,
    shieldRegenInterval: 190,
    collisionRadius: 30,
    weaponSlots: ["naval_cannon", "autocannon", "torpedo", "emp_launcher"],
  },
  missile_frigate: {
    label: "Missile Frigate",
    role: "Standoff pressure",
    maxHp: 7,
    shieldMax: 1,
    armorMax: 2,
    mass: 1.45,
    drag: 0.987,
    maxSpeed: 2.9,
    thrustForce: 0.17,
    strafeThrustForce: 0.04,
    turnRate: 0.06,
    heatCoolRate: 0.58,
    boostRegenRate: 0.40,
    shieldRegenDelay: 140,
    shieldRegenInterval: 170,
    collisionRadius: 28,
    weaponSlots: ["guided_missile", "torpedo", "autocannon", "emp_launcher"],
  },
  cruiser: {
    label: "Cruiser",
    role: "Area control",
    maxHp: 11,
    shieldMax: 2,
    armorMax: 4,
    mass: 2.2,
    drag: 0.991,
    maxSpeed: 2.15,
    thrustForce: 0.12,
    strafeThrustForce: 0.02,
    turnRate: 0.043,
    heatCoolRate: 0.48,
    boostRegenRate: 0.35,
    shieldRegenDelay: 180,
    shieldRegenInterval: 220,
    collisionRadius: 37,
    weaponSlots: ["plasma_broadside", "naval_cannon", "energy_bomb", "railgun"],
  },
  battlecruiser: {
    label: "Battlecruiser",
    role: "Heavy pursuit",
    maxHp: 14,
    shieldMax: 2,
    armorMax: 5,
    mass: 2.7,
    drag: 0.992,
    maxSpeed: 1.95,
    thrustForce: 0.105,
    strafeThrustForce: 0.015,
    turnRate: 0.036,
    heatCoolRate: 0.45,
    boostRegenRate: 0.32,
    shieldRegenDelay: 200,
    shieldRegenInterval: 240,
    collisionRadius: 44,
    weaponSlots: ["railgun", "naval_cannon", "guided_missile", "plasma_broadside"],
  },
  battleship: {
    label: "Battleship",
    role: "Dominant artillery",
    maxHp: 18,
    shieldMax: 2,
    armorMax: 7,
    mass: 3.4,
    drag: 0.994,
    maxSpeed: 1.55,
    thrustForce: 0.08,
    strafeThrustForce: 0.008,
    turnRate: 0.027,
    heatCoolRate: 0.40,
    boostRegenRate: 0.30,
    shieldRegenDelay: 220,
    shieldRegenInterval: 280,
    collisionRadius: 52,
    weaponSlots: ["naval_cannon", "railgun", "plasma_broadside", "energy_bomb"],
  },
  dreadnought: {
    label: "Dreadnought",
    role: "Fleet anchor",
    maxHp: 26,
    shieldMax: 3,
    armorMax: 10,
    mass: 4.6,
    drag: 0.996,
    maxSpeed: 1.15,
    thrustForce: 0.055,
    strafeThrustForce: 0.004,
    turnRate: 0.018,
    heatCoolRate: 0.35,
    boostRegenRate: 0.25,
    shieldRegenDelay: 250,
    shieldRegenInterval: 320,
    collisionRadius: 66,
    weaponSlots: ["railgun", "plasma_broadside", "naval_cannon", "energy_bomb"],
  },
};

export const WEAPON_STATS: Record<WeaponKind, WeaponStats> = {
  naval_cannon: {
    cooldown: 54, heat: 24, damage: 3, speed: 8.2, life: 120, splashRadius: 28,
    chargeTicks: 0, recoil: 1.15, radius: 8, telegraphColor: "#ffd36a",
    arc: "forward", role: "High-impact artillery shell",
  },
  autocannon: {
    cooldown: 16, heat: 7, damage: 2, speed: 10.5, life: 65, splashRadius: 4,
    chargeTicks: 0, recoil: 0.25, radius: 4, telegraphColor: "#a8ff78",
    arc: "forward", role: "Close-range anti-corvette fire",
  },
  plasma_broadside: {
    cooldown: 82, heat: 34, damage: 2, speed: 5.4, life: 95, splashRadius: 42,
    chargeTicks: 18, recoil: 0.7, radius: 10, telegraphColor: "#d86bff",
    arc: "broadside", role: "Side-mounted area denial",
  },
  railgun: {
    cooldown: 104, heat: 48, damage: 7, speed: 18, life: 48, splashRadius: 18,
    chargeTicks: 28, recoil: 2.2, radius: 5, telegraphColor: "#7df9ff",
    arc: "forward", role: "Long-range armor-piercing strike",
  },
  torpedo: {
    cooldown: 96, heat: 20, damage: 8, speed: 3.4, life: 190, splashRadius: 82,
    chargeTicks: 0, recoil: 0.45, radius: 12, turnRate: 0.018, telegraphColor: "#ff9030",
    arc: "forward", role: "Slow avoidable ship killer",
  },
  guided_missile: {
    cooldown: 72, heat: 26, damage: 4, speed: 5.7, life: 150, splashRadius: 48,
    chargeTicks: 0, recoil: 0.35, radius: 9, turnRate: 0.055, telegraphColor: "#ff6a3d",
    arc: "omni", role: "Tracking pressure with counterplay",
  },
  energy_bomb: {
    cooldown: 90, heat: 32, damage: 4, speed: 4.0, life: 84, splashRadius: 92,
    chargeTicks: 8, recoil: 0.5, radius: 11, detonateAtLife: 10, telegraphColor: "#ffe66d",
    arc: "omni", role: "Delayed area control",
  },
  emp_launcher: {
    cooldown: 76, heat: 24, damage: 1, speed: 6.4, life: 100, splashRadius: 58,
    chargeTicks: 0, recoil: 0.3, radius: 9, statusEffect: "emp", telegraphColor: "#66ccff",
    arc: "omni", role: "Utility disable pulse",
  },
};

export const PLAYER_WEAPON_SEQUENCE: WeaponKind[] = [
  "naval_cannon",
  "autocannon",
  "torpedo",
  "railgun",
];

export const AI_KIND_CLASS: Record<AiKind, ShipClass> = {
  corvette: "corvette",
  destroyer: "destroyer",
  frigate: "missile_frigate",
  cruiser: "cruiser",
  battleship: "battleship",
  dreadnought: "dreadnought",
};

export const AI_STATS: Record<AiKind, {
  hpBonus: number;
  shootRateMul: number;
  score: number;
  idealRange: number;
  preferredWeapon: WeaponKind;
}> = {
  corvette: { hpBonus: 0, shootRateMul: 0.85, score: 120, idealRange: 250, preferredWeapon: "autocannon" },
  destroyer: { hpBonus: 0, shootRateMul: 1.0, score: 260, idealRange: 330, preferredWeapon: "naval_cannon" },
  frigate: { hpBonus: -1, shootRateMul: 1.08, score: 320, idealRange: 410, preferredWeapon: "guided_missile" },
  cruiser: { hpBonus: 1, shootRateMul: 1.12, score: 520, idealRange: 430, preferredWeapon: "plasma_broadside" },
  battleship: { hpBonus: 3, shootRateMul: 1.28, score: 900, idealRange: 520, preferredWeapon: "railgun" },
  dreadnought: { hpBonus: 8, shootRateMul: 1.45, score: 2000, idealRange: 580, preferredWeapon: "railgun" },
};

export const OBJECTIVE_BONUS: Record<ObjectiveKind, {
  heatCool: number;
  energyRegen: number;
  shieldDelay: number;
  repairEveryTicks: number;
  scoreEveryTicks: number;
  pressureScale: number;
}> = {
  resource_platform: { heatCool: 0.05, energyRegen: 0.05, shieldDelay: 0, repairEveryTicks: 0, scoreEveryTicks: 14, pressureScale: 1.05 },
  comms_relay: { heatCool: 0.04, energyRegen: 0.04, shieldDelay: 0, repairEveryTicks: 0, scoreEveryTicks: 18, pressureScale: 1.25 },
  energy_refinery: { heatCool: 0.22, energyRegen: 0.24, shieldDelay: 1, repairEveryTicks: 0, scoreEveryTicks: 22, pressureScale: 1.0 },
  naval_base: { heatCool: 0.08, energyRegen: 0.08, shieldDelay: 2, repairEveryTicks: 180, scoreEveryTicks: 20, pressureScale: 1.0 },
  radar_station: { heatCool: 0.06, energyRegen: 0.06, shieldDelay: 0, repairEveryTicks: 0, scoreEveryTicks: 18, pressureScale: 1.15 },
  supply_convoy: { heatCool: 0.1, energyRegen: 0.16, shieldDelay: 1, repairEveryTicks: 240, scoreEveryTicks: 12, pressureScale: 1.0 },
};

// Engine surge and resource tuning
export const SHIP_BOOST_COST = 34;
export const SHIP_BOOST_COOLDOWN = 120;
export const SHIP_HEAT_LIMIT = 100;
export const SHIP_COLLISION_DAMAGE_SPEED = 5.8;

export const EMP_DURATION_TICKS = 80;

export const ZONE_CAPTURE_THRESHOLD = 55;
export const ZONE_DECAY_RATE = 0.28;
export const ZONE_PRESSURE_SCALE = 0.72;

// Hit detection radii squared defaults. Bullet radius and ship class radius add extra precision.
export const HITBOX_PLAYER_BULLET_DEFAULT_SQ = 18 * 18;
export const HITBOX_ENEMY_BULLET_SQ = 18 * 18;

// Pure helpers
export function uuid(): string { return crypto.randomUUID(); }
export function rand(min: number, max: number): number { return Math.random() * (max - min) + min; }
export function distSq(a: Vec2, b: Vec2): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
export function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

export function shortestAngleDelta(from: number, to: number): number {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Validates if a target angle is within a ship's weapon arc. */
export function isAngleInArc(shipAngle: number, targetAngle: number, arc: WeaponArc): boolean {
  if (arc === "omni") return true;
  const delta = Math.abs(shortestAngleDelta(shipAngle, targetAngle));
  // Forward arc: +/- 60 degrees
  if (arc === "forward") return delta < Math.PI / 3;
  // Broadside arc: +/- 60 degrees from both sides
  if (arc === "broadside") {
    const babor = Math.abs(shortestAngleDelta(shipAngle - Math.PI / 2, targetAngle));
    const estribor = Math.abs(shortestAngleDelta(shipAngle + Math.PI / 2, targetAngle));
    return babor < Math.PI / 3 || estribor < Math.PI / 3;
  }
  return true;
}

export function spawnPos(): Vec2 {
  const s = Math.floor(Math.random() * 4);
  if (s === 0) return { x: rand(0, WORLD_W), y: -100 };
  if (s === 1) return { x: WORLD_W + 100, y: rand(0, WORLD_H) };
  if (s === 2) return { x: rand(0, WORLD_W), y: WORLD_H + 100 };
  return { x: -100, y: rand(0, WORLD_H) };
}

export function classStats(shipClass: ShipClass): ShipClassStats {
  return SHIP_CLASS_STATS[shipClass] ?? SHIP_CLASS_STATS.corvette;
}

export function collisionRadiusFor(ship: Pick<BaseShip, "shipClass">): number {
  return classStats(ship.shipClass).collisionRadius;
}

// Canonical public serializers
export function toPublicShip(s: Ship): PublicShip {
  const pub: PublicShip = {
    id: s.id,
    controller: s.controller,
    x: Math.round(s.x * 10) / 10,
    y: Math.round(s.y * 10) / 10,
    angle: Math.round(s.angle * 100) / 100,
    hp: Math.round(s.hp),
    maxHp: s.maxHp,
    armor: Math.round(s.armor),
    armorMax: s.armorMax,
    shield: s.shield,
    shieldMax: s.shieldMax,
    alive: s.alive,
    weapon: s.weapon,
    weaponSlots: s.weaponSlots,
    shipClass: s.shipClass,
    role: s.role,
    mass: s.mass,
    boostEnergy: Math.round(s.boostEnergy),
    weaponHeat: Math.round(s.weaponHeat),
    empTicks: s.empTicks,
  };
  if (s.controller === "player") {
    pub.name = s.name;
    pub.color = s.color;
    pub.team = s.team;
    pub.score = s.score;
    pub.isAdmin = s.isAdmin;
  } else {
    pub.kind = s.kind;
    pub.aiFrustration = Math.round((s as EnemyShip).aiFrustration);
  }
  return pub;
}

export function toPublicBullet(b: Bullet): PublicBullet {
  return {
    id: b.id,
    ownerId: b.ownerId,
    ownerController: b.ownerController,
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    vx: Math.round(b.vx * 10) / 10,
    vy: Math.round(b.vy * 10) / 10,
    angle: Math.round(b.angle * 100) / 100,
    kind: b.kind,
    radius: b.radius,
  };
}

export function toPublicZone(z: ControlPoint): PublicZone {
  return {
    id: z.id,
    x: z.x,
    y: z.y,
    radius: z.radius,
    label: z.label,
    objectiveKind: z.objectiveKind,
    owner: z.owner,
    redProgress: Math.round(z.redProgress),
    blueProgress: Math.round(z.blueProgress),
    enemyProgress: Math.round(z.enemyProgress),
  };
}
