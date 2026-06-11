import type { ShipConfig } from "../physics/shipPhysics";
import type { Attachment } from "../sprite/spriteTypes";
import type { ShipClassDef, ShipGameplayStats, ShipAI, ExplosionConfig } from "./ShipClassDef";
import type { WeaponKind } from "../weapons/weaponDefs";

/**
 * Convierte la matriz visual 2D a un Uint8Array (Array 1D) O(1) de altísimo rendimiento para V8.
 */
function px(grid: number[][]): { pixels: Uint8Array; w: number; h: number } {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const pixels = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    const row = grid[r]!;
    for (let c = 0; c < w; c++) {
      pixels[r * w + c] = row[c] ?? 0;
    }
  }
  return { pixels, w, h };
}

function atts(list: Array<{ id: string; x: number; y: number; mountArc: "forward" | "broadside" | "omni"; size: "small" | "medium" | "large" }>, kind: Attachment["kind"]): Attachment[] {
  return list.map(a => ({ id: a.id, kind, x: a.x, y: a.y, mountArc: a.mountArc, size: a.size, tags: [] }));
}

// ---- Player sprite (corvette) ----
const _PLAYER_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 4, 7, 7, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 4, 1, 1, 6, 1, 5, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 3, 4, 1, 1, 1, 1, 1, 5, 1, 5, 1, 1, 1, 0, 0],
  [0, 3, 3, 1, 6, 1, 5, 1, 2, 2, 1, 6, 1, 2, 1, 1, 0],
  [3, 0, 1, 1, 6, 1, 5, 1, 2, 8, 1, 6, 1, 2, 8, 8, 2],
  [0, 3, 3, 1, 6, 1, 5, 1, 2, 2, 1, 6, 1, 2, 1, 1, 0],
  [0, 0, 3, 4, 1, 1, 1, 1, 1, 5, 1, 5, 1, 1, 1, 0, 0],
  [0, 0, 0, 4, 4, 1, 1, 6, 1, 5, 1, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 4, 7, 7, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0],
];
const _PLAYER_ATTACHMENTS: Attachment[] = [
  ...atts([{ id: "engine_main", x: 8, y: 0, mountArc: "forward" as const, size: "medium" as const }], "engine"),
  ...atts([{ id: "mount_front", x: -8, y: 0, mountArc: "forward" as const, size: "medium" as const },
  { id: "mount_left", x: 0, y: 4, mountArc: "broadside" as const, size: "small" as const },
  { id: "mount_right", x: 0, y: -4, mountArc: "broadside" as const, size: "small" as const }], "weapon_mount"),
];
const P = px(_PLAYER_GRID);

// ---- Cruiser sprite (destroyer, missile_frigate, cruiser) ----
const _CRUISER_GRID = [
  [0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 1, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 0, 0, 4, 1, 1, 5, 1, 1, 4, 4, 0, 0],
  [0, 0, 3, 4, 1, 5, 1, 1, 6, 1, 1, 4, 4, 0],
  [0, 3, 3, 1, 1, 6, 1, 1, 1, 1, 5, 1, 4, 4],
  [3, 0, 1, 1, 1, 1, 1, 8, 2, 1, 6, 1, 8, 2],
  [0, 3, 3, 1, 1, 6, 1, 1, 1, 1, 5, 1, 4, 4],
  [0, 0, 3, 4, 1, 5, 1, 1, 6, 1, 1, 4, 4, 0],
  [0, 0, 0, 0, 4, 1, 1, 5, 1, 1, 4, 4, 0, 0],
  [0, 0, 0, 0, 0, 4, 1, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];
const _CRUISER_ATTACHMENTS: Attachment[] = [
  ...atts([{ id: "engine_left", x: 6.5, y: 2, mountArc: "forward" as const, size: "medium" as const },
  { id: "engine_right", x: 6.5, y: -2, mountArc: "forward" as const, size: "medium" as const }], "engine"),
  ...atts([{ id: "mount_front", x: -6.5, y: 0, mountArc: "forward" as const, size: "large" as const },
  { id: "mount_left", x: -0.5, y: 5, mountArc: "broadside" as const, size: "medium" as const },
  { id: "mount_right", x: -0.5, y: -5, mountArc: "broadside" as const, size: "medium" as const }], "weapon_mount"),
];
const C = px(_CRUISER_GRID);

// ---- Capital sprite (battlecruiser, battleship, dreadnought) ----
const _CAPITAL_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 1, 7, 7, 7, 1, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 4, 1, 1, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 4, 1, 5, 1, 6, 1, 5, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 0, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 0],
  [0, 0, 3, 4, 1, 5, 1, 6, 1, 5, 1, 6, 1, 5, 1, 4, 4, 0, 0],
  [0, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 0],
  [0, 0, 0, 3, 1, 6, 1, 5, 1, 1, 6, 1, 2, 2, 1, 5, 1, 4, 4],
  [0, 0, 3, 1, 1, 6, 1, 5, 1, 1, 8, 1, 2, 8, 1, 6, 1, 8, 2],
  [0, 0, 0, 3, 1, 6, 1, 5, 1, 1, 6, 1, 2, 2, 1, 5, 1, 4, 4],
  [0, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 0],
  [0, 0, 3, 4, 1, 5, 1, 6, 1, 5, 1, 6, 1, 5, 1, 4, 4, 0, 0],
  [0, 0, 0, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 0],
  [0, 0, 0, 0, 4, 4, 1, 5, 1, 6, 1, 5, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 4, 1, 1, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 1, 7, 7, 7, 1, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0],
];
const _CAPITAL_ATTACHMENTS: Attachment[] = [
  ...atts([{ id: "engine_left", x: 9, y: 2, mountArc: "forward" as const, size: "large" as const },
  { id: "engine_right", x: 9, y: -2, mountArc: "forward" as const, size: "large" as const }], "engine"),
  ...atts([{ id: "mount_front", x: -9, y: 0, mountArc: "forward" as const, size: "large" as const },
  { id: "mount_left", x: -1, y: 6, mountArc: "broadside" as const, size: "large" as const },
  { id: "mount_right", x: -1, y: -6, mountArc: "broadside" as const, size: "large" as const }], "weapon_mount"),
];
const CAP = px(_CAPITAL_GRID);

// ---- Data Definitions ----
const PHYS: Record<string, ShipConfig> = {
  corvette: { mass: 1.0, maxLinearSpeed: 30, maxReverseSpeed: 15, maxAngularSpeed: 7, thrustAccel: 38, reverseAccel: 24, strafeAccel: 32, turnAccel: 16, linearDrag: 1.2, angularDrag: 3.5, stopEpsilon: 0.02, inputSmoothing: 0.08 },
  destroyer: { mass: 1.6, maxLinearSpeed: 25, maxReverseSpeed: 12, maxAngularSpeed: 5.8, thrustAccel: 28, reverseAccel: 18, strafeAccel: 22, turnAccel: 11, linearDrag: 0.7, angularDrag: 2.2, stopEpsilon: 0.02, inputSmoothing: 0.1 },
  missile_frigate: { mass: 1.45, maxLinearSpeed: 23, maxReverseSpeed: 11, maxAngularSpeed: 5.2, thrustAccel: 26, reverseAccel: 17, strafeAccel: 20, turnAccel: 10, linearDrag: 0.6, angularDrag: 2, stopEpsilon: 0.02, inputSmoothing: 0.1 },
  cruiser: { mass: 2.3, maxLinearSpeed: 20, maxReverseSpeed: 9, maxAngularSpeed: 4.5, thrustAccel: 22, reverseAccel: 14, strafeAccel: 16, turnAccel: 9, linearDrag: 0.45, angularDrag: 1.5, stopEpsilon: 0.02, inputSmoothing: 0.12 },
  battlecruiser: { mass: 2.8, maxLinearSpeed: 17, maxReverseSpeed: 8, maxAngularSpeed: 3.8, thrustAccel: 19, reverseAccel: 12, strafeAccel: 13, turnAccel: 7.5, linearDrag: 0.28, angularDrag: 1.1, stopEpsilon: 0.02, inputSmoothing: 0.12 },
  battleship: { mass: 3.4, maxLinearSpeed: 14, maxReverseSpeed: 6.5, maxAngularSpeed: 3, thrustAccel: 16, reverseAccel: 10, strafeAccel: 10, turnAccel: 6, linearDrag: 0.18, angularDrag: 0.75, stopEpsilon: 0.02, inputSmoothing: 0.15 },
  dreadnought: { mass: 4.6, maxLinearSpeed: 11, maxReverseSpeed: 5, maxAngularSpeed: 2.2, thrustAccel: 13, reverseAccel: 8, strafeAccel: 7, turnAccel: 4.5, linearDrag: 0.12, angularDrag: 0.5, stopEpsilon: 0.02, inputSmoothing: 0.15 },
};

const STATS: Record<string, ShipGameplayStats> = {
  corvette: { label: "Scout Corvette", role: "Fast screen ship", maxHp: 5, shieldMax: 2, armorMax: 1, heatCoolRate: 0.65, boostRegenRate: 0.42, shieldRegenDelay: 120, shieldRegenInterval: 140, weaponSlots: ["autocannon", "naval_cannon", "guided_missile", "torpedo"], score: 120, idealRange: 250 },
  destroyer: { label: "Destroyer", role: "Line combatant", maxHp: 8, shieldMax: 1, armorMax: 3, heatCoolRate: 0.55, boostRegenRate: 0.38, shieldRegenDelay: 150, shieldRegenInterval: 190, weaponSlots: ["naval_cannon", "autocannon", "torpedo", "emp_launcher"], score: 260, idealRange: 330 },
  missile_frigate: { label: "Missile Frigate", role: "Standoff pressure", maxHp: 7, shieldMax: 1, armorMax: 2, heatCoolRate: 0.58, boostRegenRate: 0.40, shieldRegenDelay: 140, shieldRegenInterval: 170, weaponSlots: ["guided_missile", "torpedo", "autocannon", "emp_launcher"], score: 320, idealRange: 410 },
  cruiser: { label: "Cruiser", role: "Area control", maxHp: 11, shieldMax: 2, armorMax: 4, heatCoolRate: 0.48, boostRegenRate: 0.35, shieldRegenDelay: 180, shieldRegenInterval: 220, weaponSlots: ["plasma_broadside", "naval_cannon", "energy_bomb", "emp_launcher"], score: 520, idealRange: 430 },
  battlecruiser: { label: "Battlecruiser", role: "Heavy pursuit", maxHp: 14, shieldMax: 2, armorMax: 5, heatCoolRate: 0.45, boostRegenRate: 0.32, shieldRegenDelay: 200, shieldRegenInterval: 240, weaponSlots: ["railgun", "naval_cannon", "guided_missile", "plasma_broadside"], score: 700, idealRange: 480 },
  battleship: { label: "Battleship", role: "Dominant artillery", maxHp: 18, shieldMax: 2, armorMax: 7, heatCoolRate: 0.40, boostRegenRate: 0.30, shieldRegenDelay: 220, shieldRegenInterval: 280, weaponSlots: ["railgun", "plasma_broadside", "naval_cannon", "emp_launcher"], score: 900, idealRange: 520 },
  dreadnought: { label: "Dreadnought", role: "Fleet anchor", maxHp: 26, shieldMax: 3, armorMax: 10, heatCoolRate: 0.35, boostRegenRate: 0.25, shieldRegenDelay: 250, shieldRegenInterval: 320, weaponSlots: ["energy_bomb", "plasma_broadside", "railgun", "emp_launcher"], score: 2000, idealRange: 580 },
};

const LOADOUTS: Record<string, Record<string, WeaponKind>> = {
  corvette: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "autocannon" },
  destroyer: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "torpedo" },
  missile_frigate: { mount_front: "guided_missile", mount_left: "autocannon", mount_right: "emp_launcher" },
  cruiser: { mount_front: "plasma_broadside", mount_left: "naval_cannon", mount_right: "energy_bomb" },
  battlecruiser: { mount_front: "railgun", mount_left: "naval_cannon", mount_right: "guided_missile" },
  battleship: { mount_front: "naval_cannon", mount_left: "railgun", mount_right: "plasma_broadside" },
  dreadnought: { mount_front: "railgun", mount_left: "plasma_broadside", mount_right: "naval_cannon" },
};

const AI_DATA: Record<string, ShipAI> = {
  corvette: { aimJitter: 0.12, leadMul: 10, aimNoise: 0.14, maxAimError: 0.45, seekSpeed: 0.8, retreatSpeed: 0.35, orbitPower: 0.72 },
  destroyer: { aimJitter: 0.12, leadMul: 10, aimNoise: 0.12, maxAimError: 0.45, seekSpeed: 0.8, retreatSpeed: 0.55, orbitPower: 0.48 },
  missile_frigate: { aimJitter: 0.08, leadMul: 10, aimNoise: 0.10, maxAimError: 0.45, seekSpeed: 0.8, retreatSpeed: 0.35, orbitPower: 0.72 },
  cruiser: { aimJitter: 0.08, leadMul: 10, aimNoise: 0.09, maxAimError: 0.40, seekSpeed: 0.8, retreatSpeed: 0.55, orbitPower: 0.48 },
  battlecruiser: { aimJitter: 0.08, leadMul: 10, aimNoise: 0.08, maxAimError: 0.45, seekSpeed: 0.8, retreatSpeed: 0.35, orbitPower: 0.72 },
  battleship: { aimJitter: 0.06, leadMul: 16, aimNoise: 0.08, maxAimError: 0.38, seekSpeed: 0.45, retreatSpeed: 0.35, orbitPower: 0.28 },
  dreadnought: { aimJitter: 0.06, leadMul: 16, aimNoise: 0.08, maxAimError: 0.38, seekSpeed: 0.45, retreatSpeed: 0.35, orbitPower: 0.28 },
};

const EXPLOSION_DATA: Record<string, ExplosionConfig> = {
  corvette: { primaryColors: ["#ff2060", "#ffaa20", "#ffffff"], primaryCount: 16, primarySize: 4, scale: 1.0, shakeIntensity: 0, shakeDuration: 0, screenShakeRadius: 160 },
  destroyer: { primaryColors: ["#ff2060", "#ffaa20", "#ffffff"], primaryCount: 16, primarySize: 4, scale: 1.0, shakeIntensity: 0, shakeDuration: 0, screenShakeRadius: 160 },
  missile_frigate: { primaryColors: ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], primaryCount: 24, primarySize: 5, scale: 1.0, shakeIntensity: 0, shakeDuration: 0, screenShakeRadius: 200 },
  cruiser: { primaryColors: ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], primaryCount: 24, primarySize: 5, scale: 1.0, shakeIntensity: 0, shakeDuration: 0, screenShakeRadius: 200 },
  battlecruiser: { primaryColors: ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], primaryCount: 24, primarySize: 5, scale: 1.2, shakeIntensity: 0.3, shakeDuration: 60, screenShakeRadius: 300 },
  battleship: { primaryColors: ["#ffcc00", "#ff6600", "#ffffff", "#4466ff"], primaryCount: 40, primarySize: 7, scale: 1.8, shakeIntensity: 1.2, shakeDuration: 180, screenShakeRadius: 380 },
  dreadnought: { primaryColors: ["#ffcc00", "#ff6600", "#ffffff", "#4466ff"], primaryCount: 40, primarySize: 7, scale: 2.5, shakeIntensity: 1.8, shakeDuration: 260, screenShakeRadius: 540 },
};

const NEAR_AUDIO: Record<string, number> = {
  corvette: 0, destroyer: 0, missile_frigate: 0, cruiser: 0, battlecruiser: 0, battleship: 0, dreadnought: 150,
};

const PAL_KEYS: Record<string, "scout" | "cruiser" | "capital"> = {
  corvette: "scout", destroyer: "cruiser", missile_frigate: "cruiser", cruiser: "cruiser",
  battlecruiser: "capital", battleship: "capital", dreadnought: "capital",
};

const GLOW: Record<string, string> = {
  corvette: "#ff2060", destroyer: "#cc00ff", missile_frigate: "#cc00ff", cruiser: "#cc00ff",
  battlecruiser: "#4466ff", battleship: "#4466ff", dreadnought: "#4466ff",
};

// ---- CONSTRUCTOR MAESTRO: HITBOX PERFECTA ----
function build(id: string, spr: { pixels: Uint8Array; w: number; h: number }, att: Attachment[]): ShipClassDef {
  const cx = spr.w / 2;
  const cy = spr.h / 2;
  let maxRSq = 0; // Radio máximo al cuadrado (para no hacer raíces cuadradas en el loop)

  // CÁLCULO DE HITBOX INFALIBLE:
  // No evaluamos solo la esquina superior izquierda del píxel (x, y). 
  // Evaluamos las 4 esquinas reales del píxel para que el Bounding Circle sea PERFECTO.
  for (let y = 0; y < spr.h; y++) {
    const rowOffset = y * spr.w;
    for (let x = 0; x < spr.w; x++) {
      if (spr.pixels[rowOffset + x] !== 0) { // Si el píxel es sólido
        // Esquinas relativas al centro real de la matriz
        const left = x - cx;
        const right = x + 1 - cx;
        const top = y - cy;
        const bottom = y + 1 - cy;

        // Comprobar la distancia máxima a las 4 esquinas del píxel actual
        maxRSq = Math.max(
          maxRSq,
          left * left + top * top,
          right * right + top * top,
          left * left + bottom * bottom,
          right * right + bottom * bottom
        );
      }
    }
  }

  return {
    physics: PHYS[id]!,
    stats: STATS[id]!,
    ai: AI_DATA[id]!,
    explosion: EXPLOSION_DATA[id]!,
    nearAudioDistance: NEAR_AUDIO[id]!,
    paletteKey: PAL_KEYS[id]!,
    glowColor: GLOW[id]!,
    pixels: spr.pixels,     // Array 1D listico para el lookup O(1) de Balas
    w: spr.w,
    h: spr.h,
    attachments: att,
    spriteCenter: { x: cx, y: cy },
    boundingRadius: Math.sqrt(maxRSq) * 3, // Broad-Phase infalible (ajustado por pixel scale = 3)
    defaultLoadout: LOADOUTS[id]!,
  };
}

export const SHIP_CLASSES: Record<string, ShipClassDef> = {
  corvette: build("corvette", P, _PLAYER_ATTACHMENTS),
  destroyer: build("destroyer", C, _CRUISER_ATTACHMENTS),
  missile_frigate: build("missile_frigate", C, _CRUISER_ATTACHMENTS),
  cruiser: build("cruiser", C, _CRUISER_ATTACHMENTS),
  battlecruiser: build("battlecruiser", CAP, _CAPITAL_ATTACHMENTS),
  battleship: build("battleship", CAP, _CAPITAL_ATTACHMENTS),
  dreadnought: build("dreadnought", CAP, _CAPITAL_ATTACHMENTS),
};