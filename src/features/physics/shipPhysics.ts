import { ShipPhysics, ShipConfig, SHIP_CLASSES } from "@speakerdust/shared";
import type { Ship, ShipClass } from "../../core/ships/shipTypes";

export function getShipPhysicsConfig(shipClass: ShipClass): ShipConfig {
  return (SHIP_CLASSES[shipClass] ?? SHIP_CLASSES.corvette!).physics;
}

export function createShipPhysics(shipClass: ShipClass): ShipPhysics {
  return new ShipPhysics(getShipPhysicsConfig(shipClass));
}

export function initShipPhysicsFromShip(physics: ShipPhysics, ship: Ship): void {
  physics.reset(ship.x, ship.y, ship.heading);
  physics.velocity.x = ship.vx;
  physics.velocity.y = ship.vy;
  physics.heading = ship.heading;
  physics.angularVelocity = 0;
}

export function syncShipToPhysics(ship: Ship, physics: ShipPhysics): void {
  const state = physics.getState();
  ship.x = state.x;
  ship.y = state.y;
  ship.vx = state.vx;
  ship.vy = state.vy;
  ship.angle = state.heading;
  ship.heading = state.heading;
  ship.angularVelocity = state.angularVelocity;
}