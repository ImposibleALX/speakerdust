import type { Sprite } from "../sprite/spriteTypes";
import type { Vec2 } from "../physics/shipPhysics";
// IMPORTANTE: Asegúrate de importar SHIP_PIXEL_SCALE desde tu archivo spriteCollision
import { checkPointHit, SHIP_PIXEL_SCALE } from "../sprite/spriteCollision";

export interface CollisionGrid {
  readonly pixels: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly boundingRadius: number;
}

/**
 * 🔫 COLISIÓN BALA VS NAVE (CCD - Continuous Collision Detection optimizada)
 */
export function checkBulletHit(
  grid: CollisionGrid,
  shipX: number, shipY: number, shipAngle: number,
  bulletX: number, bulletY: number, bulletR: number,
  prevX?: number, prevY?: number,
): boolean {
  const shipPos: Vec2 = { x: shipX, y: shipY };
  const shipSprite: Sprite = { pixels: grid.pixels, w: grid.w, h: grid.h, attachments: [] };

  // Radio máximo de la nave (Bounding Circle) al cuadrado para cálculos O(1)
  const shipRadSq = ((grid.w * grid.w + grid.h * grid.h) * 0.25) * (SHIP_PIXEL_SCALE * SHIP_PIXEL_SCALE);
  const shipRad = Math.sqrt(shipRadSq);
  const maxHitDist = shipRad + bulletR;

  // Si tenemos la posición anterior, evaluamos el segmento completo (Swept Line)
  if (prevX !== undefined && prevY !== undefined) {
    const dx = bulletX - prevX;
    const dy = bulletY - prevY;
    const l2 = dx * dx + dy * dy;

    // Proyección matemática para encontrar el punto de la trayectoria más cercano a la nave
    let t = 0;
    if (l2 > 0) {
      t = ((shipX - prevX) * dx + (shipY - prevY) * dy) / l2;
      t = Math.max(0, Math.min(1, t)); // Clampear a la línea origen-destino
    }

    const closestX = prevX + t * dx;
    const closestY = prevY + t * dy;
    const distToLineSq = (shipX - closestX) * (shipX - closestX) + (shipY - closestY) * (shipY - closestY);

    // EARLY EXIT: Si toda la trayectoria está fuera del rango de la nave, abortamos
    if (distToLineSq > maxHitDist * maxHitDist) return false;

    // Si pasó el filtro, iteramos a lo largo de la trayectoria
    const dist = Math.sqrt(l2);
    const stepSize = SHIP_PIXEL_SCALE; // No escanear sub-píxeles, escanear tamaño del Grid

    if (dist > stepSize) {
      const steps = Math.ceil(dist / stepSize);
      for (let i = 1; i <= steps; i++) {
        const fraction = i / steps;
        if (checkPointHit(shipSprite, shipPos, shipAngle, {
          x: prevX + dx * fraction,
          y: prevY + dy * fraction
        })) return true;
      }
      return false;
    }
  } else {
    // EARLY EXIT (Sin CCD): Solo chequear el punto final de la bala si está en rango
    const distToShipSq = (shipX - bulletX) * (shipX - bulletX) + (shipY - bulletY) * (shipY - bulletY);
    if (distToShipSq > maxHitDist * maxHitDist) return false;
  }

  // Comprobación final si no entró al CCD o fue un trayecto muy corto
  return checkPointHit(shipSprite, shipPos, shipAngle, { x: bulletX, y: bulletY });
}

/**
 * ⚡ COLISIÓN RAYO (LÁSER) VS NAVE (Corte Espacial Optimizado)
 * Evita recorrer toda la longitud de un rayo, sólo procesa donde intersecta con la nave.
 */
export function checkBeamHit(
  grid: CollisionGrid,
  shipX: number, shipY: number, shipAngle: number,
  originX: number, originY: number,
  beamAngle: number, length: number, beamR: number,
): { hit: boolean; cx: number; cy: number } | null {

  const cosB = Math.cos(beamAngle);
  const sinB = Math.sin(beamAngle);
  const dx = cosB * length;
  const dy = sinB * length;
  const endX = originX + dx;
  const endY = originY + dy;

  // --- OPTIMIZACIÓN 1: EARLY EXIT DE LÍNEA ---
  const l2 = length * length;
  let t = 0;
  if (l2 > 0) {
    // Proyectar centro de nave hacia la línea del láser para hallar el punto más cercano
    t = ((shipX - originX) * dx + (shipY - originY) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
  }

  const closestX = originX + t * dx;
  const closestY = originY + t * dy;
  const distToLineSq = (shipX - closestX) * (shipX - closestX) + (shipY - closestY) * (shipY - closestY);

  const shipRadSq = ((grid.w * grid.w + grid.h * grid.h) * 0.25) * (SHIP_PIXEL_SCALE * SHIP_PIXEL_SCALE);
  const shipRad = Math.sqrt(shipRadSq);
  const maxHitDist = shipRad + beamR;

  // Si el láser pasa lejos de la nave, abortamos con CERO costo
  if (distToLineSq > maxHitDist * maxHitDist) {
    return null;
  }

  // --- OPTIMIZACIÓN 2: RECORTAR ITERACIÓN ---
  // No recorremos todo el rayo, sólo la pequeña ventana paramétrica que pasa sobre la nave
  const tRadius = maxHitDist / length;
  const tStart = Math.max(0, t - tRadius);
  const tEnd = Math.min(1, t + tRadius);

  const segmentLen = (tEnd - tStart) * length;
  const stepSize = SHIP_PIXEL_SCALE; // Resolución lógica. No iterar 0.5 (es matar la CPU en vano)
  const samples = Math.ceil(segmentLen / stepSize);

  const perpX = -sinB;
  const perpY = cosB;

  const shipSprite: Sprite = { pixels: grid.pixels, w: grid.w, h: grid.h, attachments: [] };
  const shipPos: Vec2 = { x: shipX, y: shipY };

  // Iterar solamente la fracción peligrosa del láser
  for (let i = 0; i <= samples; i++) {
    const fraction = samples === 0 ? tStart : tStart + (tEnd - tStart) * (i / samples);
    const bx = originX + dx * fraction;
    const by = originY + dy * fraction;

    // 1. Chequear el eje central del rayo
    if (checkPointHit(shipSprite, shipPos, shipAngle, { x: bx, y: by })) {
      return { hit: true, cx: bx, cy: by };
    }

    // 2. Expandir el grosor radial (BeamR) usando el mismo "stepSize"
    if (beamR > 0) {
      for (let offset = stepSize; offset <= beamR + stepSize; offset += stepSize) {
        // Evitar sobrepasar el grosor máximo real
        const actualOffset = Math.min(offset, beamR);

        // Revisar izquierda del rayo
        const px1 = bx + perpX * actualOffset;
        const py1 = by + perpY * actualOffset;
        if (checkPointHit(shipSprite, shipPos, shipAngle, { x: px1, y: py1 })) {
          return { hit: true, cx: px1, cy: py1 };
        }

        // Revisar derecha del rayo
        const px2 = bx - perpX * actualOffset;
        const py2 = by - perpY * actualOffset;
        if (checkPointHit(shipSprite, shipPos, shipAngle, { x: px2, y: py2 })) {
          return { hit: true, cx: px2, cy: py2 };
        }

        if (actualOffset === beamR) break;
      }
    }
  }

  return null;
}