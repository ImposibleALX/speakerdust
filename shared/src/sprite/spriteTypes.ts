export type MountArc = "forward" | "broadside" | "omni";

export interface Attachment {
  readonly id: string;
  readonly kind: "weapon_mount" | "engine" | "turret_base" | "emitter" | "exhaust" | "hardpoint";
  readonly x: number;
  readonly y: number;
  readonly mountArc: MountArc;
  readonly size: "small" | "medium" | "large";
  readonly tags: readonly string[];
}

export interface Sprite {
  readonly pixels: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly attachments: readonly Attachment[];
}

