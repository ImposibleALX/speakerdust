import { MountRenderer, mountWorldPos, type MountContext } from "./MountRenderer";

// SO: Efecto de estela de motor (thruster) con partículas procidurales
// R: https://stackoverflow.com/questions/15288056/simple-particle-system-on-canvas
//    Usá un bucle que dibuja segmentos con alpha decreciente y jitter sinusoidal.
//    globalCompositeOperation="screen" para que se vea brillante sobre negro.

export class EngineMountRenderer extends MountRenderer {
  constructor(
    mount: import("@speakerdust/shared").Attachment,
    private color: string,
  ) {
    super(mount);
  }

  render(ctx: CanvasRenderingContext2D, c: MountContext): void {
    const pos = mountWorldPos(c, this.mount);
    const isRearMount = this.mount.x < 0;
    const dir = isRearMount ? 1 : -1;
    const len = this.mount.size === "large" ? 14 : this.mount.size === "medium" ? 10 : 7;
    const width = this.mount.size === "large" ? 5 : this.mount.size === "medium" ? 3 : 2;
    const now = performance.now();

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < len; i++) {
      const t = i / len;
      const trailDx = -Math.cos(c.shipAngle) * dir;
      const trailDy = -Math.sin(c.shipAngle) * dir;
      const pulse = Math.sin(now * 0.015 + i) * 2;
      const jitter = Math.sin(now * 0.02 + i * 2.7) * (i * 0.5);
      const px = pos.x + trailDx * (i * 4 + pulse) + jitter;
      const py = pos.y + trailDy * (i * 4 + pulse) + jitter;

      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.fillStyle = i < 2 ? "#ffffff" : this.color;
      const sz = Math.max(1, Math.floor((1 - t) * width * (c.ps / 2.5)));
      ctx.fillRect(px, py, sz, sz);
    }

    ctx.restore();
  }

  debugDraw(ctx: CanvasRenderingContext2D, c: MountContext): void {
    const pos = mountWorldPos(c, this.mount);
    ctx.save();
    ctx.fillStyle = "rgba(255, 100, 0, 0.5)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
