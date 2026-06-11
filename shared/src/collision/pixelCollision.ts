import { checkProjectileHit, checkThickProjectileHit } from "../sprite/spriteCollision";
import type { Sprite } from "../sprite/spriteTypes";

export interface CollisionGrid {
  readonly pixels: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly boundingRadius: number;
}

function gridToSprite(grid: CollisionGrid): Sprite {
  return { pixels: grid.pixels, w: grid.w, h: grid.h, attachments: [] };
}

/**
 * Colisión Nave vs Bala.
 * Broad phase: distancia bounding sphere.
 * Narrow phase: pixel-perfect O(1) para balas pequeñas,
 * sampleo cardinal en cruz para balas grandes.
 */
export function checkBulletHit(
  grid: CollisionGrid,
  shipX: number, shipY: number, shipAngle: number,
  bulletX: number, bulletY: number, bulletR: number,
): boolean {
  const dx = bulletX - shipX;
  const dy = bulletY - shipY;
  const maxDist = grid.boundingRadius + bulletR;
  if (dx * dx + dy * dy >= maxDist * maxDist) return false;

  const sprite = gridToSprite(grid);
  const shipPos = { x: shipX, y: shipY };
  const bulletPos = { x: bulletX, y: bulletY };

  if (bulletR <= 1) {
    return checkProjectileHit(sprite, shipPos, shipAngle, bulletPos);
  }
  return checkThickProjectileHit(sprite, shipPos, shipAngle, bulletPos, bulletR);
}

export function checkBeamHit(
  grid: CollisionGrid,
  shipX: number, shipY: number, shipAngle: number,
  originX: number, originY: number,
  beamAngle: number, length: number, beamR: number,
): { hit: boolean; cx: number; cy: number } | null {
  const cosB = Math.cos(beamAngle);
  const sinB = Math.sin(beamAngle);
  const endX = originX + cosB * length;
  const endY = originY + sinB * length;

  const cosS = Math.cos(-shipAngle);
  const sinS = Math.sin(-shipAngle);

  let dx = originX - shipX;
  let dy = originY - shipY;
  const lox = dx * cosS - dy * sinS;
  const loy = dx * sinS + dy * cosS;

  dx = endX - shipX;
  dy = endY - shipY;
  const lex = dx * cosS - dy * sinS;
  const ley = dx * sinS + dy * cosS;

  const totalDist = Math.hypot(lex - lox, ley - loy);
  const samples = Math.ceil(totalDist / 0.5);
  const half = Math.ceil(beamR);

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const lx = lox + (lex - lox) * t;
    const ly = loy + (ley - loy) * t;

    const gcx = lx + grid.centerX;
    const gcy = ly + grid.centerY;
    const minX = Math.max(0, Math.floor(gcx - half));
    const maxX = Math.min(grid.w - 1, Math.ceil(gcx + half));
    const minY = Math.max(0, Math.floor(gcy - half));
    const maxY = Math.min(grid.h - 1, Math.ceil(gcy + half));

    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (grid.pixels[gy * grid.w + gx] !== 0) {
          const cosF = Math.cos(shipAngle);
          const sinF = Math.sin(shipAngle);
          return {
            hit: true,
            cx: lx * cosF - ly * sinF + shipX,
            cy: lx * sinF + ly * cosF + shipY,
          };
        }
      }
    }
  }
  return null;
}
