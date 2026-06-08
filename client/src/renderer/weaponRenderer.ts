import type { WeaponKind } from "@speakerdust/shared";
import { WEAPON_DEFS } from "@speakerdust/shared";
import { WEAPON_BITMAPS } from "../assets/weaponBitmaps";

export type WeaponDynamicDrawFn = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  tick: number,
  pulse: number
) => void;

const dynamicRenderers = new Map<string, WeaponDynamicDrawFn>();

export function registerWeaponRenderer(
  renderId: string,
  fn: WeaponDynamicDrawFn
): void {
  dynamicRenderers.set(renderId, fn);
}

// ─── Mejoras visuales ────────────────────────────────────

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number = 0.3
): void {
  ctx.save();
  ctx.translate(x, y);
  const gradient = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawExtraSpark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  tick: number,
  pulse: number
): void {
  const sparkChance = 0.5;
  if (Math.sin(tick * 1.5) > 0.7) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    const offX = (Math.sin(tick * 5) * 2);
    const offY = -6 + Math.cos(tick * 7) * 2;
    ctx.beginPath();
    ctx.moveTo(offX - 1, offY - 2);
    ctx.lineTo(offX + 1, offY + 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Funciones dinámicas mejoradas ──────────────────────

function drawPlasmaBolt(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, _tick: number, pulse: number): void {
  const len = 14 + pulse * 4;
  drawGlow(ctx, x, y, len * 0.6, "#d86bff", 0.35);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#d86bff";
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, len / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fdf0ff";
  ctx.beginPath();
  ctx.ellipse(0, -len * 0.1, 1.2, len * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0a0ff";
  ctx.beginPath();
  ctx.ellipse(0, -len * 0.15, 2, len * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  drawExtraSpark(ctx, x, y, angle, _tick, pulse);
  ctx.restore();
}

function drawRailgunShot(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, _tick: number, _pulse: number): void {
  drawGlow(ctx, x, y, 8, "#7df9ff", 0.4);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#7df9ff";
  ctx.fillRect(-1.5, -11, 4, 22);
  ctx.fillStyle = "#e0ffff";
  ctx.fillRect(0, -10, 1.5, 20);
  ctx.strokeStyle = "#b0ffff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-1, -9);
  ctx.lineTo(-2, -7);
  ctx.moveTo(2, 9);
  ctx.lineTo(3, 7);
  ctx.stroke();
  ctx.restore();
}

function drawTorpedo(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, _pulse: number): void {
  drawGlow(ctx, x, y, 7, "#ff9030", 0.25);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const wobble = Math.sin(tick * 0.15) * 1.5;
  ctx.fillStyle = "#ff9030";
  ctx.beginPath();
  ctx.ellipse(wobble, 0, 4, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffc070";
  ctx.beginPath();
  ctx.ellipse(wobble, -4, 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe0b0";
  ctx.beginPath();
  ctx.ellipse(wobble, 7, 1.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  drawExtraSpark(ctx, x, y, angle, tick, _pulse);
  ctx.restore();
}

function drawMissile(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, _pulse: number): void {
  drawGlow(ctx, x, y, 9, "#ff6a3d", 0.3);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const flame = Math.sin(tick * 0.3) * 2 + 3;
  ctx.fillStyle = "#ff6a3d";
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(-3, -6);
  ctx.lineTo(3, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.moveTo(0, -8 - flame);
  ctx.lineTo(-2, -6);
  ctx.lineTo(2, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff3b0";
  ctx.beginPath();
  ctx.moveTo(0, -6 - flame * 0.8);
  ctx.lineTo(-1.2, -6);
  ctx.lineTo(1.2, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEnergyBomb(ctx: CanvasRenderingContext2D, x: number, y: number, _angle: number, tick: number, pulse: number): void {
  const radius = 6 + pulse * 3;
  const glow = Math.sin(tick * 0.08) * 0.3 + 0.7;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = `rgba(255, 230, 109, ${glow * 0.25})`;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 230, 109, ${glow * 0.6})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffe66d";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff8c0";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEmpPulse(ctx: CanvasRenderingContext2D, x: number, y: number, _angle: number, tick: number, _pulse: number): void {
  const ringAlpha = Math.sin(tick * 0.1) * 0.3 + 0.7;
  ctx.save();
  ctx.translate(x, y);
  for (let i = 1; i <= 2; i++) {
    const radius = 6 + i * 4 + Math.sin(tick * 0.15 + i) * 2;
    ctx.strokeStyle = `rgba(102, 204, 255, ${ringAlpha * (1 - i * 0.3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#66ccff";
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e0f7ff";
  ctx.beginPath();
  ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function initWeaponRenderers(): void {
  registerWeaponRenderer("plasma_bolt", drawPlasmaBolt);
  registerWeaponRenderer("railgun_shot", drawRailgunShot);
  registerWeaponRenderer("torpedo", drawTorpedo);
  registerWeaponRenderer("missile", drawMissile);
  registerWeaponRenderer("energy_bomb", drawEnergyBomb);
  registerWeaponRenderer("emp_pulse", drawEmpPulse);
}

// ─── Renderizado de armas estáticas corregido ─────────────

function drawStaticWeaponGlow(
  ctx: CanvasRenderingContext2D,
  bitmap: number[][],
  x: number,
  y: number,
  angle: number
): void {
  const ps = 2;
  const rows = bitmap.length;
  const cols = bitmap[0]!.length;
  const w = cols * ps;
  const h = rows * ps;

  const cx = w / 2;
  const cy = h / 2;
  const maxDim = Math.max(w, h);
  const glowRadius = maxDim * 0.8;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);

  // 🔴 CORRECCIÓN: Aquí faltaba centrar el dibujo para que el resplandor no esté chueco
  ctx.translate(-cx, -cy);

  const gradient = ctx.createRadialGradient(cx, cy, glowRadius * 0.1, cx, cy, glowRadius);
  gradient.addColorStop(0, "rgba(180,220,255,0.3)");
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawStaticWeaponBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: number[][],
  x: number,
  y: number,
  angle: number
): void {
  drawStaticWeaponGlow(ctx, bitmap, x, y, angle);

  const ps = 2;
  const rows = bitmap.length;
  const cols = bitmap[0]!.length;
  const w = cols * ps;
  const h = rows * ps;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.translate(-w / 2, -h / 2);

  for (let r = 0; r < rows; r++) {
    const row = bitmap[r]!;
    for (let c = 0; c < cols; c++) {
      const v = row[c];
      if (!v) continue;
      ctx.fillStyle = WEAPON_PALETTE[v] ?? "#fff";
      ctx.fillRect(c * ps, r * ps, ps, ps);
    }
  }
  ctx.restore();
}

const WEAPON_PALETTE: Record<number, string> = {
  1: "#a0a0a0",
  2: "#606060",
  3: "#ff4444",
  4: "#ffaa00",
  5: "#88ccff",
};

export function drawWeaponOnMount(
  ctx: CanvasRenderingContext2D,
  weaponKind: WeaponKind,
  mountX: number,
  mountY: number,
  shipAngle: number,
  tick: number
): void {
  const def = WEAPON_DEFS[weaponKind];
  if (!def) return;

  const pulse = Math.sin(tick * 0.1) * 0.5 + 0.5;

  if (def.render.type === "dynamic") {
    const fn = dynamicRenderers.get(def.render.renderId);
    if (fn) {
      fn(ctx, mountX, mountY, shipAngle, tick, pulse);
      return;
    }
  }

  const bitmap = WEAPON_BITMAPS[def.render.type === "static" ? def.render.bitmapId : weaponKind];
  if (bitmap) {
    drawStaticWeaponBitmap(ctx, bitmap, mountX, mountY, shipAngle);
  }
}

export function createWeaponCache(): void {
  initWeaponRenderers();
}