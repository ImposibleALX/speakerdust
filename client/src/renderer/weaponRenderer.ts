// Eliminado: la lógica suelta de render de armas en monturas fue migrada a:
// - client/src/mounts/WeaponMountRenderer.ts (armas con bitmap)
// - client/src/mounts/DynamicWeaponMountRenderer.ts (armas procedurales)
// - client/src/mounts/NoSpriteMountRenderer.ts (armas sin sprite)
// - client/src/mounts/EngineMountRenderer.ts (motores)
//
// Usá createMountRenderer() desde client/src/mounts/index.ts
