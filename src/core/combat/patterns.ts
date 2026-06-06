import { shortestAngleDelta } from "../math";

export type WeaponArc = "forward" | "broadside" | "omni";

export function isAngleInArc(shipAngle: number, targetAngle: number, arc: WeaponArc): boolean {
  if (arc === "omni") return true;
  const delta = Math.abs(shortestAngleDelta(shipAngle, targetAngle));
  if (arc === "forward") return delta < Math.PI / 3;
  if (arc === "broadside") {
    const port = Math.abs(shortestAngleDelta(shipAngle - Math.PI / 2, targetAngle));
    const starboard = Math.abs(shortestAngleDelta(shipAngle + Math.PI / 2, targetAngle));
    return port < Math.PI / 3 || starboard < Math.PI / 3;
  }
  return true;
}
