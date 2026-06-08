export interface Vec2 {
  x: number;
  y: number;
}

/** Genera un UUID v4 criptográficamente seguro */
export function uuid(): string {
  return crypto.randomUUID();
}

/** Número aleatorio en [min, max) */
export function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Distancia euclidiana al cuadrado (evita Math.sqrt) */
export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Restringe v al intervalo [lo, hi] */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Diferencia angular más corta en radianes */
export function shortestAngleDelta(from: number, to: number): number {
  const PI2 = Math.PI * 2;
  let d = ((to - from + Math.PI) % PI2) - Math.PI;
  if (d < -Math.PI) d += PI2;
  return d;
}

// ─── Funciones adicionales de alto rendimiento ──────────────────

/** Interpolación lineal sin restricción */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolación lineal entre dos vectores */
export function lerpVec(a: Vec2, b: Vec2, t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** Longitud al cuadrado de un vector (magnitud²) */
export function lenSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

/** Longitud de un vector */
export function len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Normaliza un vector (versión segura, evita división por cero) */
export function normalize(v: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y);
  if (l < 1e-10) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = v.x / l;
  out.y = v.y / l;
  return out;
}

/** Rota un vector en 2D (en radianes) */
export function rotate(v: Vec2, angle: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out.x = v.x * cos - v.y * sin;
  out.y = v.x * sin + v.y * cos;
  return out;
}

/** Producto punto entre dos vectores */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Producto cruz 2D (escalar) */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Ángulo de un vector (en radianes, desde el eje X) */
export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

/** Distancia entre dos puntos (usa sqrt) */
export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Mueve un punto hacia un objetivo con suavizado exponencial (útil para cámaras) */
export function expSmooth(current: number, target: number, smoothFactor: number, dtNormalized: number): number {
  const t = 1 - Math.exp(-smoothFactor * dtNormalized);
  return current + (target - current) * t;
}