import { rand } from "../math";

export const WORLD_W = 1200;
export const WORLD_H = 800;
export const TICK_MS = 33;
export const SAVE_EVERY_TICKS = 30;

export function spawnPos(): { x: number; y: number } {
  const s = Math.floor(Math.random() * 4);
  if (s === 0) return { x: rand(0, WORLD_W), y: -100 };
  if (s === 1) return { x: WORLD_W + 100, y: rand(0, WORLD_H) };
  if (s === 2) return { x: rand(0, WORLD_W), y: WORLD_H + 100 };
  return { x: -100, y: rand(0, WORLD_H) };
}
