import type { Vec2 } from "../physics/shipPhysics";
import type { Sprite } from "./spriteTypes";

export const SHIP_PIXEL_SCALE = 3;

/**
 * 🔫 COLISIÓN 1: PUNTO VS MATRIZ (Precisión Absoluta, Zero Lag)
 * Se usa para balas estándar. Ignora los ceros de la matriz automáticamente.
 */
export function checkPointHit(
  sprite: Sprite,
  spritePos: Vec2,
  spriteAngle: number,
  pointPos: Vec2,
  pixelScale: number = SHIP_PIXEL_SCALE
): boolean {
  const dx = pointPos.x - spritePos.x;
  const dy = pointPos.y - spritePos.y;

  // --- FASE 1: OPTIMIZACIÓN O(1) EARLY EXIT ---
  // Evita calcular senos y cosenos si la bala está fuera del alcance máximo del sprite
  const distSq = dx * dx + dy * dy;
  const maxRadiusSq = ((sprite.w * sprite.w + sprite.h * sprite.h) * 0.25) * (pixelScale * pixelScale);
  if (distSq > maxRadiusSq) return false;

  // --- FASE 2: CÁLCULO PIXEL-PERFECT ---
  const cos = Math.cos(spriteAngle);
  const sin = Math.sin(spriteAngle);

  // Rotar el punto al espacio local de la matriz (Rotación inversa)
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;

  // Alinear perfectamente al centro del Grid
  const gridX = Math.floor(localX / pixelScale + sprite.w * 0.5);
  const gridY = Math.floor(localY / pixelScale + sprite.h * 0.5);

  // Si el punto cae dentro de las dimensiones de la matriz...
  if (gridX >= 0 && gridX < sprite.w && gridY >= 0 && gridY < sprite.h) {
    // La Hitbox es la matriz: Retorna TRUE solo si el píxel NO es un hueco (0).
    // Todo lo que sea 0 es invisible/traspasable.
    return sprite.pixels[gridY * sprite.w + gridX] !== 0;
  }

  return false;
}

/**
 * 🚀 COLISIÓN 2: MATRIZ VS MATRIZ (El "Santo Grial" Pixel-Perfect Mejorado)
 * Evalúa colisión de volumen. Los huecos (ceros) son totalmente ignorados.
 * Calcula la normal matemática desde la zona real de impacto.
 */
export function checkMatrixOverlap(
  spriteA: Sprite, posA: Vec2, angleA: number,
  spriteB: Sprite, posB: Vec2, angleB: number,
  pixelScale: number = SHIP_PIXEL_SCALE
): { overlap: number; normal: Vec2 } | null {

  // --- FASE 1: OPTIMIZACIÓN BOUNDING CIRCLE ---
  // Descarta el cruce de loops si las dos naves ni siquiera están cerca
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const distSq = dx * dx + dy * dy;

  const radA = (spriteA.w * spriteA.w + spriteA.h * spriteA.h) * 0.25;
  const radB = (spriteB.w * spriteB.w + spriteB.h * spriteB.h) * 0.25;
  const maxHitDistSq = (Math.sqrt(radA) + Math.sqrt(radB)) * pixelScale;

  if (distSq > maxHitDistSq * maxHitDistSq) {
    return null; // Demasiado lejos, cancelamos validación de hitboxes
  }

  // --- FASE 2: PREPARACIÓN DE ROTACIÓN ---
  const cosB = Math.cos(angleB);
  const sinB = Math.sin(angleB);

  // Trasladar el centro de la matriz A al espacio local de B
  const diffX = dx / pixelScale;
  const diffY = dy / pixelScale;
  const offsetBx = diffX * cosB + diffY * sinB;
  const offsetBy = -diffX * sinB + diffY * cosB;

  // Rotación relativa entre ambas matrices
  const deltaAngle = angleA - angleB;
  const cosD = Math.cos(deltaAngle);
  const sinD = Math.sin(deltaAngle);

  const halfWa = spriteA.w * 0.5;
  const halfHa = spriteA.h * 0.5;
  const halfWb = spriteB.w * 0.5;
  const halfHb = spriteB.h * 0.5;

  // Encontrar en qué coordenada del Grid B arranca el píxel [0,0] del Grid A
  const startX = offsetBx + (0.5 - halfWa) * cosD - (0.5 - halfHa) * sinD;
  const startY = offsetBy + (0.5 - halfWa) * sinD + (0.5 - halfHa) * cosD;

  let overlapCount = 0;

  // Acumuladores para calcular una NORMAL PERFECTA basada en la geometría
  let sumBx = 0;
  let sumBy = 0;

  // --- FASE 3: ESCANEO DE MATRICES PIXEL-PERFECT ---
  for (let y = 0; y < spriteA.h; y++) {
    // Avance de fila sin multiplicaciones pesadas por píxel
    let px = startX - y * sinD;
    let py = startY + y * cosD;

    for (let x = 0; x < spriteA.w; x++) {
      // Condición 1: ¿El píxel en la Matriz A existe (no es un hueco = 0)?
      if (spriteA.pixels[y * spriteA.w + x] !== 0) {

        const gridX = Math.floor(px + halfWb);
        const gridY = Math.floor(py + halfHb);

        // Si ese píxel proyectado cae dentro de los límites de la Matriz B...
        if (gridX >= 0 && gridX < spriteB.w && gridY >= 0 && gridY < spriteB.h) {
          // Condición 2: ¿El píxel en la Matriz B existe (no es un hueco = 0)?
          if (spriteB.pixels[gridY * spriteB.w + gridX] !== 0) {
            overlapCount++; // ¡HAY IMPACTO SÓLIDO!
            sumBx += gridX; // Guardamos las coordenadas para el punto de choque
            sumBy += gridY;
          }
        }
      }
      // Avanzar matemáticamente a la siguiente celda adyacente en X
      px += cosD;
      py += sinD;
    }
  }

  // Si pasaron y se entrelazaron pero todo cayó por los "huecos", no hay colisión
  if (overlapCount === 0) return null;

  // --- FASE 4: CÁLCULO DE NORMAL BASADO EN LA GEOMETRÍA REAL DE IMPACTO ---
  let nx = 0;
  let ny = 0;

  // Calcular el "centro de masa" de la colisión en las coordenadas locales de B
  const avgBx = sumBx / overlapCount;
  const avgBy = sumBy / overlapCount;

  // Vector desde el centro geométrico de B hacia el centro de masa del impacto
  // (+0.5 sirve para fijar el impacto en el centro de la celda afectada)
  const localNx = (avgBx + 0.5) - halfWb;
  const localNy = (avgBy + 0.5) - halfHb;

  // Rotar esta normal geométrica de vuelta al mundo real (espacio global)
  nx = localNx * cosB - localNy * sinB;
  ny = localNx * sinB + localNy * cosB;

  let len = Math.hypot(nx, ny);

  // Fallback: Si la colisión fue perfectamente simétrica o el vector resultó nulo,
  // recae a usar las distancias entre los centros de las naves (fallback genérico)
  if (len < 0.0001) {
    nx = posA.x - posB.x;
    ny = posA.y - posB.y;
    len = Math.hypot(nx, ny);
    if (len < 0.0001) { nx = 1; ny = 0; len = 1; }
  }

  return {
    overlap: Math.max(1, Math.sqrt(overlapCount)),
    normal: { x: nx / len, y: ny / len }
  };
}