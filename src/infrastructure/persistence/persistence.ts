import type { Ship, ShipClass, Team } from "../../core/ships/shipTypes";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { WEAPON_STATS } from "../../core/combat/weaponStats";
import type { ControlPoint } from "../../core/world/zones";
import { initZones } from "../../core/world/zones";
import { SHIP_CLASSES } from "@speakerdust/shared";
import { DEFAULT_PLAYER_CLASS } from "../../core/ships/shipStats";
import type { GameState } from "../../core/state";
import { SNAPSHOT_VERSION, SNAPSHOT_KEY } from "./constants";

const ALLOWED_WEAPONS = new Set(Object.keys(WEAPON_STATS));

export interface PersistedState {
  version: number;
  ships: Record<string, Ship>;
  zones: Record<string, ControlPoint>;
  wave: number;
  tick: number;
  aiStates: Record<string, unknown>;
}

export function serializeForStorage(state: GameState, aiStates: Map<string, unknown>): PersistedState {
  return {
    version: SNAPSHOT_VERSION,
    ships: state.ships,
    zones: state.zones,
    wave: state.wave,
    tick: state.tick,
    aiStates: Object.fromEntries(aiStates),
  };
}

export function hydrateState(stored: unknown): GameState | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Record<string, unknown>;
  if (s.version !== SNAPSHOT_VERSION) return null;

  const rawShips = (s.ships ?? {}) as Record<string, unknown>;
  const ships: Record<string, Ship> = {};
  for (const [id, raw] of Object.entries(rawShips)) {
    const ship = ShipSerializer.normalise(raw);
    if (ship) ships[id] = ship;
  }

  const rawZones = s.zones as Record<string, ControlPoint> | undefined;
  const zones = rawZones && Object.keys(rawZones).length > 0 ? normaliseZones(rawZones) : initZones();

  return {
    ships,
    projectiles: {},
    zones,
    wave: typeof s.wave === "number" ? Math.max(1, s.wave) : 1,
    tick: typeof s.tick === "number" ? s.tick : 0,
  };
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
  const out = v.filter((x): x is WeaponKind => typeof x === "string" && ALLOWED_WEAPONS.has(x));
  return out.length ? out : [...def];
}

class ShipSerializer {
  static normalise(raw: unknown): Ship | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const shipClass = str<ShipClass>(r.shipClass, DEFAULT_PLAYER_CLASS, Object.keys(SHIP_CLASSES) as ShipClass[]);
    const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
    const stats = def.stats;
    const phys = def.physics;
    const slots = weaponList(r.weaponSlots, [...stats.weaponSlots]);
    const weapon = str<WeaponKind>(r.weapon, slots[0]!, slots);
    const controller = str(r.controller, "player", ["player", "ai"] as const);
    return {
      id: str(r.id, "unknown"),
      controller,
      shipClass,
      role: str(r.role, stats.role),
      mass: num(r.mass, phys.mass),
      turnRate: num(r.turnRate, phys.maxAngularSpeed),
      weaponSlots: slots,
      x: num(r.x, 600), y: num(r.y, 400),
      vx: num(r.vx, 0), vy: num(r.vy, 0),
      angle: num(r.angle, -Math.PI / 2),
      targetAngle: num(r.targetAngle, -Math.PI / 2),
      hp: num(r.hp, stats.maxHp),
      maxHp: num(r.maxHp, stats.maxHp),
      armor: num(r.armor, stats.armorMax),
      armorMax: num(r.armorMax, stats.armorMax),
      shieldMax: num(r.shieldMax, stats.shieldMax),
      shield: num(r.shield, stats.shieldMax),
      shieldRegenDelay: num(r.shieldRegenDelay, 0),
      weapon,
      shootCooldown: num(r.shootCooldown, 0),
      weaponHeat: num(r.weaponHeat, 0),
      boostEnergy: num(r.boostEnergy, 100),
      boostCooldown: num(r.boostCooldown, 0),
      boostQueued: false,
      empTicks: num(r.empTicks, 0),
      inputForward: 0, inputStrafe: 0, inputTurn: 0,
      heading: num(r.heading, -Math.PI / 2),
      angularVelocity: num(r.angularVelocity, 0),
      iFrames: num(r.iFrames, 0),
      alive: bool(r.alive, true),
      drag: num(r.drag, phys.linearDrag),
      maxSpeed: num(r.maxSpeed, phys.maxLinearSpeed),
      thrustForce: num(r.thrustForce, phys.thrustAccel),
      strafeThrustForce: num(r.strafeThrustForce, phys.strafeAccel),
      name: str(r.name, ""),
      color: str(r.color, "hsl(180,80%,65%)"),
      team: str(r.team, "red", ["red", "blue", "spectator"] as const),
      score: num(r.score, 0),
      isAdmin: bool(r.isAdmin, false),
      godmode: bool(r.godmode, false),
      inputSeq: num(r.inputSeq, 0),
    };
  }
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
  private pendingDirty = false;

  constructor(private readonly doSave: () => Promise<void>) { }

  setHydrated(): void {
    this.hydrated = true;
    if (this.pendingDirty) {
      this.pendingDirty = false;
      this.markDirty();
    }
  }

  markDirty(): void {
    if (!this.hydrated) { this.pendingDirty = true; return; }
    if (this.saving) this.dirtyWhileSaving = true;
    else void this.flush();
  }

  private async flush(): Promise<void> {
    this.saving = true;
    this.dirtyWhileSaving = false;
    try { await this.doSave(); } catch { } finally {
      this.saving = false;
      if (this.dirtyWhileSaving) void this.flush();
    }
  }
}
