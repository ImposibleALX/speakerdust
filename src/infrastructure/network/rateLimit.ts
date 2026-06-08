const MAX_CONNECTIONS_PER_IP = 3;
const RATE_LIMIT_WINDOW_MS = 60000;

const ipAttempts = new Map<string, number[]>();

export function checkConnectionRate(ip: string): boolean {
  const now = Date.now();
  const window = now - RATE_LIMIT_WINDOW_MS;
  let attempts = ipAttempts.get(ip) ?? [];
  attempts = attempts.filter(t => t > window);
  if (attempts.length >= MAX_CONNECTIONS_PER_IP) {
    ipAttempts.set(ip, attempts);
    return false;
  }
  attempts.push(now);
  ipAttempts.set(ip, attempts);
  return true;
}

export function resetRateLimit(ip: string): void {
  ipAttempts.delete(ip);
}
