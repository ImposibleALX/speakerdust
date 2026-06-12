import type { ShipClass, Team } from "../../core/ships/shipTypes";
import { Ship } from "../../core/ships/Ship";
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
    players: {},
    projectiles: {},
    zones,
    wave: typeof s.wave === "number" ? Math.max(1, s.wave) : 1,
    tick: typeof s.tick === "number" ? s.tick : 0,
  };
}

function coerceNumber(v: unknown, def: number): number {
  return typeof v === "number" && isFinite(v) ? v : def;
}
function coerceString<T extends string>(v: unknown, def: T, allowed?: readonly T[]): T {
  if (typeof v !== "string") return def;
  if (allowed && !allowed.includes(v as T)) return def;
  return v as T;
}
function coerceBool(v: unknown, def: boolean): boolean {
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
    const shipClass = coerceString<ShipClass>(r.shipClass, DEFAULT_PLAYER_CLASS, Object.keys(SHIP_CLASSES) as ShipClass[]);
    const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
    const stats = def.stats;
    const controller = coerceString(r.controller, "player", ["player", "ai"] as const);

    const ship = new Ship({
      id: coerceString(r.id, "unknown"),
      controller,
      shipClass,
      x: coerceNumber(r.x, 600),
      y: coerceNumber(r.y, 400),
      angle: coerceNumber(r.angle, -Math.PI / 2),
    });

    const slots = weaponList(r.weaponSlots, [...stats.weaponSlots]);
    ship.weaponSlots = slots;
    ship.weapon = coerceString<WeaponKind>(r.weapon, slots[0]!, slots);
    ship.vx = coerceNumber(r.vx, 0);
    ship.vy = coerceNumber(r.vy, 0);
    ship.targetAngle = coerceNumber(r.targetAngle, -Math.PI / 2);
    ship.hp = coerceNumber(r.hp, stats.maxHp);
    ship.armor = coerceNumber(r.armor, stats.armorMax);
    ship.shield = coerceNumber(r.shield, stats.shieldMax);
    ship.shieldRegenDelay = coerceNumber(r.shieldRegenDelay, 0);
    if (Array.isArray(r.turretMounts)) {
      for (let i = 0; i < Math.min(r.turretMounts.length, ship.turretMounts.length); i++) {
        const rm = r.turretMounts[i];
        if (!rm) continue;
        const sm = ship.turretMounts[i]!;
        sm.cooldown = coerceNumber(rm.cooldown, 0);
        sm.heat = coerceNumber(rm.heat, 0);
        sm.enabled = coerceBool(rm.enabled, true);
        sm.angle = coerceNumber(rm.angle, sm.restAngle);
        sm.targetAngle = coerceNumber(rm.targetAngle, sm.restAngle);
      }
    }
    ship.boostEnergy = coerceNumber(r.boostEnergy, 100);
    ship.boostCooldown = coerceNumber(r.boostCooldown, 0);
    ship.boostQueued = coerceBool(r.boostQueued, false);
    ship.empTicks = coerceNumber(r.empTicks, 0);
    ship.heading = coerceNumber(r.heading, -Math.PI / 2);
    ship.angularVelocity = coerceNumber(r.angularVelocity, 0);
    ship.iFrames = coerceNumber(r.iFrames, 0);
    ship.alive = coerceBool(r.alive, true);
    ship.name = coerceString(r.name, "");
    ship.color = coerceString(r.color, "hsl(180,80%,65%)");
    ship.team = coerceString(r.team, "red", ["red", "blue", "spectator"] as const);
    ship.score = coerceNumber(r.score, 0);
    ship.isAdmin = coerceBool(r.isAdmin, false);
    ship.godmode = coerceBool(r.godmode, false);
    ship.inputSeq = coerceNumber(r.inputSeq, 0);

    return ship;
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
      owner: coerceString(z.owner, "neutral", ["neutral", "red", "blue", "enemies"] as const),
      redProgress: coerceNumber(z.redProgress, 0),
      blueProgress: coerceNumber(z.blueProgress, 0),
      enemyProgress: coerceNumber(z.enemyProgress, 0),
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
