import type { Vec2 } from "../physics/shipPhysics";
import type { Sprite } from "./spriteTypes";

/**
 * 🎯 HITBOX PERFECTA: NAVE VS BALA (Precisión Píxel, Cero Lag)
 * Funciona para proyectiles puntuales (balas pequeñas, láseres).
 */
export function checkProjectileHit(
  sprite: Sprite,
  shipPos: Vec2,
  shipAngle: number,
  bulletPos: Vec2
): boolean {
  const dx = bulletPos.x - shipPos.x;
  const dy = bulletPos.y - shipPos.y;
  const cos = Math.cos(shipAngle);
  const sin = Math.sin(shipAngle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;

  // IMPORTANTE: Math.floor evita el bug de truncado de negativos que generaba píxeles fantasmas
  const gridX = Math.floor(localX + sprite.w * 0.5);
  const gridY = Math.floor(localY + sprite.h * 0.5);

  if (gridX >= 0 && gridX < sprite.w && gridY >= 0 && gridY < sprite.h) {
    return sprite.pixels[gridY * sprite.w + gridX] !== 0;
  }
  return false;
}

/**
 * ☄️ HITBOX PERFECTA PARA PROYECTILES GORDOS (Misiles, Plasma, Bombas)
 * Calcula un recuadro de colisión exacto sobre el grid de la nave y evalúa la circunferencia del proyectil.
 * Lo que ves es exactamente lo que choca.
 */
export function checkThickProjectileHit(
  sprite: Sprite,
  shipPos: Vec2,
  shipAngle: number,
  bulletPos: Vec2,
  bulletRadius: number
): boolean {
  const dx = bulletPos.x - shipPos.x;
  const dy = bulletPos.y - shipPos.y;
  const cos = Math.cos(shipAngle);
  const sin = Math.sin(shipAngle);

  // Centro de la bala en espacio local de la nave
  const cx = dx * cos + dy * sin;
  const cy = -dx * sin + dy * cos;

  const gridCx = cx + sprite.w * 0.5;
  const gridCy = cy + sprite.h * 0.5;

  // Calculamos el cuadrado delimitador (AABB) de la bala en la matriz para no recorrer toda la nave
  const minX = Math.max(0, Math.floor(gridCx - bulletRadius));
  const maxX = Math.min(sprite.w - 1, Math.ceil(gridCx + bulletRadius));
  const minY = Math.max(0, Math.floor(gridCy - bulletRadius));
  const maxY = Math.min(sprite.h - 1, Math.ceil(gridCy + bulletRadius));

  const radiusSq = bulletRadius * bulletRadius;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (sprite.pixels[y * sprite.w + x] !== 0) {
        // Obtenemos la distancia matemática desde el centro exacto del pixel al centro de la bala
        const px = x + 0.5;
        const py = y + 0.5;
        const distX = px - gridCx;
        const distY = py - gridCy;

        if (distX * distX + distY * distY <= radiusSq) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 💥 HITBOX PERFECTA: NAVE VS NAVE (Precisión Píxel Total)
 * Reemplaza por completo a la función satOverlap y la lógica de polígonos.
 * Recorre y escanea ambos sprites pixel por pixel usando una transformación lineal súper rápida.
 */
export function checkSpriteOverlap(
  spriteA: Sprite, posA: Vec2, angleA: number,
  spriteB: Sprite, posB: Vec2, angleB: number
): { overlap: number; normal: Vec2 } | null {
  // Early exit (broad-phase) mediante círculo circunscrito para salvar rendimiento
  const rA = Math.hypot(spriteA.w, spriteA.h) * 0.5;
  const rB = Math.hypot(spriteB.w, spriteB.h) * 0.5;
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  if (dx * dx + dy * dy > (rA + rB) * (rA + rB)) return null;

  const cosB = Math.cos(angleB);
  const sinB = Math.sin(angleB);

  // Transformamos el centro posicional de A al espacio local de B
  const diffX = posA.x - posB.x;
  const diffY = posA.y - posB.y;
  const offsetBx = diffX * cosB + diffY * sinB;
  const offsetBy = -diffX * sinB + diffY * cosB;

  // Matriz de rotación relativa entre la nave A y B
  const deltaAngle = angleA - angleB;
  const cosD = Math.cos(deltaAngle);
  const sinD = Math.sin(deltaAngle);

  const halfWa = spriteA.w * 0.5;
  const halfHa = spriteA.h * 0.5;
  const halfWb = spriteB.w * 0.5;
  const halfHb = spriteB.h * 0.5;

  // Calculamos en qué punto del Grid B comienza el píxel superior-izquierdo del Grid A
  const startX = offsetBx + (-halfWa) * cosD - (-halfHa) * sinD;
  const startY = offsetBy + (-halfWa) * sinD + (-halfHa) * cosD;

  let overlapCount = 0;

  for (let y = 0; y < spriteA.h; y++) {
    // Calculamos el inicio de la fila actual sumando linealmente (cero multiplicaciones pesadas)
    let px = startX - y * sinD;
    let py = startY + y * cosD;

    for (let x = 0; x < spriteA.w; x++) {
      if (spriteA.pixels[y * spriteA.w + x] !== 0) {
        const gridX = Math.floor(px + halfWb);
        const gridY = Math.floor(py + halfHb);

        if (gridX >= 0 && gridX < spriteB.w && gridY >= 0 && gridY < spriteB.h) {
          // Si el píxel en B tampoco es transparente, ¡Hay Choque Visual!
          if (spriteB.pixels[gridY * spriteB.w + gridX] !== 0) {
            overlapCount++;
          }
        }
      }
      // Avanzar al siguiente píxel en 'X' de forma matemática y lineal
      px += cosD;
      py += sinD;
    }
  }

  // Si no hay píxeles chocando, no hay colisión
  if (overlapCount === 0) return null;

  // Para que el motor de físicas empuje las naves, usamos el vector desde B hacia A
  let nx = posA.x - posB.x;
  let ny = posA.y - posB.y;
  let len = Math.hypot(nx, ny);
  if (len === 0) {
    nx = 1; ny = 0; len = 1; // Fallback por si ambos centros son idénticos
  }

  // Retornamos el área de colisión convertida a "profundidad" de impacto (overlap).
  // La raíz cuadrada suaviza la penetración masiva dándonos un tacto de impulso físico realista.
  return {
    overlap: Math.max(1, Math.sqrt(overlapCount)),
    normal: { x: nx / len, y: ny / len }
  };
}

/** 
 * (Opcional) Mantenemos transformHull vivo por si lo estás usando
 * en otra parte para renderizar escudos visuales o debuggear UI. 
 */
export function transformHull(
  hull: readonly Vec2[],
  x: number, y: number, angle: number,
): Vec2[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out = new Array<Vec2>(hull.length);
  for (let i = 0; i < hull.length; i++) {
    const v = hull[i]!;
    out[i] = {
      x: v.x * cos - v.y * sin + x,
      y: v.x * sin + v.y * cos + y,
    };
  }
  return out;
}