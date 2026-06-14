import type { ShipConfig } from "../physics/shipPhysics";
import type { Attachment } from "../sprite/spriteTypes";
import type { ShipClassDef, ShipGameplayStats, ShipAI, ExplosionConfig } from "./ShipClassDef";
import type { WeaponKind } from "../weapons/weaponDefs";
import { ShipVisualDef } from "./ShipVisualDef";

function buildAttachments(list: Array<{ id: string; x: number; y: number; minAngle?: number; maxAngle?: number; turnRate?: number; size: "small" | "medium" | "large" }>, kind: Attachment["kind"]): Attachment[] {
  return list.map(a => ({ id: a.id, kind, x: a.x, y: a.y, minAngle: a.minAngle ?? 0, maxAngle: a.maxAngle ?? 0, turnRate: a.turnRate ?? 0, size: a.size, tags: [] }));
}

// ---- Grids (Diseños creativos, Orientación correcta: Proa a la Derecha +X) ----

// CORVETTE: Caza estelar furtivo de alas adelantadas (Swept-wing stealth fighter)
const CORVETTE_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 3, 3, 1, 4, 4, 0, 0, 0, 0, 0],
  [0, 4, 3, 3, 1, 1, 1, 1, 4, 4, 0, 0, 0],
  [4, 6, 8, 2, 2, 1, 1, 1, 1, 1, 4, 0, 0],
  [4, 6, 8, 2, 2, 2, 1, 1, 5, 1, 1, 4, 0],
  [4, 6, 8, 2, 2, 2, 1, 1, 5, 5, 1, 1, 4], // Centro
  [4, 6, 8, 2, 2, 2, 1, 1, 5, 1, 1, 4, 0],
  [4, 6, 8, 2, 2, 1, 1, 1, 1, 1, 4, 0, 0],
  [0, 4, 3, 3, 1, 1, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 4, 3, 3, 1, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

// DESTROYER: Bestia blindada con garras frontales gemelas
const DESTROYER_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 4, 3, 3, 3, 1, 4, 4, 4, 0, 0, 0, 0, 0, 0],
  [4, 6, 8, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4, 4, 0],
  [0, 4, 4, 1, 1, 2, 2, 1, 5, 1, 1, 1, 3, 3, 4],
  [0, 0, 4, 1, 1, 2, 2, 1, 5, 5, 1, 1, 1, 1, 4], // Centro
  [0, 4, 4, 1, 1, 2, 2, 1, 5, 1, 1, 1, 3, 3, 4],
  [4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4, 4, 0],
  [4, 6, 8, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [0, 4, 3, 3, 3, 1, 4, 4, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

// MISSILE FRIGATE: Perfil estilizado con cápsulas de misiles laterales expuestas
const MISSILE_FRIGATE_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 1, 1, 8, 8, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 1, 1, 2, 2, 1, 1, 4, 0, 0, 0, 0, 0],
  [0, 4, 6, 1, 1, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0],
  [4, 6, 8, 2, 2, 1, 1, 5, 1, 1, 1, 1, 4, 4, 0],
  [4, 6, 8, 2, 2, 1, 1, 5, 5, 1, 1, 1, 1, 1, 4], // Centro
  [4, 6, 8, 2, 2, 1, 1, 5, 1, 1, 1, 1, 4, 4, 0],
  [0, 4, 6, 1, 1, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 4, 1, 1, 2, 2, 1, 1, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 1, 1, 8, 8, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

// CRUISER: Nave con alas en abanico gigantes e intimidantes
const CRUISER_GRID = [
  [0, 0, 0, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 4, 3, 3, 1, 1, 3, 4, 0, 0, 0, 0, 0, 0],
  [0, 4, 1, 1, 2, 2, 1, 1, 3, 4, 0, 0, 0, 0, 0],
  [4, 6, 8, 8, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0],
  [0, 4, 4, 1, 1, 2, 2, 1, 1, 5, 1, 1, 1, 4, 0],
  [0, 0, 4, 1, 1, 2, 2, 1, 1, 5, 5, 1, 1, 1, 4], // Centro
  [0, 4, 4, 1, 1, 2, 2, 1, 1, 5, 1, 1, 1, 4, 0],
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0],
  [4, 6, 8, 8, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [0, 4, 1, 1, 2, 2, 1, 1, 3, 4, 0, 0, 0, 0, 0],
  [0, 0, 4, 3, 3, 1, 1, 3, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0]
];

// BATTLECRUISER: Forma de arpón, muy alargada, pura agresividad
const BATTLECRUISER_GRID = [
  [0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 3, 3, 1, 1, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 4, 1, 1, 2, 2, 1, 1, 4, 0, 0, 0, 0],
  [0, 0, 4, 4, 1, 1, 2, 2, 8, 8, 2, 1, 1, 4, 0, 0, 0],
  [0, 4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0],
  [4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 3, 3, 4, 0],
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 5, 1, 1, 1, 1, 1, 1, 4],
  [4, 6, 8, 8, 2, 2, 2, 1, 1, 5, 5, 1, 1, 1, 1, 1, 4], // Centro
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 5, 1, 1, 1, 1, 1, 1, 4],
  [4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 3, 3, 4, 0],
  [0, 4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0],
  [0, 0, 4, 4, 1, 1, 2, 2, 8, 8, 2, 1, 1, 4, 0, 0, 0],
  [0, 0, 0, 0, 4, 4, 1, 1, 2, 2, 1, 1, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 3, 3, 1, 1, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0]
];

// BATTLESHIP: Fortaleza masiva en forma de escudo espacial
const BATTLESHIP_GRID = [
  [0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 3, 3, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 1, 1, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 4, 1, 1, 2, 2, 8, 8, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0],
  [0, 4, 6, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0],
  [4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 4, 0],
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 5, 1, 1, 4, 4, 1, 1, 1, 1, 4],
  [4, 6, 8, 8, 2, 2, 2, 1, 1, 5, 5, 1, 1, 4, 4, 1, 1, 1, 4], // Centro
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 5, 1, 1, 4, 4, 1, 1, 1, 1, 4],
  [4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 4, 0],
  [0, 4, 6, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0],
  [0, 0, 4, 1, 1, 2, 2, 8, 8, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0],
  [0, 0, 0, 4, 1, 1, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 3, 3, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

// DREADNOUGHT: Ciudadela colosal con diseño piramidal horizontal
const DREADNOUGHT_GRID = [
  [0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 3, 3, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 1, 1, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 4, 1, 1, 2, 2, 8, 8, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [0, 0, 4, 6, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 0],
  [0, 4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 4, 0, 0],
  [4, 6, 8, 8, 2, 2, 2, 2, 1, 1, 1, 4, 4, 4, 4, 1, 1, 1, 1, 4, 0],
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 5, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 4],
  [4, 6, 8, 8, 2, 2, 2, 1, 1, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4], // Centro
  [4, 6, 8, 2, 2, 2, 2, 1, 1, 5, 1, 1, 4, 4, 1, 1, 1, 1, 1, 1, 4],
  [4, 6, 8, 8, 2, 2, 2, 2, 1, 1, 1, 4, 4, 4, 4, 1, 1, 1, 1, 4, 0],
  [0, 4, 6, 8, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 4, 0, 0],
  [0, 0, 4, 6, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0, 0],
  [0, 0, 0, 4, 1, 1, 2, 2, 8, 8, 2, 2, 1, 1, 1, 4, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 4, 1, 1, 2, 2, 1, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 4, 3, 3, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

// ---- Attachments (Corregidos para Simetría y Mejor Posicionamiento) ----

const CORVETTE_ATTACHMENTS: Attachment[] = [
  ...buildAttachments([{ id: "engine_main", x: -5, y: 0, size: "medium" as const }], "engine"),
  ...buildAttachments(
    [
      { id: "mount_front", x: 5, y: 0, minAngle: -Math.PI / 3, maxAngle: Math.PI / 3, turnRate: 0.09, size: "medium" as const },
      { id: "mount_left", x: 0, y: -3, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.09, size: "small" as const }, // Babor
      { id: "mount_right", x: 0, y: 3, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.09, size: "small" as const },  // Estribor
      { id: "pdc_front", x: 2, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.16, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

const DESTROYER_ATTACHMENTS: Attachment[] = [
  ...buildAttachments(
    [
      { id: "engine_left", x: -6, y: -3, size: "medium" as const },
      { id: "engine_right", x: -6, y: 3, size: "medium" as const },
    ],
    "engine"
  ),
  ...buildAttachments(
    [
      { id: "mount_front", x: 6, y: 0, minAngle: -Math.PI / 3, maxAngle: Math.PI / 3, turnRate: 0.07, size: "large" as const },
      { id: "mount_left", x: -1, y: -4, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.07, size: "medium" as const },
      { id: "mount_right", x: -1, y: 4, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.07, size: "medium" as const },
      { id: "pdc_rear", x: -2, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.14, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

const MISSILE_FRIGATE_ATTACHMENTS: Attachment[] = [
  ...buildAttachments(
    [
      { id: "engine_main", x: -6, y: 0, size: "medium" as const },
      { id: "engine_port", x: -5, y: -4, size: "small" as const },
      { id: "engine_starboard", x: -5, y: 4, size: "small" as const },
    ],
    "engine"
  ),
  ...buildAttachments(
    [
      { id: "mount_front", x: 6, y: 0, minAngle: -Math.PI / 4, maxAngle: Math.PI / 4, turnRate: 0.06, size: "large" as const },
      { id: "mount_left", x: 0, y: -4, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.06, size: "medium" as const },
      { id: "mount_right", x: 0, y: 4, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.06, size: "medium" as const },
      { id: "pdc_rear", x: -2, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.14, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

const CRUISER_ATTACHMENTS: Attachment[] = [
  ...buildAttachments(
    [
      { id: "engine_left", x: -6, y: -3, size: "medium" as const },
      { id: "engine_right", x: -6, y: 3, size: "medium" as const },
    ],
    "engine"
  ),
  ...buildAttachments(
    [
      { id: "mount_front", x: 6, y: 0, minAngle: -Math.PI / 3, maxAngle: Math.PI / 3, turnRate: 0.06, size: "large" as const },
      { id: "mount_left", x: -1, y: -5, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.06, size: "medium" as const },
      { id: "mount_right", x: -1, y: 5, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.06, size: "medium" as const },
      { id: "pdc_rear", x: -3, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.14, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

const BATTLECRUISER_ATTACHMENTS: Attachment[] = [
  ...buildAttachments(
    [
      { id: "engine_left", x: -7, y: -3, size: "medium" as const },
      { id: "engine_right", x: -7, y: 3, size: "medium" as const },
    ],
    "engine"
  ),
  ...buildAttachments(
    [
      { id: "mount_front", x: 7, y: 0, minAngle: -Math.PI / 3, maxAngle: Math.PI / 3, turnRate: 0.05, size: "large" as const },
      { id: "mount_left", x: -2, y: -6, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.05, size: "large" as const },
      { id: "mount_right", x: -2, y: 6, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.05, size: "large" as const },
      { id: "pdc_rear", x: -3, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.12, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

const BATTLESHIP_ATTACHMENTS: Attachment[] = [
  ...buildAttachments(
    [
      { id: "engine_main", x: -8, y: 0, size: "large" as const },
      { id: "engine_left", x: -7, y: -4, size: "medium" as const },
      { id: "engine_right", x: -7, y: 4, size: "medium" as const },
    ],
    "engine"
  ),
  ...buildAttachments(
    [
      { id: "mount_front", x: 8, y: 0, minAngle: -Math.PI / 3, maxAngle: Math.PI / 3, turnRate: 0.045, size: "large" as const },
      { id: "mount_left", x: -3, y: -7, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.045, size: "large" as const },
      { id: "mount_right", x: -3, y: 7, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.045, size: "large" as const },
      { id: "pdc_rear", x: -4, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.11, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

const DREADNOUGHT_ATTACHMENTS: Attachment[] = [
  ...buildAttachments(
    [
      { id: "engine_main", x: -9, y: 0, size: "large" as const },
      { id: "engine_left", x: -8, y: -5, size: "medium" as const },
      { id: "engine_right", x: -8, y: 5, size: "medium" as const },
    ],
    "engine"
  ),
  ...buildAttachments(
    [
      { id: "mount_front", x: 9, y: 0, minAngle: -Math.PI / 3, maxAngle: Math.PI / 3, turnRate: 0.04, size: "large" as const },
      { id: "mount_left", x: -4, y: -8, minAngle: -5 * Math.PI / 6, maxAngle: -Math.PI / 6, turnRate: 0.04, size: "large" as const },
      { id: "mount_right", x: -4, y: 8, minAngle: Math.PI / 6, maxAngle: 5 * Math.PI / 6, turnRate: 0.04, size: "large" as const },
      { id: "pdc_rear", x: -4, y: 0, minAngle: -Math.PI, maxAngle: Math.PI, turnRate: 0.10, size: "small" as const },
    ],
    "weapon_mount"
  ),
];

// ---- Paletas Sci-Fi Premium (Cero Rojo o Amarillo) ----

const PAL_CORVETTE = Object.freeze({ // Cobalto y Cyan
  1: "#1a202c", 2: "#718096", 3: "#a0aec0", 4: "#0f131a",
  5: "#00e5ff", 6: "#2b6cb0", 7: "#edf2f7", 8: "#38b2ac"
});

const PAL_DESTROYER = Object.freeze({ // Gunmetal y Esmeralda
  1: "#2d3748", 2: "#4a5568", 3: "#2b6cb0", 4: "#1a202c",
  5: "#48bb78", 6: "#276749", 7: "#e2e8f0", 8: "#68d391"
});

const PAL_FRIGATE = Object.freeze({ // Amatista y Menta
  1: "#322659", 2: "#4c51bf", 3: "#805ad5", 4: "#1a202c",
  5: "#81e6d9", 6: "#285e61", 7: "#e9d8fd", 8: "#4fd1c5"
});

const PAL_CRUISER = Object.freeze({ // Blanco Marfil y Zafiro
  1: "#cbd5e0", 2: "#edf2f7", 3: "#3182ce", 4: "#4a5568",
  5: "#90cdf4", 6: "#2a4365", 7: "#ffffff", 8: "#63b3ed"
});

const PAL_BATTLECRUISER = Object.freeze({ // Obsidiana y Magenta Neón
  1: "#171923", 2: "#2d3748", 3: "#4a5568", 4: "#000000",
  5: "#ed64a6", 6: "#702459", 7: "#e2e8f0", 8: "#f687b3"
});

const PAL_BATTLESHIP = Object.freeze({ // Gris Naval e Hielo
  1: "#2c5282", 2: "#2b6cb0", 3: "#718096", 4: "#1a365d",
  5: "#e6fffa", 6: "#234e52", 7: "#bee3f8", 8: "#81e6d9"
});

const PAL_DREADNOUGHT = Object.freeze({ // Vacío y Violeta Eléctrico
  1: "#210f36", 2: "#44337a", 3: "#a0aec0", 4: "#12091c",
  5: "#b794f4", 6: "#322659", 7: "#e9d8fd", 8: "#9f7aea"
});

// ---- Explosion configs (Coincidiendo con los colores Neon) ----
const EXPL_CORVETTE: ExplosionConfig = { primaryColors: ["#00e5ff", "#38b2ac", "#ffffff"], primaryCount: 16, primarySize: 4, scale: 1.0, shakeIntensity: 0, shakeDuration: 0, screenShakeRadius: 160 };
const EXPL_DESTROYER: ExplosionConfig = { primaryColors: ["#48bb78", "#68d391", "#ffffff", "#276749"], primaryCount: 20, primarySize: 5, scale: 1.1, shakeIntensity: 0.1, shakeDuration: 30, screenShakeRadius: 190 };
const EXPL_FRIGATE: ExplosionConfig = { primaryColors: ["#81e6d9", "#4fd1c5", "#ffffff", "#805ad5"], primaryCount: 22, primarySize: 5, scale: 1.15, shakeIntensity: 0.2, shakeDuration: 45, screenShakeRadius: 210 };
const EXPL_CRUISER: ExplosionConfig = { primaryColors: ["#63b3ed", "#3182ce", "#ffffff", "#90cdf4"], primaryCount: 24, primarySize: 5, scale: 1.25, shakeIntensity: 0.35, shakeDuration: 60, screenShakeRadius: 240 };
const EXPL_BATTLECRUISER: ExplosionConfig = { primaryColors: ["#f687b3", "#ed64a6", "#ffffff", "#702459"], primaryCount: 28, primarySize: 6, scale: 1.45, shakeIntensity: 0.6, shakeDuration: 90, screenShakeRadius: 300 };
const EXPL_BATTLESHIP: ExplosionConfig = { primaryColors: ["#81e6d9", "#bee3f8", "#ffffff", "#2b6cb0"], primaryCount: 34, primarySize: 7, scale: 1.75, shakeIntensity: 1.0, shakeDuration: 140, screenShakeRadius: 380 };
const EXPL_DREADNOUGHT: ExplosionConfig = { primaryColors: ["#9f7aea", "#b794f4", "#ffffff", "#44337a"], primaryCount: 42, primarySize: 8, scale: 2.3, shakeIntensity: 1.6, shakeDuration: 220, screenShakeRadius: 520 };

// ---- Visual Definitions ----
const CORVETTE_VIS = new ShipVisualDef(CORVETTE_GRID, PAL_CORVETTE, "#00e5ff", EXPL_CORVETTE, CORVETTE_ATTACHMENTS);
const DESTROYER_VIS = new ShipVisualDef(DESTROYER_GRID, PAL_DESTROYER, "#48bb78", EXPL_DESTROYER, DESTROYER_ATTACHMENTS);
const FRIGATE_VIS = new ShipVisualDef(MISSILE_FRIGATE_GRID, PAL_FRIGATE, "#81e6d9", EXPL_FRIGATE, MISSILE_FRIGATE_ATTACHMENTS);
const CRUISER_VIS = new ShipVisualDef(CRUISER_GRID, PAL_CRUISER, "#63b3ed", EXPL_CRUISER, CRUISER_ATTACHMENTS);
const BATTLECRUISER_VIS = new ShipVisualDef(BATTLECRUISER_GRID, PAL_BATTLECRUISER, "#f687b3", EXPL_BATTLECRUISER, BATTLECRUISER_ATTACHMENTS);
const BATTLESHIP_VIS = new ShipVisualDef(BATTLESHIP_GRID, PAL_BATTLESHIP, "#81e6d9", EXPL_BATTLESHIP, BATTLESHIP_ATTACHMENTS);
const DREADNOUGHT_VIS = new ShipVisualDef(DREADNOUGHT_GRID, PAL_DREADNOUGHT, "#9f7aea", EXPL_DREADNOUGHT, DREADNOUGHT_ATTACHMENTS);

// ---- Data Definitions ----
const PHYS: Record<string, ShipConfig> = {
  corvette: { mass: 1.0, maxLinearSpeed: 140, maxReverseSpeed: 60, maxAngularSpeed: 4.8, thrustAccel: 180, reverseAccel: 100, strafeAccel: 160, turnAccel: 9.0, linearDrag: 1.5, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.03 },
  destroyer: { mass: 1.6, maxLinearSpeed: 100, maxReverseSpeed: 45, maxAngularSpeed: 3.5, thrustAccel: 120, reverseAccel: 75, strafeAccel: 100, turnAccel: 6.5, linearDrag: 1.4, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.04 },
  missile_frigate: { mass: 1.45, maxLinearSpeed: 80, maxReverseSpeed: 36, maxAngularSpeed: 2.8, thrustAccel: 90, reverseAccel: 56, strafeAccel: 70, turnAccel: 5.0, linearDrag: 1.3, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.05 },
  cruiser: { mass: 2.3, maxLinearSpeed: 65, maxReverseSpeed: 28, maxAngularSpeed: 2.2, thrustAccel: 70, reverseAccel: 42, strafeAccel: 55, turnAccel: 4.0, linearDrag: 1.2, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.07 },
  battlecruiser: { mass: 2.8, maxLinearSpeed: 52, maxReverseSpeed: 22, maxAngularSpeed: 1.7, thrustAccel: 54, reverseAccel: 32, strafeAccel: 40, turnAccel: 3.0, linearDrag: 1.1, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.09 },
  battleship: { mass: 3.4, maxLinearSpeed: 40, maxReverseSpeed: 16, maxAngularSpeed: 1.3, thrustAccel: 40, reverseAccel: 24, strafeAccel: 30, turnAccel: 2.3, linearDrag: 1.0, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.12 },
  dreadnought: { mass: 4.6, maxLinearSpeed: 30, maxReverseSpeed: 12, maxAngularSpeed: 1.0, thrustAccel: 28, reverseAccel: 18, strafeAccel: 20, turnAccel: 1.8, linearDrag: 0.9, angularDrag: 1.8, stopEpsilon: 0.02, inputSmoothing: 0.15 },
};

// ---- Ahora reducidos y simétricos (Una arma primaria, y las laterales idénticas) ----
const STATS: Record<string, ShipGameplayStats> = {
  corvette: { label: "Scout Corvette", role: "Fast screen ship", maxHp: 5, shieldMax: 2, armorMax: 1, heatCoolRate: 0.65, boostRegenRate: 0.42, shieldRegenDelay: 120, shieldRegenInterval: 140, weaponSlots: ["naval_cannon", "autocannon"], score: 120, idealRange: 250 },
  destroyer: { label: "Destroyer", role: "Line combatant", maxHp: 8, shieldMax: 1, armorMax: 3, heatCoolRate: 0.55, boostRegenRate: 0.38, shieldRegenDelay: 150, shieldRegenInterval: 190, weaponSlots: ["naval_cannon", "torpedo"], score: 260, idealRange: 330 },
  missile_frigate: { label: "Missile Frigate", role: "Standoff pressure", maxHp: 7, shieldMax: 1, armorMax: 2, heatCoolRate: 0.58, boostRegenRate: 0.40, shieldRegenDelay: 140, shieldRegenInterval: 170, weaponSlots: ["guided_missile", "emp_launcher"], score: 320, idealRange: 410 },
  cruiser: { label: "Cruiser", role: "Area control", maxHp: 11, shieldMax: 2, armorMax: 4, heatCoolRate: 0.48, boostRegenRate: 0.35, shieldRegenDelay: 180, shieldRegenInterval: 220, weaponSlots: ["plasma_broadside", "naval_cannon"], score: 520, idealRange: 430 },
  battlecruiser: { label: "Battlecruiser", role: "Heavy pursuit", maxHp: 14, shieldMax: 2, armorMax: 5, heatCoolRate: 0.45, boostRegenRate: 0.32, shieldRegenDelay: 200, shieldRegenInterval: 240, weaponSlots: ["railgun", "guided_missile"], score: 700, idealRange: 480 },
  battleship: { label: "Battleship", role: "Dominant artillery", maxHp: 18, shieldMax: 2, armorMax: 7, heatCoolRate: 0.40, boostRegenRate: 0.30, shieldRegenDelay: 220, shieldRegenInterval: 280, weaponSlots: ["naval_cannon", "plasma_broadside"], score: 900, idealRange: 520 },
  dreadnought: { label: "Dreadnought", role: "Fleet anchor", maxHp: 26, shieldMax: 3, armorMax: 10, heatCoolRate: 0.35, boostRegenRate: 0.25, shieldRegenDelay: 250, shieldRegenInterval: 320, weaponSlots: ["railgun", "plasma_broadside"], score: 2000, idealRange: 580 },
};

// ---- Asignaciones de Loadouts Simétricas (babor y estribor llevan la misma arma) ----
const LOADOUTS: Record<string, Record<string, WeaponKind>> = {
  corvette: { mount_front: "naval_cannon", mount_left: "autocannon", mount_right: "autocannon", pdc_front: "point_defense" },
  destroyer: { mount_front: "naval_cannon", mount_left: "torpedo", mount_right: "torpedo", pdc_rear: "point_defense" },
  missile_frigate: { mount_front: "guided_missile", mount_left: "emp_launcher", mount_right: "emp_launcher", pdc_rear: "point_defense" },
  cruiser: { mount_front: "plasma_broadside", mount_left: "naval_cannon", mount_right: "naval_cannon", pdc_rear: "point_defense" },
  battlecruiser: { mount_front: "railgun", mount_left: "guided_missile", mount_right: "guided_missile", pdc_rear: "point_defense" },
  battleship: { mount_front: "naval_cannon", mount_left: "plasma_broadside", mount_right: "plasma_broadside", pdc_rear: "point_defense" },
  dreadnought: { mount_front: "railgun", mount_left: "plasma_broadside", mount_right: "plasma_broadside", pdc_rear: "point_defense" },
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

const NEAR_AUDIO: Record<string, number> = {
  corvette: 0,
  destroyer: 0,
  missile_frigate: 0,
  cruiser: 0,
  battlecruiser: 0,
  battleship: 0,
  dreadnought: 150,
};

function buildShipClassDef(id: string, visual: ShipVisualDef): ShipClassDef {
  return {
    physics: PHYS[id]!,
    stats: STATS[id]!,
    ai: AI_DATA[id]!,
    nearAudioDistance: NEAR_AUDIO[id]!,
    defaultLoadout: LOADOUTS[id]!,
    visual,
  };
}

export const SHIP_CLASSES: Record<string, ShipClassDef> = {
  corvette: buildShipClassDef("corvette", CORVETTE_VIS),
  destroyer: buildShipClassDef("destroyer", DESTROYER_VIS),
  missile_frigate: buildShipClassDef("missile_frigate", FRIGATE_VIS),
  cruiser: buildShipClassDef("cruiser", CRUISER_VIS),
  battlecruiser: buildShipClassDef("battlecruiser", BATTLECRUISER_VIS),
  battleship: buildShipClassDef("battleship", BATTLESHIP_VIS),
  dreadnought: buildShipClassDef("dreadnought", DREADNOUGHT_VIS),
};