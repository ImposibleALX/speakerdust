import type { ShipConfig } from "../physics/shipPhysics";
import type { Attachment } from "../sprite/spriteTypes";
import type { ShipClassDef, ShipGameplayStats, ShipAI, ExplosionConfig } from "./ShipClassDef";
import type { WeaponKind } from "../weapons/weaponDefs";

/**
 * Convierte la matriz visual 2D a un Uint8Array (Array 1D) O(1) de altísimo rendimiento para V8.
 */
function gridToPixels(grid: number[][]): { pixels: Uint8Array; w: number; h: number } {
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

function buildAttachments(list: Array<{ id: string; x: number; y: number; mountArc: "forward" | "broadside" | "omni"; size: "small" | "medium" | "large" }>, kind: Attachment["kind"]): Attachment[] {
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
  ...buildAttachments([{ id: "engine_main", x: -8, y: 0, mountArc: "forward" as const, size: "medium" as const }], "engine"),
  ...buildAttachments([{ id: "mount_front", x: 8, y: 0, mountArc: "forward" as const, size: "medium" as const },
  { id: "mount_left", x: -1, y: 4, mountArc: "broadside" as const, size: "small" as const },
  { id: "mount_right", x: 1, y: -4, mountArc: "broadside" as const, size: "small" as const },
  { id: "pdc_front_left", x: 4, y: 2, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_front_right", x: 4, y: -2, mountArc: "omni" as const, size: "small" as const }], "weapon_mount"),
];
const P = gridToPixels(_PLAYER_GRID);

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
  ...buildAttachments([{ id: "engine_left", x: -5, y: 1, mountArc: "forward" as const, size: "medium" as const },
  { id: "engine_right", x: -5, y: -1, mountArc: "forward" as const, size: "medium" as const }], "engine"),
  ...buildAttachments([{ id: "mount_front", x: 6.5, y: 0, mountArc: "forward" as const, size: "large" as const },
  { id: "mount_left", x: -0.5, y: 4, mountArc: "broadside" as const, size: "medium" as const },
  { id: "mount_right", x: 0.5, y: -5, mountArc: "broadside" as const, size: "medium" as const },
  { id: "pdc_front_left", x: 3, y: 2.5, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_front_right", x: 3, y: -2.5, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_rear", x: -4, y: 0, mountArc: "omni" as const, size: "small" as const }], "weapon_mount"),
];
const C = gridToPixels(_CRUISER_GRID);

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
  ...buildAttachments([{ id: "engine_left", x: -8.5, y: 2, mountArc: "forward" as const, size: "large" as const },
  { id: "engine_right", x: -8.5, y: -2, mountArc: "forward" as const, size: "large" as const }], "engine"),
  ...buildAttachments([{ id: "mount_front", x: 9, y: 0, mountArc: "forward" as const, size: "large" as const },
  { id: "mount_left", x: -1, y: 6, mountArc: "broadside" as const, size: "large" as const },
  { id: "mount_right", x: 1, y: -6, mountArc: "broadside" as const, size: "large" as const },
  { id: "pdc_front_left", x: 5, y: 3, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_front_right", x: 5, y: -3, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_mid_left", x: 0, y: 3.5, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_mid_right", x: 0, y: -3.5, mountArc: "omni" as const, size: "small" as const },
  { id: "pdc_rear", x: -5, y: 0, mountArc: "omni" as const, size: "small" as const }], "weapon_mount"),
];
const CAP = gridToPixels(_CAPITAL_GRID);

// ---- Data Definitions ----
const PHYS: Record<string, ShipConfig> = {
  corvette: { mass: 1.0, maxLinearSpeed: 38, maxReverseSpeed: 20, maxAngularSpeed: 7, thrustAccel: 48, reverseAccel: 32, strafeAccel: 44, turnAccel: 16, linearDrag: 1.2, angularDrag: 3.5, stopEpsilon: 0.02, inputSmoothing: 0.08 },
  destroyer: { mass: 1.6, maxLinearSpeed: 32, maxReverseSpeed: 16, maxAngularSpeed: 5.8, thrustAccel: 36, reverseAccel: 24, strafeAccel: 32, turnAccel: 11, linearDrag: 0.7, angularDrag: 2.2, stopEpsilon: 0.02, inputSmoothing: 0.1 },
  missile_frigate: { mass: 1.45, maxLinearSpeed: 30, maxReverseSpeed: 15, maxAngularSpeed: 5.2, thrustAccel: 34, reverseAccel: 22, strafeAccel: 28, turnAccel: 10, linearDrag: 0.6, angularDrag: 2, stopEpsilon: 0.02, inputSmoothing: 0.1 },
  cruiser: { mass: 2.3, maxLinearSpeed: 26, maxReverseSpeed: 12, maxAngularSpeed: 4.5, thrustAccel: 30, reverseAccel: 18, strafeAccel: 24, turnAccel: 9, linearDrag: 0.45, angularDrag: 1.5, stopEpsilon: 0.02, inputSmoothing: 0.12 },
  battlecruiser: { mass: 2.8, maxLinearSpeed: 22, maxReverseSpeed: 10, maxAngularSpeed: 3.8, thrustAccel: 26, reverseAccel: 16, strafeAccel: 20, turnAccel: 7.5, linearDrag: 0.28, angularDrag: 1.1, stopEpsilon: 0.02, inputSmoothing: 0.12 },
  battleship: { mass: 3.4, maxLinearSpeed: 18, maxReverseSpeed: 8, maxAngularSpeed: 3, thrustAccel: 22, reverseAccel: 14, strafeAccel: 16, turnAccel: 6, linearDrag: 0.18, angularDrag: 0.75, stopEpsilon: 0.02, inputSmoothing: 0.15 },
  dreadnought: { mass: 4.6, maxLinearSpeed: 14, maxReverseSpeed: 6, maxAngularSpeed: 2.2, thrustAccel: 18, reverseAccel: 11, strafeAccel: 12, turnAccel: 4.5, linearDrag: 0.12, angularDrag: 0.5, stopEpsilon: 0.02, inputSmoothing: 0.15 },
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
  corvette: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "autocannon", pdc_front_left: "point_defense", pdc_front_right: "point_defense" },
  destroyer: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "torpedo", pdc_front_left: "point_defense", pdc_front_right: "point_defense" },
  missile_frigate: { mount_front: "guided_missile", mount_left: "autocannon", mount_right: "emp_launcher", pdc_front_left: "point_defense", pdc_front_right: "point_defense", pdc_rear: "point_defense" },
  cruiser: { mount_front: "plasma_broadside", mount_left: "naval_cannon", mount_right: "energy_bomb", pdc_front_left: "point_defense", pdc_front_right: "point_defense", pdc_rear: "point_defense" },
  battlecruiser: { mount_front: "railgun", mount_left: "naval_cannon", mount_right: "guided_missile", pdc_front_left: "point_defense", pdc_front_right: "point_defense", pdc_mid_left: "point_defense", pdc_mid_right: "point_defense" },
  battleship: { mount_front: "naval_cannon", mount_left: "railgun", mount_right: "plasma_broadside", pdc_front_left: "point_defense", pdc_front_right: "point_defense", pdc_mid_left: "point_defense", pdc_mid_right: "point_defense", pdc_rear: "point_defense" },
  dreadnought: { mount_front: "railgun", mount_left: "plasma_broadside", mount_right: "naval_cannon", pdc_front_left: "point_defense", pdc_front_right: "point_defense", pdc_mid_left: "point_defense", pdc_mid_right: "point_defense", pdc_rear: "point_defense" },
};

const AI_DATA: Record<string, ShipAI> = {
  corvette: { lockTicks: 8, leadMul: 14, aimTolerance: 0.28, seekSpeed: 0.9, retreatSpeed: 0.4, orbitPower: 0.72, boostAggression: 0.6, evasionRange: 280 },
  destroyer: { lockTicks: 6, leadMul: 14, aimTolerance: 0.25, seekSpeed: 0.85, retreatSpeed: 0.5, orbitPower: 0.48, boostAggression: 0.4, evasionRange: 320 },
  missile_frigate: { lockTicks: 10, leadMul: 16, aimTolerance: 0.30, seekSpeed: 0.8, retreatSpeed: 0.4, orbitPower: 0.72, boostAggression: 0.2, evasionRange: 400 },
  cruiser: { lockTicks: 6, leadMul: 14, aimTolerance: 0.22, seekSpeed: 0.8, retreatSpeed: 0.55, orbitPower: 0.48, boostAggression: 0.3, evasionRange: 350 },
  battlecruiser: { lockTicks: 5, leadMul: 14, aimTolerance: 0.20, seekSpeed: 0.8, retreatSpeed: 0.4, orbitPower: 0.72, boostAggression: 0.3, evasionRange: 380 },
  battleship: { lockTicks: 4, leadMul: 18, aimTolerance: 0.18, seekSpeed: 0.5, retreatSpeed: 0.4, orbitPower: 0.28, boostAggression: 0.1, evasionRange: 450 },
  dreadnought: { lockTicks: 3, leadMul: 20, aimTolerance: 0.16, seekSpeed: 0.45, retreatSpeed: 0.35, orbitPower: 0.28, boostAggression: 0.0, evasionRange: 500 },
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
function buildShipClassDef(id: string, spr: { pixels: Uint8Array; w: number; h: number }, att: Attachment[]): ShipClassDef {
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
  corvette: buildShipClassDef("corvette", P, _PLAYER_ATTACHMENTS),
  destroyer: buildShipClassDef("destroyer", C, _CRUISER_ATTACHMENTS),
  missile_frigate: buildShipClassDef("missile_frigate", C, _CRUISER_ATTACHMENTS),
  cruiser: buildShipClassDef("cruiser", C, _CRUISER_ATTACHMENTS),
  battlecruiser: buildShipClassDef("battlecruiser", CAP, _CAPITAL_ATTACHMENTS),
  battleship: buildShipClassDef("battleship", CAP, _CAPITAL_ATTACHMENTS),
  dreadnought: buildShipClassDef("dreadnought", CAP, _CAPITAL_ATTACHMENTS),
};