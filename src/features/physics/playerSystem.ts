// playerSystem.ts
// Player factory utilizing the unified Ship class.

import { Ship, Team } from "../../core/ships/shipTypes";
import { WORLD_W, WORLD_H } from "../../core/world/mapConfig";
import { DEFAULT_PLAYER_CLASS } from "../../core/ships/shipStats";
import { rand } from "../../core/math";

export function createPlayer(playerId: string, team: Team): Ship {
  const hue = Math.floor(Math.random() * 360);
  return new Ship({
    id: playerId,
    controller: "player",
    shipClass: DEFAULT_PLAYER_CLASS,
    x: rand(200, WORLD_W - 200),
    y: rand(200, WORLD_H - 200),
    color: `hsl(${hue}, 80%, 65%)`,
    name: `CAPT-${playerId.slice(0, 4).toUpperCase()}`,
    team,
    iFrames: 60,
  });
}