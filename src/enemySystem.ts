// enemySystem.ts (v2 · IA humanizada, sin ruido)
import {
  EnemyShip, PlayerShip, Bullet, AiKind, ControlPoint, WeaponKind,
  WORLD_W, WORLD_H,
  AI_KIND_CLASS, AI_STATS, WEAPON_STATS, classStats,
  clamp, rand, uuid, spawnPos, distSq, shortestAngleDelta,
} from "./gameState";

// ── Creación de enemigos con estado mental ───────────────
function createEnemyShip(kind: AiKind, wave: number): EnemyShip {
  const pos = spawnPos();
  const shipClass = AI_KIND_CLASS[kind];
  const stats = classStats(shipClass);
  const ai = AI_STATS[kind];
  const hpBonus = Math.floor((wave - 1) / 4) + ai.hpBonus;
  const hp = Math.max(2, stats.maxHp + hpBonus);
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
    maxSpeed: stats.maxSpeed * 0.92,
    thrustForce: stats.thrustForce * 0.9,
    strafeThrustForce: stats.strafeThrustForce * 0.75,
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
  // Enfriamiento de disparo
  if (enemy.shootCooldown > 0) enemy.shootCooldown--;

  const stats = AI_STATS[enemy.kind];
  const enemyStats = classStats(enemy.shipClass);

  // ── Memoria humana: mantener blanco si es posible ──
  let target: PlayerShip | null = null;
  let targetDistSq = Infinity;
  const currentTarget = alivePlayers.find(p => p.id === enemy.aiTargetId && p.alive);

  // Si el blanco actual sigue vivo y no está demasiado lejos (>1200), lo mantenemos
  if (currentTarget) {
    const dSq = distSq(enemy, currentTarget);
    if (dSq <= 1440000) { // 1200^2
      target = currentTarget;
      targetDistSq = dSq;
      // Actualizar última posición conocida
      enemy.aiLastSeenPos = { x: currentTarget.x, y: currentTarget.y };
    }
  }

  // Si no tenemos blanco, o está fuera de alcance, seleccionamos al más cercano
  if (!target) {
    for (const p of alivePlayers) {
      const dSq = distSq(enemy, p);
      if (dSq < targetDistSq) { targetDistSq = dSq; target = p; }
    }
    if (target) {
      enemy.aiTargetId = target.id;
      enemy.aiLastSeenPos = { x: target.x, y: target.y };
      enemy.aiReactionTicks = Math.floor(rand(4, 12)); // nuevo blanco → pequeño retraso
      enemy.aiFrustration = 0;
    }
  }

  // Si perdimos al blanco, usamos última posición conocida para movernos
  let aimTargetX: number, aimTargetY: number;
  if (target) {
    aimTargetX = target.x;
    aimTargetY = target.y;
  } else if (enemy.aiLastSeenPos) {
    aimTargetX = enemy.aiLastSeenPos.x;
    aimTargetY = enemy.aiLastSeenPos.y;
  } else {
    // Sin información, ir al centro del mapa
    aimTargetX = WORLD_W * 0.5;
    aimTargetY = WORLD_H * 0.5;
    enemy.aiTargetId = undefined;
  }

  // ── Apuntado humano (con retraso e imprecisión) ──
  let desiredAngle: number;
  if (target && targetDistSq <= 900 * 900) {
    // Predicción de movimiento (con error)
    const leadMul = enemy.kind === "battleship" || enemy.kind === "dreadnought" ? 25 : 16;
    // Error de predicción aleatorio (simula no poder calcular perfectamente)
    const noiseX = (Math.random() - 0.5) * 30;
    const noiseY = (Math.random() - 0.5) * 30;
    const leadX = target.x + target.vx * leadMul + noiseX;
    const leadY = target.y + target.vy * leadMul + noiseY;
    const baseAngle = Math.atan2(leadY - enemy.y, leadX - enemy.x);

    // Aplicar retraso de reacción: giro gradual hacia el ángulo deseado
    if (enemy.aiReactionTicks > 0) {
      enemy.aiReactionTicks--;
      // Durante el retraso, el ángulo avanza lentamente
      const turnSpeed = enemy.turnRate * 0.4; // más lento
      const delta = shortestAngleDelta(enemy.targetAngle, baseAngle);
      const step = clamp(delta, -turnSpeed, turnSpeed);
      desiredAngle = enemy.targetAngle + step;
    } else {
      desiredAngle = baseAngle + (Math.random() - 0.5) * enemy.aiAimJitter;
    }
  } else {
    // Sin blanco visible, apuntar hacia la última posición o zona
    desiredAngle = Math.atan2(aimTargetY - enemy.y, aimTargetX - enemy.x);
    // Movimiento de búsqueda: hacer pequeños barridos
    desiredAngle += Math.sin(Date.now() * 0.001 + enemy.id.charCodeAt(0)) * 0.3;
  }

  enemy.targetAngle = desiredAngle;

  // ── Movimiento humano (impredecible) ──
  // Actualizar temporizador de maniobra
  enemy.aiManeuverTimer--;
  if (enemy.aiManeuverTimer <= 0) {
    // Cambiar patrón de movimiento
    enemy.aiManeuverDir = Math.random() < 0.5 ? -1 : 1;
    enemy.aiStrafing = Math.random() < 0.6;
    enemy.aiManeuverTimer = Math.floor(rand(40, 110));
    // Si está frustrado, tiende a cambiar de blanco
    if (enemy.aiFrustration > 60 && target) {
      enemy.aiTargetId = undefined;
      enemy.aiFrustration = 0;
    }
  }

  let moveX = 0, moveY = 0;

  if (target) {
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;

    // Comportamiento basado en distancia ideal
    const seek = dist > stats.idealRange + 90;
    const retreat = dist < stats.idealRange - 110;
    const heavy = enemy.kind === "battleship" || enemy.kind === "dreadnought";
    const lineShip = enemy.kind === "destroyer" || enemy.kind === "cruiser";

    // Componente de acercarse/alejarse
    if (seek) { moveX += dirX * (heavy ? 0.45 : 0.85); moveY += dirY * (heavy ? 0.45 : 0.85); }
    if (retreat) { moveX -= dirX * (lineShip ? 0.6 : 0.4); moveY -= dirY * (lineShip ? 0.6 : 0.4); }

    // Órbita humana: dirección variable con el temporizador de maniobra
    const orbitAngle = enemy.targetAngle + Math.PI / 2 * enemy.aiManeuverDir;
    const orbitX = Math.cos(orbitAngle) * (heavy ? 0.3 : lineShip ? 0.55 : 0.8);
    const orbitY = Math.sin(orbitAngle) * (heavy ? 0.3 : lineShip ? 0.55 : 0.8);
    moveX += orbitX;
    moveY += orbitY;

    // Strafing lateral impredecible
    if (enemy.aiStrafing) {
      const strafeAngle = enemy.targetAngle + Math.PI / 2 * (Math.sin(Date.now() * 0.003 + enemy.id.charCodeAt(2)) > 0 ? 1 : -1);
      moveX += Math.cos(strafeAngle) * 0.3;
      moveY += Math.sin(strafeAngle) * 0.3;
    }

    // Si la salud está baja, priorizar retirada
    if (enemy.hp < enemy.maxHp * 0.3) {
      moveX -= dirX * 0.7;
      moveY -= dirY * 0.7;
    }
  } else {
    // Sin blanco: moverse hacia el punto objetivo (zona o última posición)
    const dx = aimTargetX - enemy.x;
    const dy = aimTargetY - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;
    moveX = dx / dist;
    moveY = dy / dist;
    // Pequeño zigzag de búsqueda
    const zig = Math.sin(Date.now() * 0.002 + enemy.id.charCodeAt(0)) * 0.3;
    moveX += zig;
    moveY += zig;
  }

  // Convertir a avance/strafe relativo al ángulo actual
  const cos = Math.cos(enemy.angle);
  const sin = Math.sin(enemy.angle);
  enemy.inputForward = clamp(moveX * cos + moveY * sin, -1, 1);
  enemy.inputStrafe = clamp(moveX * -sin + moveY * cos, -1, 1);

  // Si no hay blanco, bajar la frustración lentamente
  if (!target) enemy.aiFrustration = Math.max(0, enemy.aiFrustration - 0.5);
}

// ── Decisión de disparo (sin cambios, pero con frustración) ──
export function shouldEnemyFire(enemy: EnemyShip, targetDistSq: number): boolean {
  if (enemy.shootCooldown > 0 || enemy.weaponHeat >= 95) return false;
  const range = (AI_STATS[enemy.kind].idealRange + 180) ** 2;
  const canFire = targetDistSq <= range;
  // Aumentar frustración si no dispara por mucho tiempo
  if (!canFire) enemy.aiFrustration += 0.2;
  return canFire;
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