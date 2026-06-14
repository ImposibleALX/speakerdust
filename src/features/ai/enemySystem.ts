import { Ship } from "../../core/ships/Ship";
import type { ShipClass, AiState } from "../../core/ships/shipTypes";
import type { ControlPoint } from "../../core/world/zones";
import { findNearestZone } from "../../core/world/zones";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { WEAPON_STATS } from "../../core/combat/weaponStats";
import { SHIP_CLASSES, type ShipAI } from "@speakerdust/shared";
import { getSpawnPosition } from "../../core/world/mapConfig";
import { clamp, uuid, distSq, shortestAngleDelta } from "../../core/math";

const ENEMY_TYPES: ShipClass[] = ["corvette", "destroyer", "missile_frigate", "cruiser", "battlecruiser", "battleship", "dreadnought"];

function approachAngle(current: number, desired: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, desired);
  return current + clamp(delta, -maxStep, maxStep);
}

export function createEnemyShip(shipClass: ShipClass, wave: number): { ship: Ship; ai: AiState } {
  const pos = getSpawnPosition();
  const def = SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!;
  const aiCfg = def.ai;

  const ship = new Ship({
    id: uuid(),
    controller: "ai",
    shipClass,
    x: pos.x,
    y: pos.y,
    angle: 0,
  });

  return {
    ship,
    ai: {
      targetId: undefined,
      lastSeenPos: undefined,
      reactionTicks: 0,
      aimJitter: 0,
      maneuverTimer: 0,
      maneuverDir: 1,
      strafing: false,
      frustration: 0,
      wave,
      formationIndex: 0,
      rangeState: "combat",
      rangeStateTimer: 0,
    },
  };
}

export function spawnWave(wave: number): Array<{ ship: Ship; ai: AiState }> {
  const results: Array<{ ship: Ship; ai: AiState }> = [];

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

export function countEnemyShips(ships: Ship[]): Record<ShipClass, number> {
  const counts: Record<string, number> = {};
  for (const s of ships) {
    if (s.controller === "ai" && s.alive) {
      counts[s.shipClass] = (counts[s.shipClass] ?? 0) + 1;
    }
  }
  return counts as Record<ShipClass, number>;
}

export function predictLeadAngle(shooterX: number, shooterY: number, target: Ship, weaponSpeed: number): number {
  const dx = target.x - shooterX;
  const dy = target.y - shooterY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (weaponSpeed <= 0.1 || dist === 0) {
    return Math.atan2(dy, dx);
  }

  const tvx = target.vx || 0;
  const tvy = target.vy || 0;

  let timeToImpact = dist / weaponSpeed;

  let futureX = target.x + tvx * timeToImpact;
  let futureY = target.y + tvy * timeToImpact;
  let futureDist = Math.sqrt((futureX - shooterX) ** 2 + (futureY - shooterY) ** 2);
  timeToImpact = futureDist / weaponSpeed;

  const finalX = target.x + tvx * timeToImpact;
  const finalY = target.y + tvy * timeToImpact;

  return Math.atan2(finalY - shooterY, finalX - shooterX);
}

/** Pick the best target: lowest HP within range, then nearest */
function pickTarget(enemy: Ship, alivePlayers: Ship[], aiCfg: ShipAI): Ship | null {
  let best: Ship | null = null;
  let bestScore = -Infinity;

  for (const p of alivePlayers) {
    const dSq = distSq(enemy, p);
    const dist = Math.sqrt(dSq);
    const hpPct = p.hp / Math.max(1, p.maxHp);

    let score = 0;
    score -= dist * 0.3;
    score -= hpPct * 500;
    if (p.empTicks > 0) score += 100;
    if (dist < aiCfg.evasionRange) score += 50;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Select the best weapon for current distance */
function selectBestWeapon(enemy: Ship, dist: number): void {
  const slots = enemy.weaponSlots;
  if (slots.length <= 1) return;

  let bestWeapon = slots[0]!;
  let bestScore = -Infinity;

  for (const w of slots) {
    const stats = WEAPON_STATS[w];
    if (!stats) continue;

    const maxRange = stats.speed * stats.life;
    const rangeScore = -Math.abs(dist - maxRange * 0.5);
    const dmgScore = stats.damage * 3 - stats.heat;
    const score = rangeScore + dmgScore;

    if (score > bestScore) {
      bestScore = score;
      bestWeapon = w;
    }
  }

  if (bestWeapon !== enemy.weapon) {
    enemy.weapon = bestWeapon;
  }
}

export function tickEnemyAI(
  enemy: Ship,
  ai: AiState,
  alivePlayers: Ship[],
  aliveEnemies: Ship[],
  enemyCounts: Record<ShipClass, number>,
  zones: Record<string, ControlPoint>,
): Ship | null {
  enemy.boostCooldown--;
  if (enemy.boostCooldown < 0) enemy.boostCooldown = 0;
  const def = SHIP_CLASSES[enemy.shipClass] ?? SHIP_CLASSES.corvette!;
  enemy.boostEnergy = Math.min(100, enemy.boostEnergy + def.stats.boostRegenRate);

  const stats = def.stats;
  const aiCfg = def.ai;

  // --- Target selection ---
  let target: Ship | null = null;
  let targetDist = Infinity;
  let targetDistSq = Infinity;

  if (ai.targetId) {
    const cached = alivePlayers.find(p => p.id === ai.targetId && p.alive);
    if (cached) {
      target = cached;
      targetDistSq = distSq(enemy, cached);
      targetDist = Math.sqrt(targetDistSq);
      ai.lastSeenPos = { x: cached.x, y: cached.y };
    }
  }

  if (!target) {
    target = pickTarget(enemy, alivePlayers, aiCfg);
    if (target) {
      ai.targetId = target.id;
      ai.lastSeenPos = { x: target.x, y: target.y };
      ai.reactionTicks = aiCfg.lockTicks;
      ai.frustration = 0;
    } else {
      ai.targetId = undefined;
    }
  }

  let desiredAngle = enemy.angle;

  if (target) {
    targetDistSq = distSq(enemy, target);
    targetDist = Math.sqrt(targetDistSq);

    if (ai.reactionTicks > 0) {
      ai.reactionTicks--;
    }

    // --- 1. Weapon selection FIRST ---
    selectBestWeapon(enemy, targetDist);

    // --- 2. Physics-based lead prediction ---
    const currentWeaponStats = WEAPON_STATS[enemy.weapon];
    const bulletSpeed = currentWeaponStats ? currentWeaponStats.speed : 10;
    const leadAngle = predictLeadAngle(enemy.x, enemy.y, target, bulletSpeed);

    // --- Range state machine with hysteresis ---
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dirX = dx / targetDist;
    const dirY = dy / targetDist;

    const closeThreshold = stats.idealRange * 0.5;
    const farThreshold = stats.idealRange * 1.5;

    ai.rangeStateTimer--;

    if (enemy.hp < enemy.maxHp * 0.25) {
      ai.rangeState = "retreating";
      ai.rangeStateTimer = 30;
    } else if (targetDist < closeThreshold && ai.rangeState !== "retreating") {
      ai.rangeState = "retreating";
      ai.rangeStateTimer = 40;
    } else if (targetDist > farThreshold && ai.rangeState !== "closing") {
      ai.rangeState = "closing";
      ai.rangeStateTimer = 40;
    } else if (ai.rangeStateTimer <= 0) {
      ai.rangeState = "combat";
    }

    // --- Boost logic ---
    const wantBoost = ai.rangeState === "closing"
      || (ai.rangeState === "retreating" && enemy.hp < enemy.maxHp * 0.25);
    if (wantBoost && enemy.boostCooldown <= 0 && enemy.boostEnergy >= 10 && aiCfg.boostAggression > 0) {
      if (ai.rangeState === "closing" && targetDist > stats.idealRange * 2) {
        enemy.boostQueued = true;
      }
      if (ai.rangeState === "retreating" && enemy.hp < enemy.maxHp * 0.25) {
        enemy.boostQueued = true;
      }
    }

    // --- Movement (exclusive state machine) ---
    const dirToTarget = Math.atan2(dy, dx);
    let moveX = 0;
    let moveY = 0;

    switch (ai.rangeState) {
      case "closing":
        moveX += dirX * aiCfg.seekSpeed;
        moveY += dirY * aiCfg.seekSpeed;
        break;

      case "combat": {
        const orbitPhase = ai.wave * 0.31 + ai.formationIndex * 0.73;
        const orbitSide = Math.sin(orbitPhase) >= 0 ? 1 : -1;
        const orbitAngle = dirToTarget + (Math.PI / 2) * orbitSide;
        moveX += Math.cos(orbitAngle) * aiCfg.orbitPower;
        moveY += Math.sin(orbitAngle) * aiCfg.orbitPower;

        ai.maneuverTimer = (ai.maneuverTimer || 0) - 1;
        if (ai.maneuverTimer <= 0) {
          ai.maneuverTimer = 60 + Math.random() * 60;
          ai.maneuverDir = Math.random() > 0.5 ? 1 : -1;
        }
        const strafeAngle = dirToTarget + Math.PI / 2;
        moveX += Math.cos(strafeAngle) * ai.maneuverDir * 0.4;
        moveY += Math.sin(strafeAngle) * ai.maneuverDir * 0.4;

        if (targetDist < aiCfg.evasionRange) {
          const evadeDir = (ai.formationIndex % 2 === 0 ? 1 : -1) * (enemy.id.charCodeAt(0) % 2 === 0 ? 1 : -1);
          const evadeAngle = dirToTarget + (Math.PI / 2) * evadeDir;
          moveX += Math.cos(evadeAngle) * 0.35;
          moveY += Math.sin(evadeAngle) * 0.35;
        }
        break;
      }

      case "retreating":
        moveX -= dirX * aiCfg.retreatSpeed;
        moveY -= dirY * aiCfg.retreatSpeed;
        break;
    }

    // --- Separation steering ---
    for (const other of aliveEnemies) {
      if (other.id === enemy.id || !other.alive) continue;
      const odx = enemy.x - other.x;
      const ody = enemy.y - other.y;
      const odSq = odx * odx + ody * ody;
      if (odSq < 6400) {
        const od = Math.sqrt(odSq) || 1;
        const repelStr = 0.6 * (1 - od / 80);
        moveX += (odx / od) * repelStr;
        moveY += (ody / od) * repelStr;
      }
    }

    const cos = Math.cos(enemy.angle);
    const sin = Math.sin(enemy.angle);
    enemy.inputForward = clamp(moveX * cos + moveY * sin, -1, 1);
    enemy.inputStrafe = clamp(moveX * -sin + moveY * cos, -1, 1);

    // SO: Decouple body rotation from turret aiming.
    // R: https://stackoverflow.com/questions/1731899/ai-turret-aiming-vs-body-rotation
    //    Body faces the TARGET directly (so rotation only changes when the target
    //    moves, not when the player's velocity vector changes).
    //    Turrets independently track the lead angle for precision aiming.
    desiredAngle = Math.atan2(dy, dx);
    enemy.targetAngle = leadAngle;

  } else {
    if (ai.lastSeenPos) {
      const dx = ai.lastSeenPos.x - enemy.x;
      const dy = ai.lastSeenPos.y - enemy.y;
      desiredAngle = Math.atan2(dy, dx);
      enemy.targetAngle = desiredAngle;
      enemy.inputForward = 0.6;
      enemy.inputStrafe = 0;
    } else {
      const nearestZone = findNearestZone(enemy.x, enemy.y, zones);
      if (nearestZone) {
        const dx = nearestZone.x - enemy.x;
        const dy = nearestZone.y - enemy.y;
        desiredAngle = Math.atan2(dy, dx);
        enemy.targetAngle = desiredAngle;
        enemy.inputForward = 0.4;
        enemy.inputStrafe = 0;
      } else {
        enemy.targetAngle = enemy.angle;
        enemy.inputForward = 0;
        enemy.inputStrafe = 0;
      }
    }
  }

  // BUGFIX: Clamp turn input using the shortest angular delta so that AI ships
  // turn at a physical rate instead of snapping immediately to the player's direction.
  const delta = shortestAngleDelta(enemy.angle, desiredAngle);
  enemy.inputTurn = clamp(delta * 1.5, -1, 1);

  return target;
}

export interface SplashKill {
  enemyId: string;
  x: number;
  y: number;
  shipClass: ShipClass;
  score: number;
}

export function dealSplashDamage(
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

    const result = enemy.takeDamage(finalDamage, false, false);

    if (result.dead) {
      const score = (SHIP_CLASSES[enemy.shipClass] ?? SHIP_CLASSES.corvette!).stats.score;
      kills.push({ enemyId: enemy.id, x: enemy.x, y: enemy.y, shipClass: enemy.shipClass, score });
    }
  }
  return kills;
}
