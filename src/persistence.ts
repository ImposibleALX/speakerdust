// persistence.ts
// State snapshot, versioning, migration guard, and non-lossy write queue.

import {
  GameState, PlayerShip, EnemyShip, ControlPoint, Ship, ShipClass, AiKind, WeaponKind,
  SNAPSHOT_VERSION, DEFAULT_PLAYER_CLASS, SHIP_CLASS_STATS, AI_KIND_CLASS, AI_STATS,
  classStats,
} from "./gameState";
import { initZones } from "./zonesSystem";

export interface PersistedState {
  version: number;
  ships: Record<string, Ship>;
  zones: Record<string, ControlPoint>;
  wave: number;
  tick: number;
}

export function serializeForStorage(state: GameState): PersistedState {
  return {
    version: SNAPSHOT_VERSION,
    ships: state.ships,
    zones: state.zones,
    wave: state.wave,
    tick: state.tick,
  };
}

export function hydrateState(stored: unknown): GameState | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Record<string, unknown>;
  if (s.version !== SNAPSHOT_VERSION) return null;

  const rawShips = (s.ships ?? {}) as Record<string, unknown>;
  const ships: Record<string, Ship> = {};
  for (const [id, raw] of Object.entries(rawShips)) {
    const ship = normaliseShip(raw);
    if (ship) ships[id] = ship;
  }

  const rawZones = s.zones as Record<string, ControlPoint> | undefined;
  const zones = rawZones && Object.keys(rawZones).length > 0 ? normaliseZones(rawZones) : initZones();

  return {
    ships,
    bullets: {},
    zones,
    wave: typeof s.wave === "number" ? Math.max(1, s.wave) : 1,
    tick: typeof s.tick === "number" ? s.tick : 0,
  };
}

function normaliseShip(raw: unknown): Ship | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.controller === "player") return normalisePlayerShip(r);
  if (r.controller === "ai") return normaliseEnemyShip(r);
  return null;
}

function num(v: unknown, def: number): number {
  return typeof v === "number" && isFinite(v) ? v : def;
}
function str<T extends string>(v: unknown, def: T, allowed?: readonly T[]): T {
  if (typeof v !== "string") return def;
  if (allowed && !allowed.includes(v as T)) return def;
  return v as T;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}
function weaponList(v: unknown, def: WeaponKind[]): WeaponKind[] {
  if (!Array.isArray(v)) return [...def];
  const allowed = new Set(Object.keys({
    naval_cannon: 1, autocannon: 1, plasma_broadside: 1, railgun: 1,
    torpedo: 1, guided_missile: 1, energy_bomb: 1, emp_launcher: 1,
  }));
  const out = v.filter((x): x is WeaponKind => typeof x === "string" && allowed.has(x));
  return out.length ? out : [...def];
}

function normalisePlayerShip(r: Record<string, unknown>): PlayerShip {
  const shipClass = str<ShipClass>(r.shipClass, DEFAULT_PLAYER_CLASS, Object.keys(SHIP_CLASS_STATS) as ShipClass[]);
  const stats = classStats(shipClass);
  const slots = weaponList(r.weaponSlots, stats.weaponSlots);
  const weapon = str<WeaponKind>(r.weapon, slots[0], slots);
  return {
    id: str(r.id, "unknown"),
    controller: "player",
    shipClass,
    role: str(r.role, stats.role),
    mass: num(r.mass, stats.mass),
    turnRate: num(r.turnRate, stats.turnRate),
    weaponSlots: slots,
    x: num(r.x, 600), y: num(r.y, 400),
    vx: 0, vy: 0,
    angle: num(r.angle, -Math.PI / 2),
    targetAngle: num(r.targetAngle, -Math.PI / 2),
    hp: num(r.hp, stats.maxHp),
    maxHp: num(r.maxHp, stats.maxHp),
    armor: num(r.armor, stats.armorMax),
    armorMax: num(r.armorMax, stats.armorMax),
    shieldMax: num(r.shieldMax, stats.shieldMax),
    shield: num(r.shield, stats.shieldMax),
    shieldRegenDelay: 0,
    weapon,
    shootCooldown: 0,
    weaponHeat: 0,
    boostEnergy: num(r.boostEnergy, 100),
    boostCooldown: 0,
    boostQueued: false,
    empTicks: 0,
    inputForward: 0, inputStrafe: 0,
    iFrames: 60,
    alive: bool(r.alive, true),
    drag: num(r.drag, stats.drag),
    maxSpeed: num(r.maxSpeed, stats.maxSpeed),
    thrustForce: num(r.thrustForce, stats.thrustForce),
    strafeThrustForce: num(r.strafeThrustForce, stats.strafeThrustForce),
    name: str(r.name, "CAPTAIN"),
    color: str(r.color, "hsl(180,80%,65%)"),
    team: str(r.team, "red", ["red", "blue", "spectator"] as const),
    score: num(r.score, 0),
    isAdmin: bool(r.isAdmin, false),
  };
}

function normaliseEnemyShip(r: Record<string, unknown>): EnemyShip {
  const kind = str<AiKind>(r.kind, "corvette", Object.keys(AI_KIND_CLASS) as AiKind[]);
  const shipClass = AI_KIND_CLASS[kind];
  const stats = classStats(shipClass);
  const ai = AI_STATS[kind];
  return {
    id: str(r.id, "unknown"),
    controller: "ai",
    shipClass,
    role: stats.role,
    mass: stats.mass,
    turnRate: stats.turnRate,
    weaponSlots: [...stats.weaponSlots],
    x: num(r.x, 0), y: num(r.y, 0),
    vx: 0, vy: 0,
    angle: num(r.angle, 0),
    targetAngle: num(r.targetAngle, 0),
    hp: num(r.hp, stats.maxHp),
    maxHp: num(r.maxHp, stats.maxHp),
    armor: num(r.armor, stats.armorMax),
    armorMax: num(r.armorMax, stats.armorMax),
    shieldMax: Math.max(0, stats.shieldMax - 1),
    shield: num(r.shield, Math.max(0, stats.shieldMax - 1)),
    shieldRegenDelay: 0,
    weapon: ai.preferredWeapon,
    shootCooldown: Math.floor(Math.random() * 50),
    weaponHeat: 0,
    boostEnergy: 0,
    boostCooldown: 0,
    boostQueued: false,
    empTicks: 0,
    inputForward: 0, inputStrafe: 0,
    iFrames: 0,
    alive: bool(r.alive, true),
    drag: stats.drag,
    maxSpeed: stats.maxSpeed * 0.92,
    thrustForce: stats.thrustForce * 0.9,
    strafeThrustForce: stats.strafeThrustForce * 0.75,
    kind,
    wave: num(r.wave, 1),
    formationIndex: num(r.formationIndex, 0),
    aiTargetId: r.aiTargetId as string | undefined,
    aiLastSeenPos: r.aiLastSeenPos as { x: number; y: number } | undefined,
    aiReactionTicks: num(r.aiReactionTicks, 8),
    aiAimJitter: num(r.aiAimJitter, 0.05),
    aiManeuverTimer: num(r.aiManeuverTimer, 60),
    aiManeuverDir: num(r.aiManeuverDir, 1) === -1 ? -1 : 1,
    aiStrafing: bool(r.aiStrafing, false),
    aiFrustration: num(r.aiFrustration, 0),
  };
}

function normaliseZones(raw: Record<string, ControlPoint>): Record<string, ControlPoint> {
  const fresh = initZones();
  const out: Record<string, ControlPoint> = {};
  for (const [id, z] of Object.entries(raw)) {
    const f = fresh[id];
    if (!f) continue;
    out[id] = {
      ...f,
      owner: str(z.owner, "neutral", ["neutral", "red", "blue", "enemies"] as const),
      redProgress: num(z.redProgress, 0),
      blueProgress: num(z.blueProgress, 0),
      enemyProgress: num(z.enemyProgress, 0),
    };
  }
  for (const [id, f] of Object.entries(fresh)) if (!out[id]) out[id] = f;
  return out;
}

export class PersistenceQueue {
  private saving = false;
  private dirtyWhileSaving = false;
  private hydrated = false;

  constructor(private readonly doSave: () => Promise<void>) { }

  setHydrated(): void { this.hydrated = true; }

  markDirty(): void {
    if (!this.hydrated) return;
    if (this.saving) this.dirtyWhileSaving = true;
    else void this.flush();
  }

  private async flush(): Promise<void> {
    this.saving = true;
    this.dirtyWhileSaving = false;
    try {
      await this.doSave();
    } catch {
      // Storage errors are non-fatal; state stays in memory.
    } finally {
      this.saving = false;
      if (this.dirtyWhileSaving) void this.flush();
    }
  }
}
