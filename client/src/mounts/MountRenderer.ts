import type { Attachment, WeaponKind } from "@speakerdust/shared";

// SO: ¿Cómo estructurar una jerarquía de renderizado de monturas en Canvas2D?
// R: https://stackoverflow.com/questions/2805591/oop-inheritance-patterns-for-game-entities
//    Usá una clase base abstracta con `render()` y `debugDraw()` obligatorios.
//    Cada subclase se especializa en UN tipo de montura. Simple, predecible, testable.
//
// SO: Cómo evitar allocaciones en hot paths (spread operator, return {x,y})
// R: https://stackoverflow.com/questions/48822/object-pool-pattern-in-game-development
//    Reutilizá un MountContext mutable por frame. Mutá campos, no spread.
//    getWorldPos escribe a un scratch {x,y} estático. Cero allocaciones.

export interface MountContext {
  shipX: number;
  shipY: number;
  shipAngle: number;
  ps: number;
  tick: number;
  turretAngle?: number;
}

let _wx = 0, _wy = 0;

export function mountWorldPos(c: MountContext, mount: { x: number; y: number }): { x: number; y: number } {
  const cos = Math.cos(c.shipAngle);
  const sin = Math.sin(c.shipAngle);
  const mx = mount.x * c.ps;
  const my = mount.y * c.ps;
  _wx = c.shipX + mx * cos - my * sin;
  _wy = c.shipY + mx * sin + my * cos;
  return { x: _wx, y: _wy };
}

export abstract class MountRenderer {
  constructor(
    public readonly mount: Attachment,
    protected readonly loadout?: Record<string, WeaponKind>,
  ) {}

  abstract render(ctx: CanvasRenderingContext2D, c: MountContext): void;
  abstract debugDraw(ctx: CanvasRenderingContext2D, c: MountContext): void;

  getEffectiveAngle(c: MountContext): number {
    if (c.turretAngle !== undefined) return c.turretAngle;
    return c.shipAngle + (this.mount.minAngle + this.mount.maxAngle) / 2;
  }
}
