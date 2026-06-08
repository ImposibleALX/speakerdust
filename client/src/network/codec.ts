const DEV_SECRET = "dev-secret";

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

export function generateToken(name: string, secret = DEV_SECRET): string {
  const timestamp = Date.now();
  const payload = `${name}:${timestamp}`;
  const hmac = simpleHmac(payload, secret);
  return `${payload}:${hmac}`;
}

export function pack(data: unknown): string {
  return JSON.stringify(data);
}

export function unpack<T = unknown>(raw: string | ArrayBuffer): T | null {
  try {
    const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}
