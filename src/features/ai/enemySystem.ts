// enemySystem.ts (v3 · IA humanizada, consistente con el jugador)
import {
  EnemyShip, PlayerShip, AiKind,
} from "../../core/ships/shipTypes";
import type { ControlPoint } from "../../core/world/zones";
import type { Bullet, WeaponKind } from "../../core/combat/weaponStats";
import { WEAPON_STATS } from "../../core/combat/weaponStats";
import { WORLD_W, WORLD_H, spawnPos } from "../../core/world/mapConfig";
import { AI_KIND_CLASS, AI_STATS, classStats } from "../../core/ships/shipStats";
import { clamp, rand, uuid, distSq, shortestAngleDelta } from "../../core/math";

function approachAngle(current: number, desired: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, desired);
  return current + clamp(delta, -maxStep, maxStep);
}

// ── Creación de enemigos con estado mental ───────────────
function createEnemyShip(kind: AiKind, wave: number): EnemyShip {
  const pos = spawnPos();
  const shipClass = AI_KIND_CLASS[kind];
  const stats = classStats(shipClass);
  const ai = AI_STATS[kind];
  // Cap health scaling at 1.6x base maxHp to prevent immortals
  const scaledBonus = Math.min(stats.maxHp * 0.6, Math.floor((wave - 1) / 4));
  const hp = Math.max(2, stats.maxHp + scaledBonus + ai.hpBonus);
  const weapon = ai.preferredWeapon;
  return {
    id: uuid(),
    controller: "ai",
    shipClass,
    role: stats.role,
    mass: stats.mass,
    turnRate: stats.turnRate,
    weaponSlots: [...stats.weaponSlots],
    ...pos,
    vx: 0, vy: 0,
    angle: 0,
    targetAngle: 0,
    hp, maxHp: hp,
    armorMax: stats.armorMax,
    armor: stats.armorMax,
    shieldMax: Math.max(0, stats.shieldMax - 1),
    shield: Math.max(0, stats.shieldMax - 1),
    shieldRegenDelay: 0,
    weapon,
    shootCooldown: Math.floor(Math.random() * 60),
    weaponHeat: 0,
    boostEnergy: 0,
    boostCooldown: 0,
    boostQueued: false,
    empTicks: 0,
    inputForward: 0,
    inputStrafe: 0,
    iFrames: 0,
    alive: true,
    kind, wave,
    formationIndex: 0,
    drag: stats.drag,
    maxSpeed: stats.maxSpeed,
    thrustForce: stats.thrustForce,
    strafeThrustForce: stats.strafeThrustForce,
    // ── IA humana ──
    aiReactionTicks: Math.floor(rand(4, 12)),
    aiAimJitter: kind === "corvette" || kind === "destroyer" ? 0.07 : 0.04,
    aiManeuverTimer: Math.floor(rand(30, 90)),
    aiManeuverDir: Math.random() < 0.5 ? -1 : 1,
    aiStrafing: Math.random() < 0.5,
    aiFrustration: 0,
  };
}

// ── Oleadas (sin cambios) ─────────────────────────────────
export function spawnWave(wave: number): EnemyShip[] {
  const enemies: EnemyShip[] = [];
  const corvettes = Math.min(2 + Math.ceil(wave * 0.8), 12);
  const destroyers = Math.min(Math.max(1, Math.floor(wave / 2)), 7);
  const frigates = Math.min(Math.max(0, Math.floor((wave - 2) / 3)), 5);
  const cruisers = Math.min(Math.max(0, Math.floor((wave - 4) / 4)), 4);
  const battleships = Math.min(Math.max(0, Math.floor((wave - 7) / 5)), 2);
  const dreadnoughts = wave >= 12 && wave % 4 === 0 ? 1 : 0;

  for (let i = 0; i < corvettes; i++) enemies.push(createEnemyShip("corvette", wave));
  for (let i = 0; i < destroyers; i++) enemies.push(createEnemyShip("destroyer", wave));
  for (let i = 0; i < frigates; i++) enemies.push(createEnemyShip("frigate", wave));
  for (let i = 0; i < cruisers; i++) enemies.push(createEnemyShip("cruiser", wave));
  for (let i = 0; i < battleships; i++) enemies.push(createEnemyShip("battleship", wave));
  for (let i = 0; i < dreadnoughts; i++) enemies.push(createEnemyShip("dreadnought", wave));

  assignFormationIndices(enemies);
  return enemies;
}

export function assignFormationIndices(enemies: EnemyShip[]): void {
  const counters: Record<AiKind, number> = {
    corvette: 0,
    destroyer: 0,
    frigate: 0,
    cruiser: 0,
    battleship: 0,
    dreadnought: 0,
  };
  for (const e of enemies) e.formationIndex = counters[e.kind]++;
}

export function computeEnemyCounts(enemies: EnemyShip[]): Record<AiKind, number> {
  const counts: Record<AiKind, number> = {
    corvette: 0,
    destroyer: 0,
    frigate: 0,
    cruiser: 0,
    battleship: 0,
    dreadnought: 0,
  };
  for (const e of enemies) counts[e.kind]++;
  return counts;
}

// ── Actualización de entradas (IA humanizada) ───────────
export function updateEnemyInputs(
  enemy: EnemyShip,
  alivePlayers: PlayerShip[],
  enemyCounts: Record<AiKind, number>,
  nearestZone: Pick<ControlPoint, "x" | "y" | "radius"> | null,
): void {
  if (enemy.shootCooldown > 0) enemy.shootCooldown--;

  const stats = AI_STATS[enemy.kind];

  // ── Selección de blanco: mantener el actual si sigue vivo ──
  let target: PlayerShip | null = null;
  let targetDistSq = Infinity;

  const currentTarget = alivePlayers.find(p => p.id === enemy.aiTargetId && p.alive);

  if (currentTarget) {
    const dSq = distSq(enemy, currentTarget);
    target = currentTarget;
    targetDistSq = dSq;
    enemy.aiLastSeenPos = { x: currentTarget.x, y: currentTarget.y };
  }

  // Si no hay blanco válido, buscar el más cercano
  if (!target) {
    for (const p of alivePlayers) {
      const dSq = distSq(enemy, p);
      if (dSq < targetDistSq) {
        targetDistSq = dSq;
        target = p;
      }
    }
    if (target) {
      enemy.aiTargetId = target.id;
      enemy.aiLastSeenPos = { x: target.x, y: target.y };
      enemy.aiReactionTicks = Math.floor(rand(4, 10));
      enemy.aiFrustration = 0;
    } else {
      enemy.aiTargetId = undefined;
    }
  }

  // Objetivo de navegación si no hay blanco visible
  let aimTargetX = WORLD_W * 0.5;
  let aimTargetY = WORLD_H * 0.5;

  if (target) {
    aimTargetX = target.x;
    aimTargetY = target.y;
  } else if (enemy.aiLastSeenPos) {
    aimTargetX = enemy.aiLastSeenPos.x;
    aimTargetY = enemy.aiLastSeenPos.y;
  } else if (nearestZone) {
    aimTargetX = nearestZone.x;
    aimTargetY = nearestZone.y;
  }

  // ── Puntería: predicción suave + error pequeño + giro limitado ──
  let desiredAngle = enemy.angle;

  if (target) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    const leadMul =
      enemy.kind === "battleship" || enemy.kind === "dreadnought" ? 22 : 14;

    // Ruido muy moderado para que no parezca robot perfecto
    const aimNoise =
      enemy.kind === "corvette" ? 0.09 :
        enemy.kind === "destroyer" ? 0.07 :
          enemy.kind === "frigate" ? 0.06 :
            enemy.kind === "cruiser" ? 0.05 : 0.04;

    const predictX = target.x + target.vx * leadMul;
    const predictY = target.y + target.vy * leadMul;
    const noisyX = predictX + (Math.random() - 0.5) * 24;
    const noisyY = predictY + (Math.random() - 0.5) * 24;

    const rawAngle = Math.atan2(noisyY - enemy.y, noisyX - enemy.x);

    // Retraso de reacción: al comienzo del contacto gira más lento
    if (enemy.aiReactionTicks > 0) {
      enemy.aiReactionTicks--;
      desiredAngle = approachAngle(enemy.angle, rawAngle, enemy.turnRate * 0.45);
    } else {
      desiredAngle = rawAngle + (Math.random() - 0.5) * aimNoise;
    }

    // Si el blanco está muy lejos, recuerda su posición pero no “adivines” demasiado
    if (dist > 1400) {
      enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 0.15);
    }
  } else {
    const dx = aimTargetX - enemy.x;
    const dy = aimTargetY - enemy.y;
    desiredAngle = Math.atan2(dy, dx);
  }

  // Giro final: igual que un jugador con límite real de turnRate
  enemy.targetAngle = approachAngle(enemy.angle, desiredAngle, enemy.turnRate);

  // ── Movimiento: navegación estable y legible ──
  enemy.aiManeuverTimer--;

  if (enemy.aiManeuverTimer <= 0) {
    enemy.aiManeuverDir = Math.random() < 0.5 ? -1 : 1;
    enemy.aiStrafing = Math.random() < 0.55;
    enemy.aiManeuverTimer = Math.floor(rand(40, 95));

    if (enemy.aiFrustration > 60 && target) {
      enemy.aiTargetId = undefined;
      enemy.aiFrustration = 0;
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

    const heavy = enemy.kind === "battleship" || enemy.kind === "dreadnought";
    const lineShip = enemy.kind === "destroyer" || enemy.kind === "cruiser";

    if (seek) {
      moveX += dirX * (heavy ? 0.45 : 0.8);
      moveY += dirY * (heavy ? 0.45 : 0.8);
    }

    if (retreat) {
      moveX -= dirX * (lineShip ? 0.55 : 0.35);
      moveY -= dirY * (lineShip ? 0.55 : 0.35);
    }

    const orbitPhase = enemy.wave * 0.35 + enemy.formationIndex * 0.7 + enemy.aiManeuverTimer * 0.06;
    const orbitSide = Math.sin(orbitPhase) >= 0 ? 1 : -1;
    const orbitAngle = enemy.targetAngle + (Math.PI / 2) * enemy.aiManeuverDir * orbitSide;

    const orbitPower = heavy ? 0.28 : lineShip ? 0.48 : 0.72;
    moveX += Math.cos(orbitAngle) * orbitPower;
    moveY += Math.sin(orbitAngle) * orbitPower;

    if (enemy.aiStrafing) {
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

    const zigPhase = enemy.wave * 0.25 + enemy.formationIndex * 0.5 + enemy.aiManeuverTimer * 0.08;
    const zig = Math.sin(zigPhase) * 0.22;

    moveX += zig;
    moveY += zig * 0.8;
  }

  // Convertir a inputs relativos al ángulo real actual
  const cos = Math.cos(enemy.angle);
  const sin = Math.sin(enemy.angle);

  enemy.inputForward = clamp(moveX * cos + moveY * sin, -1, 1);
  enemy.inputStrafe = clamp(moveX * -sin + moveY * cos, -1, 1);

  if (!target) {
    enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 0.4);
  }
}

// ── Decisión de disparo: consistente con puntería y distancia ──
export function shouldEnemyFire(
  enemy: EnemyShip,
  targetDistSq: number,
  aimErrorRad: number = 0,
): boolean {
  if (enemy.shootCooldown > 0 || enemy.weaponHeat >= 95) return false;

  const rangeSq = (AI_STATS[enemy.kind].idealRange + 180) ** 2;
  const canReach = targetDistSq <= rangeSq;

  if (!canReach) {
    enemy.aiFrustration += 0.2;
    return false;
  }

  // La IA no dispara si aún no está razonablemente orientada
  const maxAimError =
    enemy.kind === "dreadnought" || enemy.kind === "battleship" ? 0.26 :
      enemy.kind === "cruiser" ? 0.30 :
        0.34;

  if (Math.abs(aimErrorRad) > maxAimError) return false;

  return true;
}

// ── Generación de proyectiles (igual que antes) ──────────
export function generateEnemyBullets(enemy: EnemyShip, target: PlayerShip): Bullet[] {
  const weapon = AI_STATS[enemy.kind].preferredWeapon;
  const stats = WEAPON_STATS[weapon];
  const leadX = target.x + target.vx * (weapon === "railgun" ? 30 : 18);
  const leadY = target.y + target.vy * (weapon === "railgun" ? 30 : 18);
  const ang = Math.atan2(leadY - enemy.y, leadX - enemy.x);
  enemy.weapon = weapon;
  enemy.shootCooldown = Math.round(stats.cooldown * AI_STATS[enemy.kind].shootRateMul);
  enemy.weaponHeat = Math.min(130, enemy.weaponHeat + stats.heat);
  enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 30); // disparar alivia

  const bullets: Bullet[] = [];
  const count = weapon === "plasma_broadside" ? 3 : weapon === "autocannon" ? 2 : 1;
  const offsets = count === 3 ? [-0.18, 0, 0.18] : count === 2 ? [-0.06, 0.06] : [0];

  for (const off of offsets) {
    const a = ang + off;
    bullets.push(makeBullet(enemy.id, "ai", enemy.x, enemy.y, a, weapon));
  }
  return bullets;
}

export function makeBullet(
  ownerId: string,
  ownerController: "player" | "ai",
  x: number,
  y: number,
  angle: number,
  kind: WeaponKind,
  targetId?: string,
): Bullet {
  const stats = WEAPON_STATS[kind];
  return {
    id: uuid(),
    ownerId,
    ownerController,
    x, y,
    vx: Math.cos(angle) * stats.speed,
    vy: Math.sin(angle) * stats.speed,
    angle,
    life: stats.life,
    kind,
    damage: stats.damage,
    splashRadius: stats.splashRadius,
    radius: stats.radius,
    targetId,
    statusEffect: stats.statusEffect,
    detonateAtLife: stats.detonateAtLife,
    turnRate: stats.turnRate,
  };
}

// ── Daño en área (sin cambios) ─────────────────────────
export interface SplashKill {
  enemyId: string;
  x: number;
  y: number;
  kind: AiKind;
  score: number;
}

export function applyBulletSplash(
  ownerId: string,
  x: number,
  y: number,
  damage: number,
  splashRadius: number,
  enemies: EnemyShip[],
  excludedEnemyId?: string,
): SplashKill[] {
  if (splashRadius <= 0) return [];
  const kills: SplashKill[] = [];
  const rSq = splashRadius * splashRadius;

  for (const enemy of enemies) {
    if (enemy.id === excludedEnemyId || !enemy.alive) continue;
    const dSq = distSq({ x, y }, enemy);
    if (dSq > rSq) continue;
    const falloff = 1 - Math.sqrt(dSq) / splashRadius;
    enemy.hp -= Math.max(1, Math.round(damage * falloff));
    if (enemy.hp <= 0) {
      enemy.alive = false;
      const { score } = AI_STATS[enemy.kind];
      kills.push({ enemyId: enemy.id, x: enemy.x, y: enemy.y, kind: enemy.kind, score });
    }
  }
  return kills;
}
