export interface Vec2 {
  x: number;
  y: number;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function distSq(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function shortestAngleDelta(from: number, to: number): number {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
