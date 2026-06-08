const ALLOWED_ORIGINS_DEFAULT = "http://localhost:5173,http://localhost:8787,https://speakerdust.pages.dev";
const DEV_SECRET = "dev-secret";

export function isOriginAllowed(origin: string, allowedRaw?: string): boolean {
  if (!origin || origin === "*" || origin === "null") return false;
  const allowed = allowedRaw ?? ALLOWED_ORIGINS_DEFAULT;
  return allowed.split(",").map(s => s.trim()).some(a => origin.startsWith(a));
}

export function validateToken(token: string, secret?: string): { name: string; valid: boolean } {
  const useSecret = secret || DEV_SECRET;
  const parts = token.split(":");
  if (parts.length < 3) return { name: "unknown", valid: false };
  const name = parts.slice(0, -2).join(":");
  const timestamp = parts[parts.length - 2]!;
  const sig = parts[parts.length - 1]!;
  const payload = `${name}:${timestamp}`;
  const expected = simpleHmac(payload, useSecret);
  if (sig !== expected) return { name, valid: false };
  const age = Date.now() - Number(timestamp);
  if (isNaN(age) || age > 3600000) return { name, valid: false };
  return { name, valid: true };
}

function simpleHmac(data: string, key: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash ^= key.charCodeAt(i % key.length);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
