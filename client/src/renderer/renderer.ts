import type { Sprite } from "@speakerdust/shared";

interface ShipCacheEntry {
  canvas: HTMLCanvasElement;
  cx: number;
  cy: number;
}

export function createPixelShipRenderer(ctx: CanvasRenderingContext2D) {
  const shipCache = new Map<string, ShipCacheEntry>();

  let spriteIdCounter = 0;
  const spriteIds = new WeakMap<Uint8Array, number>();

  function getSpriteId(pixels: Uint8Array): number {
    let id = spriteIds.get(pixels);
    if (id === undefined) {
      id = ++spriteIdCounter;
      spriteIds.set(pixels, id);
    }
    return id;
  }

  let paletteVersion = 0;
  // WeakMap: usa identidad de referencia (===) en vez de JSON.stringify
  // La paleta no muta y su referencia es estable (cacheadas en _palCache de game.ts)
  // https://stackoverflow.com/questions/29413222/what-are-the-actual-uses-of-es6-weakmap
  const paletteIds = new WeakMap<Record<number, string>, number>();

  function paletteId(palette: Record<number, string>): number {
    const existing = paletteIds.get(palette);
    if (existing !== undefined) return existing;
    const id = ++paletteVersion;
    paletteIds.set(palette, id);
    return id;
  }

  function getCachedShip(
    sprite: Sprite,
    palette: Record<number, string>,
    ps: number,
    glowColor: string,
    glowBlur: number,
  ): ShipCacheEntry {
    const key = `${getSpriteId(sprite.pixels)}_${ps}_${paletteId(palette)}_${glowColor}_${glowBlur}`;
    const existing = shipCache.get(key);
    if (existing) return existing;

    const { pixels, w, h } = sprite;
    const baseW = w * ps;
    const baseH = h * ps;
    const pad = glowBlur;
    const totalW = baseW + pad * 2;
    const totalH = baseH + pad * 2;
    const oc = document.createElement("canvas");
    oc.width = totalW;
    oc.height = totalH;
    const octx = oc.getContext("2d")!;

    octx.shadowBlur = glowBlur;
    octx.shadowColor = glowColor;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const v = pixels[r * w + c];
        if (!v || !palette[v]) continue;
        octx.fillStyle = palette[v]!;
        octx.fillRect(c * ps + pad, r * ps + pad, ps, ps);
      }
    }
    octx.shadowBlur = 0;

    const entry: ShipCacheEntry = { canvas: oc, cx: oc.width / 2, cy: oc.height / 2 };
    shipCache.set(key, entry);
    return entry;
  }

  function drawPixelShip(
    sprite: Sprite,
    cx: number,
    cy: number,
    angle: number,
    palette: Record<number, string>,
    ps: number,
    glowColor: string,
    glowBlur: number,
  ): void {
    const cached = getCachedShip(sprite, palette, ps, glowColor, glowBlur);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(cached.canvas, -cached.cx, -cached.cy);
    ctx.restore();
  }

  function drawHitboxOverlay(
    sprite: Sprite,
    cx: number,
    cy: number,
    angle: number,
    ps: number,
  ): void {
    const { w, h, pixels } = sprite;
    const halfW = Math.floor(w * ps / 2);
    const halfH = Math.floor(h * ps / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(0, 255, 255, 0.35)";
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (!pixels[r * w + c]) continue;
        ctx.fillRect(c * ps - halfW, r * ps - halfH, ps, ps);
      }
    }
    ctx.restore();
  }

  return {
    drawPixelShip,
    drawHitboxOverlay,
  };
}
