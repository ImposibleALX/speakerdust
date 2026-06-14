import { WEAPON_DEFS } from "@speakerdust/shared";
import { MountRenderer, mountWorldPos, type MountContext } from "./MountRenderer";

type DynamicDrawFn = (
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  angle: number,
  tick: number,
  pulse: number,
) => void;

const renderers = new Map<string, DynamicDrawFn>();

// Función auxiliar para geometría dura y elegante con un toque neón
function applyNeon(ctx: CanvasRenderingContext2D, color: string, intensity: number = 10) {
  ctx.shadowBlur = intensity;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
}

// 1. Plasma Broadside: Chasis rectangular oscuro con cañones de riel paralelos brillantes
function drawPlasmaMount(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Chasis base (Físico, gris oscuro mate)
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#1c2024";
  ctx.fillRect(-5, -6, 10, 12);

  // Raíles gemelos de plasma (Amatista)
  applyNeon(ctx, "#b388ff", 8 + pulse * 4);
  ctx.fillRect(-2, -5, 8, 2); // Riel izquierdo
  ctx.fillRect(-2, 3, 8, 2);  // Riel derecho

  ctx.restore();
}

// 2. Torpedos: Tubos dobles cilíndricos limpios
function drawTorpedoMount(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Base estructural
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#14171a";
  ctx.fillRect(-6, -7, 12, 14);

  // Núcleos de torpedos cargados (Zafiro)
  applyNeon(ctx, "#448aff", 10);
  ctx.beginPath();
  ctx.arc(0, -4, 2, 0, Math.PI * 2); // Tubo superior
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 4, 2, 0, Math.PI * 2);  // Tubo inferior
  ctx.fill();

  ctx.restore();
}

// 3. Misiles Guiados: Silo compacto cuadriculado (4 pequeños silos)
function drawMissileMount(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Carcasa del silo
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#22262a";
  ctx.beginPath();
  ctx.roundRect(-4, -4, 8, 8, 2);
  ctx.fill();

  // 4 Misiles listos para salir (Magenta)
  applyNeon(ctx, "#d500f9", 6);
  const offset = 1.5;
  const radius = 0.8 + (pulse * 0.2); // Pulso muy sutil

  const drawSilo = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.arc(dx, dy, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  drawSilo(-offset, -offset);
  drawSilo(offset, -offset);
  drawSilo(-offset, offset);
  drawSilo(offset, offset);

  ctx.restore();
}

// 4. Energy Bomb: Montura central pesada circular
function drawEnergyBombMount(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Anillo contenedor pesado
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#111";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Núcleo inestable (Púrpura eléctrico)
  applyNeon(ctx, "#ea80fc", 12 + pulse * 6);
  ctx.beginPath();
  ctx.arc(0, 0, 2.5 + pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 5. EMP Launcher: Antena/Emisor en forma de diamante (romboidal)
function drawEmpMount(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, tick: number, pulse: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Base de la antena
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#1c2024";
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, 6);
  ctx.lineTo(-6, 0);
  ctx.closePath();
  ctx.fill();

  // Circuitos del pulso (Hielo / Cyan claro)
  applyNeon(ctx, "#84ffff", 8 + pulse * 5);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(3, 0);
  ctx.lineTo(0, 3);
  ctx.lineTo(-3, 0);
  ctx.closePath();
  ctx.stroke(); // Dibujamos solo el borde para un efecto más limpio y tecnológico

  ctx.restore();
}

function initDynamicRenderers(): void {
  renderers.set("plasma_bolt", drawPlasmaMount);
  renderers.set("torpedo", drawTorpedoMount);
  renderers.set("missile", drawMissileMount);
  renderers.set("energy_bomb", drawEnergyBombMount);
  renderers.set("emp_pulse", drawEmpMount);
}

let initialized = false;

export class DynamicWeaponMountRenderer extends MountRenderer {
  render(ctx: CanvasRenderingContext2D, c: MountContext): void {
    if (!initialized) { initDynamicRenderers(); initialized = true; }

    const weaponKind = this.loadout?.[this.mount.id];
    if (!weaponKind) return;
    const def = WEAPON_DEFS[weaponKind];
    if (!def || def.render.type !== "dynamic") return;

    const fn = renderers.get(def.render.renderId);
    if (!fn) return;

    const pos = mountWorldPos(c, this.mount);
    const angle = this.getEffectiveAngle(c);

    // Un pulso limpio matemático de 0 a 1
    const pulse = Math.sin(c.tick * 0.1) * 0.5 + 0.5;

    // Para asegurar que los brillos no se multipliquen mal entre naves
    ctx.globalCompositeOperation = "source-over";

    fn(ctx, pos.x, pos.y, angle, c.tick, pulse);
  }

  debugDraw(ctx: CanvasRenderingContext2D, c: MountContext): void {
    const pos = mountWorldPos(c, this.mount);
    ctx.save();

    // Debug más sutil, sin colores chillones
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.stroke();

    const angle = this.getEffectiveAngle(c);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + Math.cos(angle) * 8, pos.y + Math.sin(angle) * 8);
    ctx.stroke();

    ctx.restore();
  }
}