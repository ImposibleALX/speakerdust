import { MountRenderer, mountWorldPos, type MountContext } from "./MountRenderer";

// SO: Armas sin sprite visible en la montura (autocannon, railgun)
// R: https://stackoverflow.com/questions/6205438/entity-component-system-vs-inheritance-for-weapons
//    Cuando un arma no tiene representación visual en la montura,
//    el render es no-op pero el debugDraw sigue siendo útil para
//    ver arcos de fuego y posición exacta. Útil para balanceo.

export class NoSpriteMountRenderer extends MountRenderer {
  render(_ctx: CanvasRenderingContext2D, _c: MountContext): void {
    // no-op: esta montura no tiene sprite
  }

  debugDraw(ctx: CanvasRenderingContext2D, c: MountContext): void {
    const pos = mountWorldPos(c, this.mount);
    ctx.save();
    ctx.strokeStyle = "#4cc9f0";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arco de fuego (minAngle a maxAngle)
    const shipAngle = c.shipAngle;
    const min = shipAngle + this.mount.minAngle;
    const max = shipAngle + this.mount.maxAngle;
    ctx.strokeStyle = "rgba(76, 201, 240, 0.25)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 12, min, max);
    ctx.stroke();

    ctx.strokeStyle = "rgba(76, 201, 240, 0.5)";
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + Math.cos(this.getEffectiveAngle(c)) * 14, pos.y + Math.sin(this.getEffectiveAngle(c)) * 14);
    ctx.stroke();

    ctx.restore();
  }
}
