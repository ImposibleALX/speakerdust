// ─────────────────────────────────────────────────────────────────────────────
//  admin.ts
//  Admin command handling.
//
//  ADMIN_KEY is read from env.ADMIN_KEY (Cloudflare secret) — never from source.
//  Set it with: wrangler secret put ADMIN_KEY
// ─────────────────────────────────────────────────────────────────────────────
import {
  GameState,
} from "../../core/state";
import type { Env } from "../../infrastructure/env";
import type { PlayerShip, EnemyShip } from "../../core/ships/shipTypes";
import { resetPlayerFull } from "../physics/playerSystem";
import { spawnWave } from "../ai/enemySystem";
import type { ParsedMessage } from "../../infrastructure/network/network";

// ── Admin effect (returned to orchestrator for broadcasting) ──────────────────
export type AdminEffect =
  | { kind: "authed";       ok: boolean }
  | { kind: "reset_all" }
  | { kind: "kick";         playerId: string }
  | { kind: "set_wave";     wave: number }
  | { kind: "clear_enemies" }
  | { kind: "godmode";      active: boolean }
  | { kind: "heal_all" }
  | { kind: "none" };

// ── Main handler ──────────────────────────────────────────────────────────────
/**
 * Handle an admin command message.
 * Mutates state directly; returns an AdminEffect describing what to broadcast.
 *
 * @param msg     Validated ParsedMessage from the WebSocket
 * @param player  The player who sent the message
 * @param state   The full game state (mutated in place)
 * @param env     Worker environment (for ADMIN_KEY)
 */
export function handleAdmin(
  msg:    ParsedMessage,
  player: PlayerShip,
  state:  GameState,
  env:    Env,
): AdminEffect {
  switch (msg.type) {
    case "admin_auth": {
      // Key comes from env secret, never from source code
      const ok = typeof msg.key === "string" && msg.key === env.ADMIN_KEY;
      if (ok) player.isAdmin = true;
      return { kind: "authed", ok };
    }

    case "admin_reset_all": {
      if (!player.isAdmin) return { kind: "none" };
      for (const ship of Object.values(state.ships)) {
        if (ship.controller !== "player") continue;
        const p = ship as PlayerShip;
        // Full reset: position, velocity, weapons, health, inputs, score
        resetPlayerFull(p);
      }
      return { kind: "reset_all" };
    }

    case "admin_kick": {
      if (!player.isAdmin) return { kind: "none" };
      const targetId = msg.targetId as string | undefined;
      if (!targetId || !state.ships[targetId]) return { kind: "none" };
      delete state.ships[targetId];
      return { kind: "kick", playerId: targetId };
    }

    case "admin_set_wave": {
      if (!player.isAdmin) return { kind: "none" };
      const wave = Math.max(1, Math.floor(Number(msg.wave) || 1));
      state.wave = wave;
      // Remove all existing AI ships
      for (const [id, ship] of Object.entries(state.ships)) {
        if (ship.controller === "ai") delete state.ships[id];
      }
      // Spawn fresh wave
      for (const enemy of spawnWave(wave)) {
        state.ships[enemy.id] = enemy;
      }
      return { kind: "set_wave", wave };
    }

    case "admin_clear_enemies": {
      if (!player.isAdmin) return { kind: "none" };
      for (const [id, ship] of Object.entries(state.ships)) {
        if (ship.controller === "ai") delete state.ships[id];
      }
      return { kind: "clear_enemies" };
    }

    case "admin_godmode": {
      if (!player.isAdmin) return { kind: "none" };
      player.godmode = !player.godmode;
      return { kind: "godmode", active: player.godmode };
    }

    case "admin_heal_all": {
      if (!player.isAdmin) return { kind: "none" };
      for (const ship of Object.values(state.ships)) {
        if (ship.controller !== "player") continue;
        const p = ship as PlayerShip;
        if (!p.alive) continue;
        p.hp = p.maxHp;
        p.shield = p.shieldMax;
        p.armor = p.armorMax;
        p.shieldRegenDelay = 0;
        p.boostEnergy = 100;
        p.weaponHeat = 0;
      }
      return { kind: "heal_all" };
    }

    default:
      return { kind: "none" };
  }
}
