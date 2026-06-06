export const SHIP_ATTACHMENTS = Object.freeze({
  player: {
    engine: [{ x: 0, y: 24 }],
    weapons: [{ x: 0, y: -28 }, { x: -22, y: 0 }, { x: 22, y: 0 }],
  },
  scout: {
    engine: [{ x: 0, y: 17 }],
    weapons: [{ x: 0, y: -18 }],
  },
  cruiser: {
    engine: [{ x: -8, y: 24 }, { x: 8, y: 24 }],
    weapons: [{ x: 0, y: -30 }, { x: -28, y: 0 }, { x: 28, y: 0 }],
  },
  capital: {
    engine: [{ x: -14, y: 34 }, { x: 14, y: 34 }],
    weapons: [{ x: 0, y: -42 }, { x: -38, y: -4 }, { x: 38, y: -4 }],
  },
});
