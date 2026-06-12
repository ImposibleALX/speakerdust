import type { GameState } from "../../core/state";
import type { Env } from "../../infrastructure/env";
import type { Ship, AiState } from "../../core/ships/shipTypes";
import { spawnWave } from "../ai/enemySystem";
import type { ParsedMessage } from "../../infrastructure/network/network";

export type AdminEffect =
  | { kind: "authed";       ok: boolean }
  | { kind: "reset_all" }
  | { kind: "kick";         playerId: string }
  | { kind: "set_wave";     wave: number; spawns: Array<{ ship: Ship; ai: AiState }> }
  | { kind: "clear_enemies" }
  | { kind: "godmode";      active: boolean }
  | { kind: "heal_all" }
  | { kind: "none" };

export function processAdminCommand(
  msg:    ParsedMessage,
  player: Ship,
  state:  GameState,
  env:    Env,
): AdminEffect {
  switch (msg.type) {
    case "admin_auth": {
      const ok = typeof msg.key === "string" && msg.key === env.ADMIN_KEY;
      if (ok) player.isAdmin = true;
      return { kind: "authed", ok };
    }

    case "admin_reset_all": {
      if (!player.isAdmin) return { kind: "none" };
      for (const ship of Object.values(state.ships)) {
        if (ship.controller !== "player") continue;
        ship.fullReset();
      }
      return { kind: "reset_all" };
    }

    case "admin_kick": {
      if (!player.isAdmin) return { kind: "none" };
      const targetId = msg.targetId as string | undefined;
      if (!targetId || !state.ships[targetId]) return { kind: "none" };
      delete state.ships[targetId];
      delete state.players[targetId];
      return { kind: "kick", playerId: targetId };
    }

    case "admin_set_wave": {
      if (!player.isAdmin) return { kind: "none" };
      const wave = Math.max(1, Math.floor(Number(msg.wave) || 1));
      state.wave = wave;
      for (const [id, ship] of Object.entries(state.ships)) {
        if (ship.controller === "ai") delete state.ships[id];
      }
      const spawns = spawnWave(wave);
      for (const { ship } of spawns) {
        state.ships[ship.id] = ship;
      }
      return { kind: "set_wave", wave, spawns };
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
        if (!ship.alive) continue;
        ship.hp = ship.maxHp;
        ship.shield = ship.shieldMax;
        ship.armor = ship.armorMax;
        ship.shieldRegenDelay = 0;
        ship.boostEnergy = 100;
      }
      return { kind: "heal_all" };
    }

    default:
      return { kind: "none" };
  }
}
