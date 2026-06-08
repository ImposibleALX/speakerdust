// zonesSystem.ts
// Naval objective control logic with red vs blue vs enemy progress bars.

import type { Ship } from "../ships/shipTypes";
import { clamp } from "../math";
import { WORLD_H, WORLD_W } from "./mapConfig";

export type ZoneOwner = "neutral" | "red" | "blue" | "enemies";

export type ObjectiveKind =
  | "resource_platform"
  | "comms_relay"
  | "energy_refinery"
  | "naval_base"
  | "radar_station"
  | "supply_convoy";

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

export interface ShipZoneBonus {
  heatCool: number;
  energyRegen: number;
  shieldDelay: number;
  repairEveryTicks: number;
  scoreEveryTicks: number;
  pressureScale: number;
}

export const ZONE_CAPTURE_THRESHOLD = 55;
export const ZONE_DECAY_RATE = 0.28;
export const ZONE_PRESSURE_SCALE = 0.72;

export const OBJECTIVE_BONUS: Record<ObjectiveKind, ShipZoneBonus> = {
  resource_platform: { heatCool: 0.05, energyRegen: 0.05, shieldDelay: 0, repairEveryTicks: 0, scoreEveryTicks: 14, pressureScale: 1.05 },
  comms_relay: { heatCool: 0.04, energyRegen: 0.04, shieldDelay: 0, repairEveryTicks: 0, scoreEveryTicks: 18, pressureScale: 1.25 },
  energy_refinery: { heatCool: 0.22, energyRegen: 0.24, shieldDelay: 1, repairEveryTicks: 0, scoreEveryTicks: 22, pressureScale: 1.0 },
  naval_base: { heatCool: 0.08, energyRegen: 0.08, shieldDelay: 2, repairEveryTicks: 180, scoreEveryTicks: 20, pressureScale: 1.0 },
  radar_station: { heatCool: 0.06, energyRegen: 0.06, shieldDelay: 0, repairEveryTicks: 0, scoreEveryTicks: 18, pressureScale: 1.15 },
  supply_convoy: { heatCool: 0.1, energyRegen: 0.16, shieldDelay: 1, repairEveryTicks: 240, scoreEveryTicks: 12, pressureScale: 1.0 },
};

const EMPTY_BONUS: ShipZoneBonus = {
  heatCool: 0,
  energyRegen: 0,
  shieldDelay: 0,
  repairEveryTicks: 0,
  scoreEveryTicks: 0,
  pressureScale: 1,
};

export function initZones(): Record<string, ControlPoint> {
  return {
    refinery: objective("refinery", WORLD_W * 0.50, WORLD_H * 0.50, 150, "ENERGY REFINERY", "energy_refinery"),
    relay: objective("relay", WORLD_W * 0.25, WORLD_H * 0.30, 132, "COMMS RELAY", "comms_relay"),
    platform: objective("platform", WORLD_W * 0.74, WORLD_H * 0.70, 132, "RESOURCE PLATFORM", "resource_platform"),
  };
}

function objective(
  id: string,
  x: number,
  y: number,
  radius: number,
  label: string,
  objectiveKind: ObjectiveKind,
): ControlPoint {
  return { id, x, y, radius, owner: "neutral", redProgress: 0, blueProgress: 0, enemyProgress: 0, label, objectiveKind };
}

export interface ZoneChangeEvent {
  zoneId: string;
  owner: ZoneOwner;
  label: string;
  objectiveKind: ObjectiveKind;
  redProgress: number;
  blueProgress: number;
  enemyProgress: number;
}

export function updateControlPoints(
  zones: Record<string, ControlPoint>,
  playerShips: Ship[],
  enemyShips: Ship[],
  wave: number,
): ZoneChangeEvent[] {
  const events: ZoneChangeEvent[] = [];
  const wavePressureMult = wave >= 3 ? 1.15 : 1.0;

  for (const zone of Object.values(zones)) {
    const bonus = OBJECTIVE_BONUS[zone.objectiveKind] ?? EMPTY_BONUS;
    let redPressure = 0;
    let bluePressure = 0;
    let enemyPressure = 0;

    for (const p of playerShips) {
      if (p.team === "spectator") continue;
      const d = Math.hypot(p.x - zone.x, p.y - zone.y);
      if (d < zone.radius) {
        const pressure = (1 - d / zone.radius) * ZONE_PRESSURE_SCALE * bonus.pressureScale;
        if (p.team === "red") redPressure += pressure;
        else bluePressure += pressure;
      }
    }

    for (const e of enemyShips) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - zone.x, e.y - zone.y);
      if (d < zone.radius) enemyPressure += (1 - d / zone.radius) * ZONE_PRESSURE_SCALE * wavePressureMult;
    }

    zone.redProgress = advanceBar(zone.redProgress, redPressure, enemyPressure + bluePressure);
    zone.blueProgress = advanceBar(zone.blueProgress, bluePressure, enemyPressure + redPressure);
    zone.enemyProgress = advanceBar(zone.enemyProgress, enemyPressure, redPressure + bluePressure);

    const previousOwner = zone.owner;
    zone.owner = resolveOwner(zone.redProgress, zone.blueProgress, zone.enemyProgress);

    if (zone.owner !== previousOwner) {
      events.push({
        zoneId: zone.id,
        owner: zone.owner,
        label: zone.label,
        objectiveKind: zone.objectiveKind,
        redProgress: Math.round(zone.redProgress),
        blueProgress: Math.round(zone.blueProgress),
        enemyProgress: Math.round(zone.enemyProgress),
      });
    }
  }

  return events;
}

function advanceBar(current: number, pressure: number, opposition: number): number {
  const net = pressure - opposition;
  if (net > 0) return clamp(current + net, 0, 100);
  if (net < 0) return clamp(current + net, 0, 100);
  if (current > 0) {
    const decayed = current - ZONE_DECAY_RATE;
    return decayed < 0.5 ? 0 : decayed;
  }
  return current;
}

function resolveOwner(red: number, blue: number, enemy: number): ZoneOwner {
  const above = (v: number) => v >= ZONE_CAPTURE_THRESHOLD;
  if (!above(red) && !above(blue) && !above(enemy)) return "neutral";
  if (red >= blue && red >= enemy && above(red)) return "red";
  if (blue >= red && blue >= enemy && above(blue)) return "blue";
  if (above(enemy)) return "enemies";
  return "neutral";
}

export function getZoneBonusForShip(
  ship: Ship,
  zones: Record<string, ControlPoint>,
): ShipZoneBonus {
  for (const zone of Object.values(zones)) {
    const dSq = (ship.x - zone.x) ** 2 + (ship.y - zone.y) ** 2;
    if (dSq <= zone.radius * zone.radius && zone.owner === ship.team) {
      return OBJECTIVE_BONUS[zone.objectiveKind] ?? EMPTY_BONUS;
    }
  }
  return EMPTY_BONUS;
}

export function findNearestZone(
  x: number,
  y: number,
  zones: Record<string, ControlPoint>,
): Pick<ControlPoint, "x" | "y" | "radius"> | null {
  let best: ControlPoint | null = null;
  let minSq = Infinity;
  for (const z of Object.values(zones)) {
    const dSq = (z.x - x) ** 2 + (z.y - y) ** 2;
    if (dSq < minSq) { minSq = dSq; best = z; }
  }
  return best;
}
