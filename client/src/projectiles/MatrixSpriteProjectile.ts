import { ProjectileRenderer, type BulletData } from "./ProjectileRenderer";

// SO: Proyectiles con sprite definido en matrices de píxeles (bitmap)
// R: https://stackoverflow.com/questions/17131002/pixel-art-sprite-rendering-on-canvas
//    Definí el sprite como number[][] (0 = vacío, 1..n = colores de paleta).
//    Se renderiza con fillRect por píxel escalado. Ideal para balas simples
//    donde querés control artesanal píxel a píxel.

interface MatrixSprite {
  readonly grid: number[][];
  readonly palette: Record<number, string>;
  readonly glowColor: string;
  readonly glowRadius: number;
  readonly pixelScale: number;
}

// SO: Paletas compartidas para proyectiles bitmap
// R: https://stackoverflow.com/questions/7629830/color-palette-for-retro-pixel-art
const PALETTES = {
  green: { 1: "#66ffcc", 2: "#aaffee", 3: "#33eeaa" },
  orange: { 1: "#ffb35a", 2: "#ffd36a", 3: "#ff8c00" },
  purple: { 1: "#dd66ff", 2: "#cc00ff", 3: "#aa00ff" },
  cyan: { 1: "#00e5ff", 2: "#66ccff", 3: "#ccffff" },
  yellow: { 1: "#ffcc00", 2: "#ffe66d", 3: "#ffff66" },
} as const;

// Matrices de proyectiles (0 = transparente, 1..3 = índice de paleta)
const SPRITES: Record<string, MatrixSprite> = {
};

// Cache de canvases pre-renderizados
const cache = new Map<string, HTMLCanvasElement>();

function getCachedSprite(sprite: MatrixSprite): HTMLCanvasElement {
  const key = `${sprite.grid.length}x${sprite.grid[0]!.length}_${sprite.pixelScale}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const rows = sprite.grid.length;
  const cols = sprite.grid[0]!.length;
  const ps = sprite.pixelScale;
  const w = cols * ps;
  const h = rows * ps;
  const padding = sprite.glowRadius + 2;
  const canvas = document.createElement("canvas");
  canvas.width = w + padding * 2;
  canvas.height = h + padding * 2;
  const ctx = canvas.getContext("2d")!;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Glow
  const gradient = ctx.createRadialGradient(cx, cy, sprite.glowRadius * 0.2, cx, cy, sprite.glowRadius);
  gradient.addColorStop(0, sprite.glowColor + "33");
  gradient.addColorStop(1, sprite.glowColor + "00");
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - sprite.glowRadius, cy - sprite.glowRadius, sprite.glowRadius * 2, sprite.glowRadius * 2);

  // Píxeles
  const startX = cx - w / 2;
  const startY = cy - h / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = sprite.grid[r]![c];
      if (!v) continue;
      ctx.fillStyle = sprite.palette[v] ?? "#ffffff";
      ctx.fillRect(startX + c * ps, startY + r * ps, ps, ps);
    }
  }

  cache.set(key, canvas);
  return canvas;
}

export class MatrixSpriteProjectile extends ProjectileRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    bullet: BulletData,
    cameraX: number, cameraY: number,
    viewW: number, viewH: number,
    margin: number,
  ): void {
    if (!this.isOnScreen(bullet, cameraX, cameraY, viewW, viewH, margin)) return;

    const sprite = SPRITES[bullet.kind];
    if (!sprite) {
      // Fallback genérico: círculo del color del glow
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.fillStyle = "#66ffcc";
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    const canvas = getCachedSprite(sprite);
    const a = bullet.angle !== undefined ? bullet.angle : Math.atan2(bullet.vy, bullet.vx);

    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(a);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();
  }
}
