// playerSystem.ts
// Player factory utilizing the unified Ship class.

import { Ship } from "../../core/ships/Ship";
import { Player } from "../../core/players/Player";
import type { Team } from "../../core/ships/shipTypes";
import { WORLD_W, WORLD_H } from "../../core/world/mapConfig";
import { DEFAULT_PLAYER_CLASS } from "../../core/ships/shipStats";
import { rand } from "../../core/math";

export function createPlayerWithShip(playerId: string, team: Team): { player: Player, ship: Ship } {
  const player = new Player({ id: playerId, team });
  const ship = new Ship({
    id: playerId,
    controller: "player",
    shipClass: DEFAULT_PLAYER_CLASS,
    x: rand(200, WORLD_W - 200),
    y: rand(200, WORLD_H - 200),
  });

  player.bindShip(ship);
  return { player, ship };
}