export { MountRenderer, type MountContext } from "./MountRenderer";
export { WeaponMountRenderer } from "./WeaponMountRenderer";
export { DynamicWeaponMountRenderer } from "./DynamicWeaponMountRenderer";
export { NoSpriteMountRenderer } from "./NoSpriteMountRenderer";
export { EngineMountRenderer } from "./EngineMountRenderer";

import type { Attachment, WeaponKind } from "@speakerdust/shared";
import { WEAPON_DEFS } from "@speakerdust/shared";
import { MountRenderer } from "./MountRenderer";
import { WeaponMountRenderer } from "./WeaponMountRenderer";
import { DynamicWeaponMountRenderer } from "./DynamicWeaponMountRenderer";
import { NoSpriteMountRenderer } from "./NoSpriteMountRenderer";
import { EngineMountRenderer } from "./EngineMountRenderer";

// SO: Factory method para crear el MountRenderer correcto según el arma/asignación
// R: https://stackoverflow.com/questions/69849/factory-pattern-when-to-use-factory-methods
//    Cada attachment sabe QUÉ es, la fábrica decide CÓMO renderizarlo.
//    Agregar un nuevo tipo de montura = crear una subclase + un case acá.

export function createMountRenderer(
  mount: Attachment,
  loadout?: Record<string, WeaponKind>,
  color?: string,
): MountRenderer {
  if (mount.kind === "engine") {
    return new EngineMountRenderer(mount, color ?? "#ffffff");
  }

  const weaponKind = loadout?.[mount.id];
  if (weaponKind) {
    const def = WEAPON_DEFS[weaponKind];
    if (def) {
      if (def.render.type === "dynamic") {
        return new DynamicWeaponMountRenderer(mount, loadout);
      }
      if (def.hasSprite) {
        return new WeaponMountRenderer(mount, loadout);
      }
    }
  }

  return new NoSpriteMountRenderer(mount, loadout);
}
