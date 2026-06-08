import type { PixelGrid, WeaponKind } from "@speakerdust/shared";
import { SHIP_ATTACHMENTS } from "@speakerdust/shared";
import { drawWeaponOnMount, createWeaponCache } from "./weaponRenderer";

interface ShipCacheEntry {
  canvas: HTMLCanvasElement;
  cx: number;
  cy: number;
}

export function createPixelShipRenderer(ctx: CanvasRenderingContext2D) {
  createWeaponCache();

  const shipCache = new Map<string, ShipCacheEntry>();

  // --- OPTIMIZACIÓN EXTREMA: Uso de WeakMap para evitar escanear el Grid ---
  let gridIdCounter = 0;
  const gridIds = new WeakMap<PixelGrid, number>();

  function getGridId(grid: PixelGrid): number {
    let id = gridIds.get(grid);
    if (id === undefined) {
      id = ++gridIdCounter;
      gridIds.set(grid, id);
    }
    return id;
  }

  let paletteVersion = 0;
  const paletteKeys = new Map<string, number>();

  function paletteId(palette: Record<number, string>): number {
    // Stringify rápido de objetos pequeños para evitar lag
    const str = JSON.stringify(palette);
    const existing = paletteKeys.get(str);
    if (existing !== undefined) return existing;
    const id = ++paletteVersion;
    paletteKeys.set(str, id);
    return id;
  }

  function getCachedShip(
    grid: PixelGrid,
    palette: Record<number, string>,
    ps: number
  ): ShipCacheEntry {
    // Usamos el ID instantáneo del WeakMap en lugar del costoso gridHash
    const key = `${getGridId(grid)}_${ps}_${paletteId(palette)}`;
    const existing = shipCache.get(key);
    if (existing) return existing;

    const rows = grid.length;
    const cols = grid[0]!.length;
    const oc = document.createElement("canvas");
    oc.width = cols * ps;
    oc.height = rows * ps;
    const octx = oc.getContext("2d")!;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r]![c]!;
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
    grid: PixelGrid,
    cx: number,
    cy: number,
    angle: number,
    palette: Record<number, string>,
    ps: number,
    shipType?: string,
    loadout?: Record<string, WeaponKind>,
    tick?: number
  ): void {
    const cached = getCachedShip(grid, palette, ps);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(cached.canvas, -Math.floor(cached.cx), -Math.floor(cached.cy));
    ctx.restore();

    if (shipType && loadout) {
      renderWeaponAttachments(ctx, shipType, loadout, cx, cy, angle, tick ?? 0, ps);
    }
  }

  function renderWeaponAttachments(
    c: CanvasRenderingContext2D,
    shipType: string,
    loadout: Record<string, WeaponKind>,
    shipX: number,
    shipY: number,
    shipAngle: number,
    tick: number,
    ps: number
  ): void {
    const attachments = SHIP_ATTACHMENTS[shipType];
    if (!attachments) return;

    const cos = Math.cos(shipAngle);
    const sin = Math.sin(shipAngle);

    for (const mount of attachments.weapons) {
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

  return {
    drawPixelShip,
  };
}