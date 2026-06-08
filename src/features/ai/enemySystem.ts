import type { Ship, ShipClass, AiState } from "../../core/ships/shipTypes";
import type { ControlPoint } from "../../core/world/zones";
import { WEAPON_STATS } from "../../core/combat/weaponStats";
import { createProjectile, type Projectile } from "../../core/combat/projectiles";
import { WORLD_W, WORLD_H, spawnPos } from "../../core/world/mapConfig";
import { AI_STATS, SHIP_HEAT_LIMIT, classStats } from "../../core/ships/shipStats";
import { clamp, rand, uuid, distSq, shortestAngleDelta } from "../../core/math";
import { applyShipDamage } from "../physics/playerSystem";

function approachAngle(current: number, desired: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, desired);
  return current + clamp(delta, -maxStep, maxStep);
}

export function createEnemyShip(shipClass: ShipClass, wave: number): { ship: Ship; ai: AiState } {
  const pos = spawnPos();
  const stats = classStats(shipClass);
  const weapon = stats.weaponSlots[0] ?? "naval_cannon";

  return {
    ship: {
      id: uuid(),
      controller: "ai",
      shipClass,
      role: stats.role,
      mass: stats.mass, turnRate: stats.turnRate,
      drag: stats.drag, maxSpeed: stats.maxSpeed,
      thrustForce: stats.thrustForce, strafeThrustForce: stats.strafeThrustForce,
      weaponSlots: [...stats.weaponSlots],
      ...pos,
      vx: 0, vy: 0,
      angle: 0, targetAngle: 0,
      hp: stats.maxHp, maxHp: stats.maxHp,
      armor: stats.armorMax, armorMax: stats.armorMax,
      shield: stats.shieldMax, shieldMax: stats.shieldMax,
      shieldRegenDelay: 0,
      weapon,
      shootCooldown: 0, weaponHeat: 0,
      boostEnergy: 100, boostCooldown: 0, boostQueued: false,
      empTicks: 0, iFrames: 0, alive: true,
      inputForward: 0, inputStrafe: 0,
      name: "", color: "", team: "red" as const,
      score: 0, isAdmin: false, godmode: false, inputSeq: 0,
    },
    ai: {
      targetId: undefined,
      lastSeenPos: undefined,
      reactionTicks: Math.floor(rand(4, 12)),
      aimJitter: shipClass === "corvette" || shipClass === "destroyer" ? 0.07 : 0.04,
      maneuverTimer: Math.floor(rand(30, 90)),
      maneuverDir: (Math.random() < 0.5 ? -1 : 1) as -1 | 1,
      strafing: Math.random() < 0.5,
      frustration: 0,
      wave,
      formationIndex: 0,
    },
  };
}

export function spawnWave(wave: number): Array<{ ship: Ship; ai: AiState }> {
  const results: Array<{ ship: Ship; ai: AiState }> = [];
  const classes: ShipClass[] = [];

  const corvettes = Math.min(2 + Math.ceil(wave * 0.5), 8);
  const destroyers = Math.min(Math.max(0, Math.floor(wave / 3)), 5);
  const frigates = Math.min(Math.max(0, Math.floor((wave - 3) / 4)), 4);
  const cruisers = Math.min(Math.max(0, Math.floor((wave - 6) / 5)), 3);
  const battleships = Math.min(Math.max(0, Math.floor((wave - 10) / 6)), 2);
  const dreadnoughts = wave >= 15 && wave % 5 === 0 ? 1 : 0;

  for (let i = 0; i < corvettes; i++) results.push(createEnemyShip("corvette", wave));
  for (let i = 0; i < destroyers; i++) results.push(createEnemyShip("destroyer", wave));
  for (let i = 0; i < frigates; i++) results.push(createEnemyShip("missile_frigate", wave));
  for (let i = 0; i < cruisers; i++) results.push(createEnemyShip("cruiser", wave));
  for (let i = 0; i < battleships; i++) results.push(createEnemyShip("battleship", wave));
  for (let i = 0; i < dreadnoughts; i++) results.push(createEnemyShip("dreadnought", wave));

  assignFormationIndices(results.map(r => r.ai));
  return results;
}

export function assignFormationIndices(ais: AiState[]): void {
  const counters: Record<string, number> = {};
  for (const a of ais) {
    const k = String(a.wave);
    const idx = counters[k] ?? 0;
    a.formationIndex = idx;
    counters[k] = idx + 1;
  }
}

export function computeEnemyCounts(ships: Ship[]): Record<ShipClass, number> {
  const counts: Record<string, number> = {};
  for (const s of ships) {
    if (s.controller === "ai" && s.alive) {
      counts[s.shipClass] = (counts[s.shipClass] ?? 0) + 1;
    }
  }
  return counts as Record<ShipClass, number>;
}

export function updateEnemyInputs(
  enemy: Ship,
  ai: AiState,
  alivePlayers: Ship[],
  enemyCounts: Record<ShipClass, number>,
  nearestZone: Pick<ControlPoint, "x" | "y" | "radius"> | null,
): void {
  if (enemy.shootCooldown > 0) enemy.shootCooldown--;

  if (enemy.boostCooldown > 0) enemy.boostCooldown--;
  if (enemy.boostEnergy < 100) enemy.boostEnergy = Math.min(100, enemy.boostEnergy + classStats(enemy.shipClass).boostRegenRate);

  const stats = AI_STATS[enemy.shipClass];

  let target: Ship | null = null;
  let targetDistSq = Infinity;

  const currentTarget = alivePlayers.find(p => p.id === ai.targetId && p.alive);
  if (currentTarget) {
    const dSq = distSq(enemy, currentTarget);
    target = currentTarget;
    targetDistSq = dSq;
    ai.lastSeenPos = { x: currentTarget.x, y: currentTarget.y };
  }

  if (!target) {
    for (const p of alivePlayers) {
      const dSq = distSq(enemy, p);
      if (dSq < targetDistSq) {
        targetDistSq = dSq;
        target = p;
      }
    }
    if (target) {
      ai.targetId = target.id;
      ai.lastSeenPos = { x: target.x, y: target.y };
      ai.reactionTicks = Math.floor(rand(4, 10));
      ai.frustration = 0;
    } else {
      ai.targetId = undefined;
    }
  }

  let aimTargetX = WORLD_W * 0.5;
  let aimTargetY = WORLD_H * 0.5;
  if (target) {
    aimTargetX = target.x;
    aimTargetY = target.y;
  } else if (ai.lastSeenPos) {
    aimTargetX = ai.lastSeenPos.x;
    aimTargetY = ai.lastSeenPos.y;
  } else if (nearestZone) {
    aimTargetX = nearestZone.x;
    aimTargetY = nearestZone.y;
  }

  let desiredAngle = enemy.angle;
  if (target) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    const leadMul = (enemy.shipClass === "battleship" || enemy.shipClass === "dreadnought") ? 22 : 14;
    const aimNoise = enemy.shipClass === "corvette" ? 0.09
      : enemy.shipClass === "destroyer" ? 0.07
        : enemy.shipClass === "missile_frigate" ? 0.06
          : enemy.shipClass === "cruiser" ? 0.05 : 0.04;

    const predictX = target.x + target.vx * leadMul;
    const predictY = target.y + target.vy * leadMul;
    const noisyX = predictX + (Math.random() - 0.5) * 24;
    const noisyY = predictY + (Math.random() - 0.5) * 24;

    const rawAngle = Math.atan2(noisyY - enemy.y, noisyX - enemy.x);

    if (ai.reactionTicks > 0) {
      ai.reactionTicks--;
      desiredAngle = approachAngle(enemy.angle, rawAngle, enemy.turnRate * 0.45);
    } else {
      desiredAngle = rawAngle + (Math.random() - 0.5) * aimNoise;
    }

    if (dist > 1400) {
      ai.frustration = Math.max(0, ai.frustration - 0.15);
    }
  } else {
    const dx = aimTargetX - enemy.x;
    const dy = aimTargetY - enemy.y;
    desiredAngle = Math.atan2(dy, dx);
  }

  enemy.targetAngle = approachAngle(enemy.angle, desiredAngle, enemy.turnRate);

  ai.maneuverTimer--;
  if (ai.maneuverTimer <= 0) {
    ai.maneuverDir = (Math.random() < 0.5 ? -1 : 1) as -1 | 1;
    ai.strafing = Math.random() < 0.55;
    ai.maneuverTimer = Math.floor(rand(40, 95));

    if (ai.frustration > 60 && target) {
      ai.targetId = undefined;
      ai.frustration = 0;
    }
  }

  let moveX = 0;
  let moveY = 0;

  if (target) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;

    const seek = dist > stats.idealRange + 90;
    const retreat = dist < stats.idealRange - 110;
    const heavy = enemy.shipClass === "battleship" || enemy.shipClass === "dreadnought";
    const lineShip = enemy.shipClass === "destroyer" || enemy.shipClass === "cruiser";

    if (seek) {
      moveX += dirX * (heavy ? 0.45 : 0.8);
      moveY += dirY * (heavy ? 0.45 : 0.8);
    }
    if (retreat) {
      moveX -= dirX * (lineShip ? 0.55 : 0.35);
      moveY -= dirY * (lineShip ? 0.55 : 0.35);
    }

    const orbitPhase = ai.wave * 0.35 + ai.formationIndex * 0.7 + ai.maneuverTimer * 0.06;
    const orbitSide = Math.sin(orbitPhase) >= 0 ? 1 : -1;
    const orbitAngle = enemy.targetAngle + (Math.PI / 2) * ai.maneuverDir * orbitSide;
    const orbitPower = heavy ? 0.28 : lineShip ? 0.48 : 0.72;
    moveX += Math.cos(orbitAngle) * orbitPower;
    moveY += Math.sin(orbitAngle) * orbitPower;

    if (ai.strafing) {
      const strafeSide = Math.sin(orbitPhase * 1.7) >= 0 ? 1 : -1;
      const strafeAngle = enemy.targetAngle + (Math.PI / 2) * strafeSide;
      moveX += Math.cos(strafeAngle) * 0.22;
      moveY += Math.sin(strafeAngle) * 0.22;
    }

    if (enemy.hp < enemy.maxHp * 0.3) {
      moveX -= dirX * 0.55;
      moveY -= dirY * 0.55;
    }
  } else {
    const dx = aimTargetX - enemy.x;
    const dy = aimTargetY - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    moveX = dx / dist;
    moveY = dy / dist;

    const zigPhase = ai.wave * 0.25 + ai.formationIndex * 0.5 + ai.maneuverTimer * 0.08;
    const zig = Math.sin(zigPhase) * 0.22;
    moveX += zig;
    moveY += zig * 0.8;
  }

  const cos = Math.cos(enemy.angle);
  const sin = Math.sin(enemy.angle);
  enemy.inputForward = clamp(moveX * cos + moveY * sin, -1, 1);
  enemy.inputStrafe = clamp(moveX * -sin + moveY * cos, -1, 1);

  if (!target) {
    ai.frustration = Math.max(0, ai.frustration - 0.4);
  }
}

export function shouldEnemyFire(
  enemy: Ship,
  ai: AiState,
  targetDistSq: number,
  aimErrorRad: number = 0,
): boolean {
  if (enemy.shootCooldown > 0 || enemy.weaponHeat >= SHIP_HEAT_LIMIT) return false;

  const rangeSq = (AI_STATS[enemy.shipClass].idealRange + 180) ** 2;
  if (targetDistSq > rangeSq) {
    ai.frustration += 0.2;
    return false;
  }

  const maxAimError =
    enemy.shipClass === "dreadnought" || enemy.shipClass === "battleship" ? 0.26 :
      enemy.shipClass === "cruiser" ? 0.30 : 0.34;

  return Math.abs(aimErrorRad) <= maxAimError;
}

export function generateEnemyBullets(enemy: Ship, target: Ship): Projectile[] {
  const weapon = enemy.weapon;
  const stats = WEAPON_STATS[weapon];

  const leadX = target.x + target.vx * (weapon === "railgun" ? 30 : 18);
  const leadY = target.y + target.vy * (weapon === "railgun" ? 30 : 18);
  const ang = Math.atan2(leadY - enemy.y, leadX - enemy.x);

  enemy.shootCooldown = stats.cooldown;
  enemy.weaponHeat = Math.min(SHIP_HEAT_LIMIT + 40, enemy.weaponHeat + stats.heat);

  const projectiles: Projectile[] = [];
  const count = weapon === "plasma_broadside" ? 3 : weapon === "autocannon" ? 2 : 1;
  const offsets = count === 3 ? [-0.18, 0, 0.18] : count === 2 ? [-0.06, 0.06] : [0];

  for (const off of offsets) {
    projectiles.push(createProjectile(enemy.id, "ai", enemy.x, enemy.y, ang + off, weapon));
  }
  return projectiles;
}

export interface SplashKill {
  enemyId: string;
  x: number;
  y: number;
  shipClass: ShipClass;
  score: number;
}

export function applyBulletSplash(
  ownerId: string,
  x: number,
  y: number,
  damage: number,
  splashRadius: number,
  enemies: Ship[],
  excludedEnemyId?: string,
): SplashKill[] {
  if (splashRadius <= 0) return [];

  const kills: SplashKill[] = [];
  const rSq = splashRadius * splashRadius;
  const splashDmg = Math.max(1, Math.round(damage * 0.7));

  for (const enemy of enemies) {
    if (enemy.id === excludedEnemyId || !enemy.alive) continue;
    const dSq = distSq({ x, y }, enemy);
    if (dSq > rSq) continue;

    const distance = Math.sqrt(dSq);
    const falloff = 1 - distance / splashRadius;
    const finalDamage = Math.max(1, Math.round(splashDmg * falloff));

    const result = applyShipDamage(enemy, finalDamage, false, false);

    if (result.dead) {
      const { score } = AI_STATS[enemy.shipClass];
      kills.push({ enemyId: enemy.id, x: enemy.x, y: enemy.y, shipClass: enemy.shipClass, score });
    }
  }
  return kills;
}
