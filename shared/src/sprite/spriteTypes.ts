export type MountArc = "forward" | "broadside" | "omni";

export interface Attachment {
  readonly id: string;
  readonly kind: "weapon_mount" | "engine" | "turret_base" | "emitter" | "exhaust" | "hardpoint";
  readonly x: number;
  readonly y: number;
  readonly mountArc: MountArc;
  readonly size: "small" | "medium" | "large";
  readonly tags: readonly string[];
}

export interface Sprite {
  readonly pixels: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly attachments: readonly Attachment[];
}

export interface SpriteDef {
  readonly grid: readonly (readonly number[])[];
  readonly attachments: readonly Attachment[];
}

/** Devuelve el píxel en (x, y). Devuelve 0 si está fuera de límites. */
export function pixelAt(s: Sprite, x: number, y: number): number {
  if (x < 0 || x >= s.w || y < 0 || y >= s.h) {
    return 0;
  }
  return s.pixels[y * s.w + x]!;
}

export function createSprite(def: SpriteDef): Sprite {
  const h = def.grid.length;

  if (h === 0) {
    return {
      pixels: new Uint8Array(0),
      w: 0,
      h: 0,
      attachments: Object.freeze([...def.attachments]),
    };
  }

  const w = def.grid[0]!.length;

  // === VALIDACIÓN DE MATRIZ RECTANGULAR ===
  for (let r = 1; r < h; r++) {
    if (def.grid[r]!.length !== w) {
      throw new Error(
        `SpriteDef inválido: todas las filas deben tener la misma longitud. ` +
        `Fila 0 tiene ${w}, fila ${r} tiene ${def.grid[r]!.length}`
      );
    }
  }

  const pixels = new Uint8Array(w * h);

  for (let r = 0; r < h; r++) {
    const row = def.grid[r]!;
    for (let c = 0; c < w; c++) {
      let value = row[c] ?? 0;
      // Normalizar a rango válido para Uint8Array
      value = Math.max(0, Math.min(255, Math.floor(value)));
      pixels[r * w + c] = value;
    }
  }

  return {
    pixels,
    w,
    h,
    attachments: Object.freeze([...def.attachments]),
  };
}