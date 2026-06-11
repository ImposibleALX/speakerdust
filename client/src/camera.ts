export let cameraX = 0, cameraY = 0;
export function setCameraPosition(x: number, y: number): void { cameraX = x; cameraY = y; }
export function offsetCamera(dx: number, dy: number): void { cameraX += dx; cameraY += dy; }

let shakeStrength = 0;
let shakeUntil = 0;
let lastShakeBurstAt = 0;

export function addScreenShake(intensity: number, durationMs: number): void {
    const now = performance.now();
    if (now - lastShakeBurstAt < 80) return;
    lastShakeBurstAt = now;
    shakeStrength = Math.min(2.2, Math.max(shakeStrength, intensity));
    shakeUntil = Math.max(shakeUntil, now + durationMs);
}

export let shakeX = 0, shakeY = 0;

export function updateScreenShake(now: number): void {
    if (now >= shakeUntil) {
        shakeStrength = 0;
        shakeX = 0; shakeY = 0;
        return;
    }
    const t = 1 - Math.max(0, Math.min(1, (shakeUntil - now) / 220));
    const amp = shakeStrength * (1 - t);
    shakeX = Math.sin(now * 0.05) * amp * 6;
    shakeY = Math.cos(now * 0.043) * amp * 6;
}
