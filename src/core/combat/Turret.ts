import type { WeaponKind } from "./weaponStats";
import { WEAPON_STATS } from "./weaponStats";
import { SHIP_HEAT_LIMIT } from "../ships/shipStats";
import { clamp, shortestAngleDelta } from "../math";

export interface TurretConfig {
  attachmentId: string;
  weaponKind: WeaponKind;
  x: number;
  y: number;
  minAngle: number;
  maxAngle: number;
  turnRate: number;
  size: "small" | "medium" | "large";
  restAngle: number;
}

/**
 * Normaliza un ángulo para que siempre se mantenga en el rango de [-PI, PI].
 * Evita desbordamientos y fallos en las matemáticas de rotación.
 */
export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Turret {
  public readonly attachmentId: string;
  public readonly weaponKind: WeaponKind;
  public readonly x: number;
  public readonly y: number;
  public readonly minAngle: number;
  public readonly maxAngle: number;
  public readonly baseTurnRate: number;
  public readonly size: "small" | "medium" | "large";
  public readonly restAngle: number;

  public angle: number;
  public targetAngle: number;

  public cooldown: number;
  public heat: number;
  public enabled: boolean;

  // --- Escalabilidad: Modificadores de estado (Buffs / Debuffs) ---
  public turnRateMultiplier: number = 1.0;
  public cooldownMultiplier: number = 1.0;
  public heatGenerationMultiplier: number = 1.0;

  // --- Adaptabilidad: Permite a las IA o PDCs apuntar independientemente ---
  private independentTargetAngle: number | null = null;
  private readonly OVERHEAT_BUFFER = 40;

  constructor(config: TurretConfig) {
    this.attachmentId = config.attachmentId;
    this.weaponKind = config.weaponKind;
    this.x = config.x;
    this.y = config.y;
    this.minAngle = config.minAngle;
    this.maxAngle = config.maxAngle;
    this.baseTurnRate = config.turnRate;
    this.size = config.size;
    this.restAngle = config.restAngle;

    this.angle = config.restAngle;
    this.targetAngle = config.restAngle;
    this.cooldown = 0;
    this.heat = 0;
    this.enabled = true;
  }

  /**
   * Permite que sistemas autónomos (como Point Defense Cannons o IA)
   * controlen temporalmente hacia dónde mira la torreta en este tick.
   */
  public setIndependentTarget(worldAngle: number): void {
    this.independentTargetAngle = worldAngle;
  }

  public canFire(): boolean {
    return this.enabled && this.cooldown <= 0 && this.heat < SHIP_HEAT_LIMIT;
  }

  public fire(): void {
    const stats = WEAPON_STATS[this.weaponKind];
    if (!stats) return;

    // Aplica multiplicadores para que el juego sea escalable con power-ups
    this.cooldown = stats.cooldown * this.cooldownMultiplier;

    const generatedHeat = stats.heat * this.heatGenerationMultiplier;
    this.heat = Math.min(SHIP_HEAT_LIMIT + this.OVERHEAT_BUFFER, this.heat + generatedHeat);
  }

  public update(
    shipAngle: number,
    shipTargetAngle: number,
    shipTurnRate: number,
    heatCoolRate: number
  ): void {
    // 1. Determinar cuál es nuestra intención de mira (Prioriza IA/PDC si existe, sino el piloto)
    const desiredTarget = this.independentTargetAngle !== null ? this.independentTargetAngle : shipTargetAngle;

    // 2. Calcular límites relativos a la nave y aplicar Clamp
    const desiredRel = shortestAngleDelta(shipAngle, desiredTarget);
    const clampedRel = clamp(desiredRel, this.minAngle, this.maxAngle);

    // 3. Establecer el ángulo objetivo normalizado en el espacio del mundo
    this.targetAngle = normalizeAngle(shipAngle + clampedRel);

    // 4. Lógica de rotación física sin bugs
    if (this.angle !== this.targetAngle) {
      const delta = shortestAngleDelta(this.angle, this.targetAngle);

      // La torreta se adapta para seguir el ritmo si la nave gira muy rápido
      const currentTurnRate = this.baseTurnRate * this.turnRateMultiplier;
      const step = currentTurnRate + Math.abs(shipTurnRate * 0.5);

      if (Math.abs(delta) <= step) {
        this.angle = this.targetAngle; // Encaja perfectamente sin "temblar"
      } else {
        this.angle = normalizeAngle(this.angle + (Math.sign(delta) * step));
      }
    }

    // 5. Enfriamiento y recargas
    if (this.cooldown > 0) this.cooldown--;
    if (this.heat > 0) this.heat = Math.max(0, this.heat - heatCoolRate);

    // Limpia el objetivo independiente para el próximo tick
    // (Si el PDC deja de rastrear, la torreta vuelve al control frontal)
    this.independentTargetAngle = null;
  }
}

export function createTurret(config: TurretConfig): Turret {
  return new Turret(config);
}