import { WEAPON_DEFS } from "@speakerdust/shared";
import { WEAPON_BITMAPS } from "../assets/weaponBitmaps";
import { MountRenderer, mountWorldPos, type MountContext } from "./MountRenderer";

// SO: Cachear armas estáticas en canvas Offscreen para evitar redibujar píxeles cada frame
// R: https://stackoverflow.com/questions/34749614/caching-canvas-drawings-for-performance

// Paleta Sci-Fi de Alto Estatus (separada en materiales físicos y luces neón)
const WEAPON_PALETTE: Record<number, { color: string, isNeon?: boolean }> = {
  1: { color: "#14171a" }, // Base estructural (Grafito oscuro mate)
  2: { color: "#2b3238" }, // Armazón secundario (Gris acorazado)
  3: { color: "#546573" }, // Acentos metálicos (Plata opaco)
  4: { color: "#00e5ff", isNeon: true }, // Emisor de energía (Cyan brillante)
  5: { color: "#ffffff", isNeon: true }, // Núcleo supercaliente (Blanco puro)
};

const cache = new Map<string, HTMLCanvasElement>();

function ensureCached(bitmapId: string): HTMLCanvasElement | null {
  const existing = cache.get(bitmapId);
  if (existing) return existing;

  const bitmap = WEAPON_BITMAPS[bitmapId];
  if (!bitmap) return null;

  const ps = 2; // Tamaño de cada "píxel" (escala)
  const rows = bitmap.length;
  const cols = bitmap[0]!.length;
  const w = cols * ps;
  const h = rows * ps;

  // Padding solo el necesario para sombras y resplandores (sin crear canvas gigantes)
  const padding = 12;
  const canvas = document.createElement("canvas");
  canvas.width = w + padding * 2;
  canvas.height = h + padding * 2;
  const ctx = canvas.getContext("2d")!;

  const startX = padding;
  const startY = padding;

  // PASADA 1: Renderizar el hardware físico con sombra dura (volumen)
  ctx.shadowBlur = 4;
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowOffsetY = 3; // Da la impresión de estar montado sobre la nave

  for (let r = 0; r < rows; r++) {
    const row = bitmap[r]!;
    for (let c = 0; c < cols; c++) {
      const v = row[c];
      if (!v) continue;
      const material = WEAPON_PALETTE[v];

      // Solo dibujamos las partes que no son luz
      if (material && !material.isNeon) {
        ctx.fillStyle = material.color;
        // Se pinta ligeramente más pequeño que el 'ps' completo para un sutil efecto de paneles
        ctx.fillRect(startX + c * ps, startY + r * ps, ps, ps);
      }
    }
  }

  // PASADA 2: Renderizar emisores de energía (luces/neón)
  ctx.shadowOffsetY = 0; // El brillo no proyecta sombra direccional
  for (let r = 0; r < rows; r++) {
    const row = bitmap[r]!;
    for (let c = 0; c < cols; c++) {
      const v = row[c];
      if (!v) continue;
      const material = WEAPON_PALETTE[v];

      // Solo dibujamos las partes que brillan
      if (material && material.isNeon) {
        ctx.shadowBlur = 8; // Efecto Bloom / Neón
        ctx.shadowColor = material.color;
        ctx.fillStyle = material.color;
        ctx.fillRect(startX + c * ps, startY + r * ps, ps, ps);
      }
    }
  }

  cache.set(bitmapId, canvas);
  return canvas;
}

export class WeaponMountRenderer extends MountRenderer {
  render(ctx: CanvasRenderingContext2D, c: MountContext): void {
    const weaponKind = this.loadout?.[this.mount.id];
    if (!weaponKind) return;
    const def = WEAPON_DEFS[weaponKind];
    if (!def || !def.hasSprite) return;

    if (def.render.type === "dynamic") return; // manejado por DynamicWeaponMountRenderer
    if (def.render.type === "none") return;

    const bitmapId = def.render.type === "static" ? def.render.bitmapId : weaponKind;
    const canvas = ensureCached(bitmapId);
    if (!canvas) return;

    const pos = mountWorldPos(c, this.mount);
    const angle = this.getEffectiveAngle(c);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);
    // Compositing normal, ya que la luz la hemos pre-calculado en el caché de forma limpia
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();
  }

  debugDraw(ctx: CanvasRenderingContext2D, c: MountContext): void {
    const pos = mountWorldPos(c, this.mount);
    ctx.save();

    // Un debug más profesional, menos chillón
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.stroke();

    // Mostrar arco de fuego
    const angle = this.getEffectiveAngle(c);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + Math.cos(angle) * 8, pos.y + Math.sin(angle) * 8);
    ctx.stroke();

    ctx.restore();
  }
}