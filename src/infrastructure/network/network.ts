// ─────────────────────────────────────────────────────────────────────────────
//  network.ts
//  WebSocket helpers: message validation, payload builders, broadcast,
//  per-socket rate limiting.
// ─────────────────────────────────────────────────────────────────────────────
import {
  GameState,
  toPublicShip, toPublicZone,
} from "../../core/state";
import type { Projectile } from "../../core/combat/projectiles";
import type { Ship } from "../../core/ships/shipTypes";
import { TICK_MS } from "../../core/world/mapConfig";

export { validateMessage } from "./validator";
export type { ParsedMessage } from "./validator";

// ── Payload builders ──────────────────────────────────────────────────────────
/**
 * Build the init payload sent to a player when they connect.
 * Uses the SAME canonical serializers as buildTickPayload — no format mismatch.
 */
export function buildInitPayload(
  playerId: string,
  state: GameState,
): object {
  const ships = buildPublicShips(state);
  const bullets = buildPublicBullets(state);
  const zones = buildPublicZones(state);
  return {
    type: "init",
    playerId,
    team: state.ships[playerId]?.team,
    worldW: 1200,
    worldH: 800,
    wave: state.wave,
    tick: state.tick,
    ships,
    // Split for backward-compat with existing clients
    players: ships.players,
    enemies: ships.enemies,
    bullets: bullets.playerBullets,
    enemyBullets: bullets.enemyBullets,
    zones,
  };
}

/** Build the tick payload broadcast every TICK_MS. */
export function buildTickPayload(state: GameState): object {
  const ships = buildPublicShips(state);
  const bullets = buildPublicBullets(state);
  const zones = buildPublicZones(state);
  return {
    type: "tick",
    tick: state.tick,
    wave: state.wave,
    ships,
    // Split for backward-compat with existing clients
    players: ships.players,
    enemies: ships.enemies,
    bullets: bullets.playerBullets,
    enemyBullets: bullets.enemyBullets,
    zones,
  };
}

function buildPublicShips(state: GameState) {
  const players: Record<string, ReturnType<typeof toPublicShip>> = {};
  const enemies: Record<string, ReturnType<typeof toPublicShip>> = {};
  for (const [id, ship] of Object.entries(state.ships)) {
    const pub = toPublicShip(ship);
    if (ship.controller === "player") players[id] = pub;
    else enemies[id] = pub;
  }
  return { players, enemies };
}

function buildPublicBullets(state: GameState) {
  const playerBullets: Record<string, ReturnType<Projectile["toPublic"]>> = {};
  const enemyBullets: Record<string, ReturnType<Projectile["toPublic"]>> = {};
  for (const [id, p] of Object.entries(state.projectiles)) {
    const pub = p.toPublic();
    if (p.ownerController === "player") playerBullets[id] = pub;
    else enemyBullets[id] = pub;
  }
  return { playerBullets, enemyBullets };
}

function buildPublicZones(state: GameState) {
  const zones: Record<string, ReturnType<typeof toPublicZone>> = {};
  for (const [id, z] of Object.entries(state.zones)) zones[id] = toPublicZone(z);
  return zones;
}

// ── Broadcast ─────────────────────────────────────────────────────────────────
/**
 * Send a message to all connected sockets.
 * Skips sockets that are already CLOSING or CLOSED before attempting send,
 * reducing wasted serialization and silent errors from dead connections.
 */
export function broadcast(sockets: WebSocket[], msg: object): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    // WebSocket.CLOSING = 2, WebSocket.CLOSED = 3
    if (ws.readyState >= 2) continue;
    try { ws.send(data); } catch { /* socket will be cleaned up by the runtime */ }
  }
}

// ── Per-socket rate limiter ───────────────────────────────────────────────────
const RATE_LIMIT_MOVE_MS = 16;   // max 1 move event per 16 ms (~60 fps)
const RATE_LIMIT_SHOOT_MS = TICK_MS;
const RATE_LIMIT_BOOST_MS = 100;

export interface RateLimitState {
  lastMoveMs: number;
  lastShootMs: number;
  lastBoostMs: number;
}

/**
 * WeakMap so rate-limit state is automatically GC'd when a socket is closed.
 * Keyed on the WebSocket object itself (stable per connection in Durable Objects).
 */
export const rateLimits = new WeakMap<WebSocket, RateLimitState>();

export function getRateLimit(ws: WebSocket): RateLimitState {
  let s = rateLimits.get(ws);
  if (!s) {
    s = { lastMoveMs: 0, lastShootMs: 0, lastBoostMs: 0 };
    rateLimits.set(ws, s);
  }
  return s;
}

export function checkMoveRate(ws: WebSocket): boolean {
  const s = getRateLimit(ws);
  const now = Date.now();
  if (now - s.lastMoveMs < RATE_LIMIT_MOVE_MS) return false;
  s.lastMoveMs = now;
  return true;
}

export function checkShootRate(ws: WebSocket): boolean {
  const s = getRateLimit(ws);
  const now = Date.now();
  if (now - s.lastShootMs < RATE_LIMIT_SHOOT_MS) return false;
  s.lastShootMs = now;
  return true;
}

export function checkBoostRate(ws: WebSocket): boolean {
  const s = getRateLimit(ws);
  const now = Date.now();
  if (now - s.lastBoostMs < RATE_LIMIT_BOOST_MS) return false;
  s.lastBoostMs = now;
  return true;
}
