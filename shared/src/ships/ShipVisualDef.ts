import type { Attachment } from "../sprite/spriteTypes";
import type { ExplosionConfig } from "./ShipClassDef";

function gridToPixels(grid: number[][]): Uint8Array {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const pixels = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    const row = grid[r]!;
    for (let c = 0; c < w; c++) {
      pixels[r * w + c] = row[c] ?? 0;
    }
  }
  return pixels;
}

export class ShipVisualDef {
  readonly pixels: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly spriteCenter: { readonly x: number; readonly y: number };

  constructor(
    readonly grid: number[][],
    readonly palette: Readonly<Record<number, string>>,
    readonly glowColor: string,
    readonly explosion: ExplosionConfig,
    readonly attachments: readonly Attachment[],
  ) {
    this.w = grid[0]?.length ?? 0;
    this.h = grid.length;
    this.pixels = gridToPixels(grid);
    this.spriteCenter = { x: this.w / 2, y: this.h / 2 };
  }
}
