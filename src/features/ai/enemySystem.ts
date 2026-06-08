// enemySystem.ts (v4 – IA simétrica, sin ventajas sobre el jugador)
import {
  EnemyShip, PlayerShip, AiKind,
} from "../../core/ships/shipTypes";
import type { ControlPoint } from "../../core/world/zones";
import type { WeaponKind } from "../../core/combat/weaponStats";
import { WEAPON_STATS } from "../../core/combat/weaponStats";
import { createProjectile, type Projectile } from "../../core/combat/projectiles";
import { WORLD_W, WORLD_H, spawnPos } from "../../core/world/mapConfig";
import { AI_KIND_CLASS, AI_STATS, classStats } from "../../core/ships/shipStats";
import { clamp, rand, uuid, distSq, shortestAngleDelta } from "../../core/math";
import { applyShipDamage } from "../physics/playerSystem";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function approachAngle(current: number, desired: number, maxStep: number): number {
  const delta = shortestAngleDelta(current, desired);
  return current + clamp(delta, -maxStep, maxStep);
}

// ---------------------------------------------------------------------------
// Creación de naves enemigas (idénticas estadísticas base que el jugador)
// ---------------------------------------------------------------------------
function createEnemyShip(kind: AiKind, wave: number): EnemyShip {
  const pos = spawnPos();
  const shipClass = AI_KIND_CLASS[kind];
  const stats = classStats(shipClass);
  const ai = AI_STATS[kind];

  // Escalado de vida por oleada limitado (máx 60% de la vida base)
  const waveBonus = Math.floor((wave - 1) / 3) * 2; // 2 HP extra cada 3 oleadas
  const maxBonus = Math.floor(stats.maxHp * 0.6);
  const scaledBonus = Math.min(waveBonus, maxBonus);

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
    hp,
    maxHp: hp,
    armorMax: stats.armorMax,
    armor: stats.armorMax,
    // Mismos escudos que el jugador de esa clase (sin debuff)
    shieldMax: stats.shieldMax,
    shield: stats.shieldMax,
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
    // Física idéntica a la del jugador de su clase
    drag: stats.drag,
    maxSpeed: stats.maxSpeed,
    thrustForce: stats.thrustForce,
    strafeThrustForce: stats.strafeThrustForce,
    // IA humanizada
    aiReactionTicks: Math.floor(rand(4, 12)),
    aiAimJitter: kind === "corvette" || kind === "destroyer" ? 0.07 : 0.04,
    aiManeuverTimer: Math.floor(rand(30, 90)),
    aiManeuverDir: Math.random() < 0.5 ? -1 : 1,
    aiStrafing: Math.random() < 0.5,
    aiFrustration: 0,
  };
}

// ---------------------------------------------------------------------------
// Oleadas (sin cambios)
// ---------------------------------------------------------------------------
export function spawnWave(wave: number): EnemyShip[] {
  const enemies: EnemyShip[] = [];
  const corvettes = Math.min(2 + Math.ceil(wave * 0.5), 8);
  const destroyers = Math.min(Math.max(0, Math.floor(wave / 3)), 5);
  const frigates = Math.min(Math.max(0, Math.floor((wave - 3) / 4)), 4);
  const cruisers = Math.min(Math.max(0, Math.floor((wave - 6) / 5)), 3);
  const battleships = Math.min(Math.max(0, Math.floor((wave - 10) / 6)), 2);
  const dreadnoughts = wave >= 15 && wave % 5 === 0 ? 1 : 0;

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
    corvette: 0, destroyer: 0, frigate: 0, cruiser: 0, battleship: 0, dreadnought: 0,
  };
  for (const e of enemies) e.formationIndex = counters[e.kind]++;
}

export function computeEnemyCounts(enemies: EnemyShip[]): Record<AiKind, number> {
  const counts: Record<AiKind, number> = {
    corvette: 0, destroyer: 0, frigate: 0, cruiser: 0, battleship: 0, dreadnought: 0,
  };
  for (const e of enemies) counts[e.kind]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Actualización de entradas (IA humanizada)
// ---------------------------------------------------------------------------
export function updateEnemyInputs(
  enemy: EnemyShip,
  alivePlayers: PlayerShip[],
  enemyCounts: Record<AiKind, number>,
  nearestZone: Pick<ControlPoint, "x" | "y" | "radius"> | null,
): void {
  if (enemy.shootCooldown > 0) enemy.shootCooldown--;

  const stats = AI_STATS[enemy.kind];

  // ── Selección de blanco ──
  let target: PlayerShip | null = null;
  let targetDistSq = Infinity;

  const currentTarget = alivePlayers.find(p => p.id === enemy.aiTargetId && p.alive);
  if (currentTarget) {
    const dSq = distSq(enemy, currentTarget);
    target = currentTarget;
    targetDistSq = dSq;
    enemy.aiLastSeenPos = { x: currentTarget.x, y: currentTarget.y };
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
      enemy.aiTargetId = target.id;
      enemy.aiLastSeenPos = { x: target.x, y: target.y };
      enemy.aiReactionTicks = Math.floor(rand(4, 10));
      enemy.aiFrustration = 0;
    } else {
      enemy.aiTargetId = undefined;
    }
  }

  // Punto de navegación por defecto
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

  // ── Puntería ──
  let desiredAngle = enemy.angle;
  if (target) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    const leadMul = (enemy.kind === "battleship" || enemy.kind === "dreadnought") ? 22 : 14;
    const aimNoise = enemy.kind === "corvette" ? 0.09
      : enemy.kind === "destroyer" ? 0.07
        : enemy.kind === "frigate" ? 0.06
          : enemy.kind === "cruiser" ? 0.05 : 0.04;

    const predictX = target.x + target.vx * leadMul;
    const predictY = target.y + target.vy * leadMul;
    const noisyX = predictX + (Math.random() - 0.5) * 24;
    const noisyY = predictY + (Math.random() - 0.5) * 24;

    const rawAngle = Math.atan2(noisyY - enemy.y, noisyX - enemy.x);

    if (enemy.aiReactionTicks > 0) {
      enemy.aiReactionTicks--;
      desiredAngle = approachAngle(enemy.angle, rawAngle, enemy.turnRate * 0.45);
    } else {
      desiredAngle = rawAngle + (Math.random() - 0.5) * aimNoise;
    }

    if (dist > 1400) {
      enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 0.15);
    }
  } else {
    const dx = aimTargetX - enemy.x;
    const dy = aimTargetY - enemy.y;
    desiredAngle = Math.atan2(dy, dx);
  }

  enemy.targetAngle = approachAngle(enemy.angle, desiredAngle, enemy.turnRate);

  // ── Movimiento ──
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

  // Convertir a inputs relativos al ángulo real de la nave
  const cos = Math.cos(enemy.angle);
  const sin = Math.sin(enemy.angle);
  enemy.inputForward = clamp(moveX * cos + moveY * sin, -1, 1);
  enemy.inputStrafe = clamp(moveX * -sin + moveY * cos, -1, 1);

  if (!target) {
    enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 0.4);
  }
}

// ---------------------------------------------------------------------------
// Decisión de disparo
// ---------------------------------------------------------------------------
export function shouldEnemyFire(
  enemy: EnemyShip,
  targetDistSq: number,
  aimErrorRad: number = 0,
): boolean {
  if (enemy.shootCooldown > 0 || enemy.weaponHeat >= 95) return false;

  const rangeSq = (AI_STATS[enemy.kind].idealRange + 180) ** 2;
  if (targetDistSq > rangeSq) {
    enemy.aiFrustration += 0.2;
    return false;
  }

  const maxAimError =
    enemy.kind === "dreadnought" || enemy.kind === "battleship" ? 0.26 :
      enemy.kind === "cruiser" ? 0.30 : 0.34;

  return Math.abs(aimErrorRad) <= maxAimError;
}

// ---------------------------------------------------------------------------
// Generación de proyectiles enemigos (igual lógica que el jugador)
// ---------------------------------------------------------------------------
export function generateEnemyBullets(enemy: EnemyShip, target: PlayerShip): Projectile[] {
  const weapon = AI_STATS[enemy.kind].preferredWeapon;
  const stats = WEAPON_STATS[weapon];

  const leadX = target.x + target.vx * (weapon === "railgun" ? 30 : 18);
  const leadY = target.y + target.vy * (weapon === "railgun" ? 30 : 18);
  const ang = Math.atan2(leadY - enemy.y, leadX - enemy.x);

  enemy.weapon = weapon;
  enemy.shootCooldown = Math.round(stats.cooldown * AI_STATS[enemy.kind].shootRateMul);
  enemy.weaponHeat = Math.min(130, enemy.weaponHeat + stats.heat);
  enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 30);

  const projectiles: Projectile[] = [];
  const count = weapon === "plasma_broadside" ? 3 : weapon === "autocannon" ? 2 : 1;
  const offsets = count === 3 ? [-0.18, 0, 0.18] : count === 2 ? [-0.06, 0.06] : [0];

  for (const off of offsets) {
    projectiles.push(createProjectile(enemy.id, "ai", enemy.x, enemy.y, ang + off, weapon));
  }
  return projectiles;
}

// ---------------------------------------------------------------------------
// Daño en área simétrico (usa la misma tubería de daño que el jugador)
// ---------------------------------------------------------------------------
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
  const splashDmg = Math.max(1, Math.round(damage * 0.7)); // mismo factor que las explosiones del jugador

  for (const enemy of enemies) {
    if (enemy.id === excludedEnemyId || !enemy.alive) continue;
    const dSq = distSq({ x, y }, enemy);
    if (dSq > rSq) continue;

    const distance = Math.sqrt(dSq);
    const falloff = 1 - distance / splashRadius;
    const finalDamage = Math.max(1, Math.round(splashDmg * falloff));

    // Usamos la misma función de daño que el jugador (escudos, blindaje, iFrames)
    const result = applyShipDamage(enemy, finalDamage, false, false);

    if (result.dead) {
      const { score } = AI_STATS[enemy.kind];
      kills.push({ enemyId: enemy.id, x: enemy.x, y: enemy.y, kind: enemy.kind, score });
    }
  }
  return kills;
}