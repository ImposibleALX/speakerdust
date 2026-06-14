import { ProjectileRenderer, type BulletData } from "./ProjectileRenderer";

// SO: Proyectiles renderizados con código Canvas2D paramétrico
// R: https://stackoverflow.com/questions/14842008/drawing-projectiles-in-html5-canvas
//    Cada arma define su propia función de dibujo. Usá shadowBlur para glow,
//    globalAlpha para estelas. Mantené los parámetros consistentes entre armas.

type DrawFn = (ctx: CanvasRenderingContext2D, a: number) => void;

const DRAW_FNS: Record<string, DrawFn> = {
  naval_cannon(ctx, a) {
    ctx.rotate(a);
    // Elegante: Cuerpo sólido, núcleo frontal brillante, estela limpia
    ctx.fillStyle = "#ff9900"; ctx.fillRect(-4, -2, 8, 4); // Masa cinética
    ctx.fillStyle = "#ffffff"; ctx.fillRect(2, -1, 2, 2);  // Calor por fricción en la punta
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#cc3300"; ctx.fillRect(-8, -1, 4, 2); // Estela de humo/fuego lineal
  },

  autocannon(ctx, a) {
    ctx.rotate(a);
    // Trazadora rápida y minimalista
    ctx.fillStyle = "#ccffaa"; ctx.fillRect(-3, -1, 6, 2); // Bala
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#55aa33"; ctx.fillRect(-7, -1, 4, 2); // Trazo fantasma
  },

  plasma_broadside(ctx, a) {
    ctx.rotate(a);
    // Sorprendente: Una cruz pixelada que sugiere energía contenida magnéticamente
    ctx.shadowBlur = 4; ctx.shadowColor = "#cc00ff"; // Resplandor muy sutil
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-2, -2, 4, 4); // Núcleo supercaliente
    ctx.fillStyle = "#dd66ff";
    ctx.fillRect(-4, -1, 2, 2); ctx.fillRect(2, -1, 2, 2); // Pétalos horizontales
    ctx.fillRect(-1, -4, 2, 2); ctx.fillRect(-1, 2, 2, 2); // Pétalos verticales
  },

  railgun(ctx, a) {
    ctx.rotate(a);
    // Aguja hiperveloz de alta energía. Larga, fina, mortal.
    ctx.fillStyle = "#00ffff"; ctx.fillRect(-10, -1, 20, 2); // Haz externo
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-4, -1, 10, 2);  // Haz interno concentrado
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#0055ff"; ctx.fillRect(-18, -1, 8, 2);  // Disipación trasera
  },

  torpedo(ctx, a) {
    ctx.rotate(a);
    // Estructura mecánica legible de 4 partes, sin ruido visual
    ctx.fillStyle = "#444444"; ctx.fillRect(-8, -3, 12, 6); // Fuselaje oscuro blindado
    ctx.fillStyle = "#ff4400"; ctx.fillRect(4, -3, 4, 6);   // Ojiva (Payload)
    ctx.fillStyle = "#222222"; ctx.fillRect(-10, -2, 2, 4); // Tobera del motor
    ctx.fillStyle = "#00ccff"; ctx.fillRect(-13, -1, 3, 2); // Propulsor iónico limpio
  },

  guided_missile(ctx, a) {
    ctx.rotate(a);
    // Ágil, delgado, aerodinámico
    ctx.fillStyle = "#bbbbbb"; ctx.fillRect(-6, -1, 8, 2); // Cuerpo principal
    ctx.fillStyle = "#ff2222"; ctx.fillRect(2, -1, 3, 2);  // Punta buscadora láser
    ctx.fillStyle = "#777777"; ctx.fillRect(-4, -2, 4, 4); // Aletas estabilizadoras
    ctx.fillStyle = "#ffaa00"; ctx.fillRect(-8, 0, 2, 1);  // Micro-propulsor asimétrico
  },

  energy_bomb(ctx, a) {
    ctx.rotate(a);
    // Masa densa. En lugar de un cuadrado borroso, un patrón concéntrico.
    ctx.shadowBlur = 6; ctx.shadowColor = "#ffcc00";
    ctx.fillStyle = "#ff8800"; ctx.fillRect(-5, -5, 10, 10); // Anillo exterior
    ctx.fillStyle = "#ffcc00"; ctx.fillRect(-3, -3, 6, 6);   // Anillo medio
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-1, -1, 2, 2);   // Punto crítico colapsante
  },

  emp_launcher(ctx, a) {
    ctx.rotate(a);
    // Sorprendente: Un pulso electromagnético hueco (como un corchete de UI)
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-1, -1, 2, 2); // Generador central
    ctx.fillStyle = "#33aaff";
    ctx.fillRect(-4, -4, 8, 2); // Borde superior
    ctx.fillRect(-4, 2, 8, 2);  // Borde inferior
    ctx.fillRect(-4, -2, 2, 4); // Conector trasero
    // El frontal está abierto, como una onda 'C' empujando hacia adelante
  },

  point_defense(ctx, a) {
    ctx.rotate(a);
    // Minimalista, eficiente y quirúrgico
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, -1, 2, 2); // Impacto instantáneo
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#00ffcc"; ctx.fillRect(-3, -1, 3, 2); // Breve destello
  },
};

export class CodeSpriteProjectile extends ProjectileRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    bullet: BulletData,
    cameraX: number, cameraY: number,
    viewW: number, viewH: number,
    margin: number,
  ): void {
    if (!this.isOnScreen(bullet, cameraX, cameraY, viewW, viewH, margin)) return;

    const fn = DRAW_FNS[bullet.kind];
    if (!fn) {
      // Fallback: rect blanco genérico
      ctx.save();
      ctx.translate(bullet.x, bullet.y);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
      return;
    }

    const a = bullet.angle !== undefined ? bullet.angle : Math.atan2(bullet.vy, bullet.vx);
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    fn(ctx, a);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
