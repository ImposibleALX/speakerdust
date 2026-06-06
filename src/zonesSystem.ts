// zonesSystem.ts
// Naval objective control logic with red vs blue vs enemy progress bars.

import {
  ControlPoint, PlayerShip, EnemyShip, ZoneOwner, ShipZoneBonus,
  WORLD_W, WORLD_H,
  ZONE_CAPTURE_THRESHOLD, ZONE_DECAY_RATE, ZONE_PRESSURE_SCALE,
  OBJECTIVE_BONUS, ObjectiveKind,
  clamp,
} from "./gameState";

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
  playerShips: PlayerShip[],
  enemyShips: EnemyShip[],
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
  ship: PlayerShip,
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
