const MAX_MESSAGE_BYTES = 10240;

const VALID_MESSAGE_TYPES = new Set([
  "set_team", "respawn", "boost", "move", "switch_weapon", "shoot", "chat", "changeClass",
]);

const VALID_ADMIN_COMMANDS = new Set([
  "admin_auth", "admin_reset_all", "admin_kick", "admin_set_wave", "admin_clear_enemies",
  "admin_godmode", "admin_heal_all", "admin_reset_data",
]);

export interface ParsedMessage {
  type: string;
  [key: string]: unknown;
}

export type ValidatedMessage = ParsedMessage;

export function validateMessage(raw: ArrayBuffer | string): ParsedMessage | null {
  if (raw instanceof ArrayBuffer) {
    if (raw.byteLength > MAX_MESSAGE_BYTES) return null;
  } else if (typeof raw === "string") {
    if (raw.length > MAX_MESSAGE_BYTES) return null;
  } else {
    return null;
  }

  let msg: unknown;
  try {
    const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    msg = JSON.parse(str);
  } catch {
    return null;
  }

  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string") return null;

  if (!VALID_MESSAGE_TYPES.has(m.type) && !VALID_ADMIN_COMMANDS.has(m.type)) return null;

  if (m.type === "move") {
    if (m.forward !== undefined && typeof m.forward !== "number") return null;
    if (m.strafe !== undefined && typeof m.strafe !== "number") return null;
    if (m.angle !== undefined && typeof m.angle !== "number") return null;
  }

  if (m.type === "set_team") {
    if (typeof m.team !== "string") return null;
  }

  if (m.type === "chat") {
    if (typeof m.text !== "string" || m.text.length > 200) return null;
  }

  if (m.type.startsWith("admin_")) {
    if (m.key !== undefined && typeof m.key !== "string") return null;
    if (m.wave !== undefined && typeof m.wave !== "number") return null;
    if (m.targetId !== undefined && typeof m.targetId !== "string") return null;
  }

  return m as ParsedMessage;
}
