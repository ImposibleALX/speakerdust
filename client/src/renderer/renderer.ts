import type { Sprite, Attachment, WeaponKind } from "@speakerdust/shared";
import { drawWeaponOnMount, createWeaponCache } from "./weaponRenderer";

interface ShipCacheEntry {
  canvas: HTMLCanvasElement;
  cx: number;
  cy: number;
}

export function createPixelShipRenderer(ctx: CanvasRenderingContext2D) {
  createWeaponCache();

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
  const paletteKeys = new Map<string, number>();

  function paletteId(palette: Record<number, string>): number {
    const str = JSON.stringify(palette);
    const existing = paletteKeys.get(str);
    if (existing !== undefined) return existing;
    const id = ++paletteVersion;
    paletteKeys.set(str, id);
    return id;
  }

  function getCachedShip(
    sprite: Sprite,
    palette: Record<number, string>,
    ps: number
  ): ShipCacheEntry {
    const key = `${getSpriteId(sprite.pixels)}_${ps}_${paletteId(palette)}`;
    const existing = shipCache.get(key);
    if (existing) return existing;

    const { pixels, w, h } = sprite;
    const oc = document.createElement("canvas");
    oc.width = w * ps;
    oc.height = h * ps;
    const octx = oc.getContext("2d")!;

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const v = pixels[r * w + c];
        if (!v || !palette[v]) continue;
        octx.fillStyle = palette[v]!;
        octx.fillRect(c * ps, r * ps, ps, ps);
      }
    }

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
    loadout?: Record<string, WeaponKind>,
    tick?: number
  ): void {
    const cached = getCachedShip(sprite, palette, ps);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(cached.canvas, -Math.floor(cached.cx), -Math.floor(cached.cy));
    ctx.restore();

    if (loadout && sprite.attachments.length > 0) {
      renderWeaponAttachments(ctx, sprite.attachments, loadout, cx, cy, angle, tick ?? 0, ps);
    }
  }

  function renderWeaponAttachments(
    c: CanvasRenderingContext2D,
    attachments: readonly Attachment[],
    loadout: Record<string, WeaponKind>,
    shipX: number,
    shipY: number,
    shipAngle: number,
    tick: number,
    ps: number
  ): void {
    const cos = Math.cos(shipAngle);
    const sin = Math.sin(shipAngle);

    for (const mount of attachments) {
      if (mount.kind !== "weapon_mount") continue;
      const weaponKind = loadout[mount.id];
      if (!weaponKind) continue;

      const mx = mount.x * ps;
      const my = mount.y * ps;
      const worldX = shipX + mx * cos - my * sin;
      const worldY = shipY + mx * sin + my * cos;

      let weaponAngle = shipAngle;
      if (mount.mountArc === "broadside") {
        weaponAngle += mount.x < 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      drawWeaponOnMount(c, weaponKind, worldX, worldY, weaponAngle, tick);
    }
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
