import type { Team, Ship } from "../ships/shipTypes";

export class Player {
  id: string;
  name: string;
  color: string;
  team: Team;
  score: number;
  isAdmin: boolean;
  godmode: boolean;
  inputSeq: number;

  ship: Ship | null = null;

  constructor(config: {
    id: string;
    team: Team;
    name?: string;
    color?: string;
  }) {
    this.id = config.id;
    this.team = config.team;
    this.name = config.name || `CAPT-${config.id.slice(0, 4).toUpperCase()}`;
    const hue = Math.floor(Math.random() * 360);
    this.color = config.color || `hsl(${hue}, 80%, 65%)`;
    this.score = 0;
    this.isAdmin = false;
    this.godmode = false;
    this.inputSeq = 0;
  }

  // Forward inputs directly to the bound ship
  public setInputs(forward: number, strafe: number, turn: number, targetAngle?: number) {
    if (!this.ship) return;
    this.ship.inputForward = forward;
    this.ship.inputStrafe = strafe;
    this.ship.inputTurn = turn;
    if (targetAngle !== undefined) {
      this.ship.targetAngle = targetAngle;
    }
  }

  public bindShip(ship: Ship) {
    this.ship = ship;
    ship.playerId = this.id;
    ship.team = this.team;
    ship.name = this.name;
    ship.color = this.color;
  }
}
