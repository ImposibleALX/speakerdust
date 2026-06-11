import { satOverlap } from "../sprite/spriteCollision";
import type { Vec2 } from "../physics/shipPhysics";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function rectVerts(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

// TU GREEDY MESHING (Intacto, está perfecto para sacar los rectángulos)
export function decomposePixels(pixels: Uint8Array, w: number, h: number, cx: number, cy: number): Rect[] {
  const visited = new Uint8Array(w * h);
  const rects: Rect[] = [];

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const idx = sy * w + sx;
      if (pixels[idx] === 0 || visited[idx] !== 0) continue;

      let maxW = 0;
      for (let x = sx; x < w; x++) {
        if (pixels[sy * w + x] === 0 || visited[sy * w + x] !== 0) break;
        maxW++;
      }

      let maxH = 1;
      for (let y = sy + 1; y < h; y++) {
        let rowOk = true;
        for (let x = sx; x < sx + maxW; x++) {
          if (pixels[y * w + x] === 0 || visited[y * w + x] !== 0) {
            rowOk = false;
            break;
          }
        }
        if (!rowOk) break;
        maxH++;
      }

      for (let y = sy; y < sy + maxH; y++) {
        for (let x = sx; x < sx + maxW; x++) {
          visited[y * w + x] = 1;
        }
      }

      rects.push({ x: sx - cx, y: sy - cy, w: maxW, h: maxH });
    }
  }

  return rects;
}

// ----------------------------------------------------------------------
// COMPROBACIÓN NAVE VS NAVE (Hitbox Perfecta y Cero Lag)
// ----------------------------------------------------------------------
export function checkShipCollision(
  rectsA: readonly Rect[], posA: Vec2, angleA: number,
  rectsB: readonly Rect[], posB: Vec2, angleB: number,
): { overlap: number; normal: Vec2 } | null {

  // Transformación relativa de B al espacio local de A
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const relAngle = angleB - angleA;

  const cosNegA = Math.cos(-angleA);
  const sinNegA = Math.sin(-angleA);
  const relX = dx * cosNegA - dy * sinNegA;
  const relY = dx * sinNegA + dy * cosNegA;

  const cosR = Math.cos(relAngle);
  const sinR = Math.sin(relAngle);

  // OPTIMIZACIÓN 1: Pre-calcular los polígonos de B UNA SOLA VEZ.
  // Además, extraemos el radio y centro de B para hacer un "Fast-Reject" circular.
  const polysB = rectsB.map(rb => {
    // Centro del rectángulo en espacio local original
    const cx = rb.x + rb.w / 2;
    const cy = rb.y + rb.h / 2;
    // Radio máximo del rectángulo (mitad de la hipotenusa)
    const radius = Math.hypot(rb.w, rb.h) / 2;

    // Centro transformado al espacio de A
    const tcx = cx * cosR - cy * sinR + relX;
    const tcy = cx * sinR + cy * cosR + relY;

    // Vértices rotados
    const corners = rectVerts(rb);
    const verts = corners.map(c => ({
      x: c.x * cosR - c.y * sinR + relX,
      y: c.x * sinR + c.y * cosR + relY,
    }));

    return { verts, tcx, tcy, radius };
  });

  // CORRECCIÓN FÍSICA: Se debe tomar la MÁXIMA penetración, no la mínima.
  let maxOverlap = -Infinity;
  let bestNormal: Vec2 | null = null;

  for (const ra of rectsA) {
    // Datos de A para el Fast-Reject
    const acx = ra.x + ra.w / 2;
    const acy = ra.y + ra.h / 2;
    const aRadius = Math.hypot(ra.w, ra.h) / 2;

    const va = rectVerts(ra);

    for (const pb of polysB) {
      // OPTIMIZACIÓN 2: "Fast-Reject". Comprobación de colisión circular súper barata O(1).
      // Si los círculos locales de los sub-rectángulos no se tocan, ignoramos el costoso SAT.
      const distSq = (pb.tcx - acx) ** 2 + (pb.tcy - acy) ** 2;
      const radiusSum = aRadius + pb.radius;

      if (distSq > radiusSum * radiusSum) {
        continue; // Están demasiado lejos, salta al siguiente
      }

      // Si están cerca, aplicamos la caja de colisión precisa (SAT)
      const mtv = satOverlap(va, pb.verts);
      if (!mtv) continue;

      // CORRECCIÓN FÍSICA: Usar `>` para empujar basándonos en el peor impacto
      if (mtv.overlap > maxOverlap) {
        maxOverlap = mtv.overlap;
        bestNormal = mtv.normal;
      }
    }
  }

  // Si encontramos colisión, rotamos la Normal local de vuelta al Mundo global
  if (bestNormal) {
    const cosA = Math.cos(angleA);
    const sinA = Math.sin(angleA);
    const wx = bestNormal.x * cosA - bestNormal.y * sinA;
    const wy = bestNormal.x * sinA + bestNormal.y * cosA;

    return { overlap: maxOverlap, normal: { x: wx, y: wy } };
  }

  return null;
}