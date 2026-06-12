import { Ship } from "../../core/ships/Ship";
import type { ShipClass, AiState } from "../../core/ships/shipTypes";
import type { ControlPoint } from "../../core/world/zones";
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

export function predictLeadAngle(x: number, y: number, target: Ship, lead: number): number {
  const leadX = target.x + target.vx * lead;
  const leadY = target.y + target.vy * lead;
  return Math.atan2(leadY - y, leadX - x);
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
    score -= hpPct * 100;
    if (p.empTicks > 0) score += 30;
    if (dist < aiCfg.evasionRange) score += 20;

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
  enemyCounts: Record<ShipClass, number>,
  nearestZone: Pick<ControlPoint, "x" | "y" | "radius"> | null,
): void {
  enemy.boostCooldown--;
  if (enemy.boostCooldown < 0) enemy.boostCooldown = 0;
  enemy.boostEnergy = Math.min(100, enemy.boostEnergy + (SHIP_CLASSES[enemy.shipClass] ?? SHIP_CLASSES.corvette!).stats.boostRegenRate);

  const def = SHIP_CLASSES[enemy.shipClass] ?? SHIP_CLASSES.corvette!;
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

  // --- Aim logic (deterministic lead prediction) ---
  let desiredAngle = enemy.angle;

  if (target) {
    targetDistSq = distSq(enemy, target);
    targetDist = Math.sqrt(targetDistSq);

    if (ai.reactionTicks > 0) {
      ai.reactionTicks--;
    }

    const leadTicks = aiCfg.leadMul;
    const rawAngle = predictLeadAngle(enemy.x, enemy.y, target, leadTicks);
    desiredAngle = rawAngle;

    // --- Weapon selection ---
    selectBestWeapon(enemy, targetDist);

    // --- Range management ---
    const margin = 60;
    const seek = targetDist > stats.idealRange + margin;
    const retreat = targetDist < stats.idealRange - margin;

    // --- Boost logic ---
    const wantBoost = seek && enemy.boostCooldown <= 0 && enemy.boostEnergy >= 10 && aiCfg.boostAggression > 0;
    if (wantBoost && (alivePlayers.length <= 3 || targetDist > stats.idealRange * 2)) {
      enemy.boostQueued = true;
    }

    // --- Evasion: when in threat range, strafe perpendicular ---
    const inDanger = targetDist < aiCfg.evasionRange;
    const evadeDir = (ai.formationIndex % 2 === 0 ? 1 : -1) * (enemy.id.charCodeAt(0) % 2 === 0 ? 1 : -1);

    // --- Movement: combine seek/retreat + orbit + evasion ---
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dirX = dx / targetDist;
    const dirY = dy / targetDist;

    let moveX = 0;
    let moveY = 0;

    if (seek) {
      moveX += dirX * aiCfg.seekSpeed;
      moveY += dirY * aiCfg.seekSpeed;
    }
    if (retreat) {
      moveX -= dirX * aiCfg.retreatSpeed;
      moveY -= dirY * aiCfg.retreatSpeed;
    }

    // Orbit around target (deterministic based on ship id and wave)
    const orbitPhase = ai.wave * 0.31 + ai.formationIndex * 0.73;
    const orbitSide = Math.sin(orbitPhase) >= 0 ? 1 : -1;
    const orbitAngle = desiredAngle + (Math.PI / 2) * orbitSide;
    moveX += Math.cos(orbitAngle) * aiCfg.orbitPower;
    moveY += Math.sin(orbitAngle) * aiCfg.orbitPower;

    // Evasion: when in danger, add perpendicular movement
    if (inDanger) {
      const evadeAngle = desiredAngle + (Math.PI / 2) * evadeDir;
      moveX += Math.cos(evadeAngle) * 0.35;
      moveY += Math.sin(evadeAngle) * 0.35;
    }

    // Retreat when critically damaged
    if (enemy.hp < enemy.maxHp * 0.25) {
      moveX -= dirX * 0.6;
      moveY -= dirY * 0.6;
    }

    const cos = Math.cos(enemy.angle);
    const sin = Math.sin(enemy.angle);
    enemy.inputForward = clamp(moveX * cos + moveY * sin, -1, 1);
    enemy.inputStrafe = clamp(moveX * -sin + moveY * cos, -1, 1);

  } else {
    // No target: move toward last known position or zone center
    if (ai.lastSeenPos) {
      const dx = ai.lastSeenPos.x - enemy.x;
      const dy = ai.lastSeenPos.y - enemy.y;
      desiredAngle = Math.atan2(dy, dx);
      enemy.inputForward = 0.6;
      enemy.inputStrafe = 0;
    } else if (nearestZone) {
      const dx = nearestZone.x - enemy.x;
      const dy = nearestZone.y - enemy.y;
      desiredAngle = Math.atan2(dy, dx);
      enemy.inputForward = 0.4;
      enemy.inputStrafe = 0;
    } else {
      enemy.inputForward = 0;
      enemy.inputStrafe = 0;
    }
  }

  enemy.targetAngle = approachAngle(enemy.angle, desiredAngle, enemy.turnRate);
}

export function tickEnemyCombat(
  enemy: Ship,
  ai: AiState,
  alivePlayers: Ship[],
  fireEnemyWeapon: (enemy: Ship, target: Ship) => void,
): void {
  if (alivePlayers.length === 0) return;

  let closestPlayer: Ship | null = null;
  let closestDSq = Infinity;

  if (ai.targetId) {
    const target = alivePlayers.find(p => p.id === ai.targetId);
    if (target) {
      const dSq = distSq(enemy, target);
      closestPlayer = target;
      closestDSq = dSq;
    }
  }

  if (!closestPlayer) {
    for (const p of alivePlayers) {
      const dSq = distSq(enemy, p);
      if (dSq < closestDSq) {
        closestDSq = dSq;
        closestPlayer = p;
      }
    }
  }

  if (!closestPlayer) return;

  fireEnemyWeapon(enemy, closestPlayer);
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
