import { shortestAngleDelta } from "../math";

export type WeaponArc = "forward" | "broadside" | "omni";

/**
 * Determina si el ángulo hacia un objetivo (targetAngle, en radianes mundo)
 * cae dentro del arco de disparo del arma respecto a la orientación de la nave (shipAngle).
 */
export function isAngleInArc(shipAngle: number, targetAngle: number, arc: WeaponArc): boolean {
  // Omni: siempre dentro
  if (arc === "omni") return true;
  // Diferencia angular absoluta entre el frente de la nave y el objetivo
  const relAngle = Math.abs(shortestAngleDelta(shipAngle, targetAngle));
  if (arc === "forward") {
    // Cono frontal de 60° (PI/3)
    return relAngle < Math.PI / 3;
  }
  if (arc === "broadside") {
    // Arco lateral: entre 30° y 150° respecto al frente (PI/6 a 5PI/6)
    // Esto equivale a 120° de apertura a cada banda, perfectamente simétrico.
    return relAngle >= Math.PI / 6 && relAngle <= 5 * Math.PI / 6;
  }
  // Por seguridad: cualquier valor de arco desconocido se trata como fuera de rango.
  return false;
}