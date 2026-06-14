export let cameraX = 0, cameraY = 0;
export let shakeX = 0, shakeY = 0;

export function setCameraPosition(x: number, y: number): void {
    cameraX = x;
    cameraY = y;
}

export function offsetCamera(dx: number, dy: number): void {
    cameraX += dx;
    cameraY += dy;
}

// ─── SISTEMA DE TRAUMA (Hiperoptimizado) ───
let trauma = 0;
let traumaDecay = 0.002;
let lastUpdateMs = performance.now();

// Puedes subir esto si quieres que los impactos máximos muevan la cámara más píxeles
const MAX_SHAKE_OFFSET = 18;

export function addScreenShake(intensity: number, durationMs: number = 300): void {
    const now = performance.now();

    // Antispam: Si ya hay muchísimo trauma, ignoramos sacudidas menores en el mismo ms
    if (now - lastUpdateMs < 16 && trauma > 0.8) return;

    // Normalizamos la intensidad (tu código antiguo llegaba a 2.2). 
    // Sumamos el trauma en lugar de reemplazarlo, así las ráfagas se sienten más fuertes.
    const normalizedIntensity = intensity / 2.2;
    trauma = Math.min(1.0, trauma + normalizedIntensity);

    // Calculamos qué tan rápido debe sanar el trauma basado en la duración solicitada
    traumaDecay = 1 / Math.max(50, durationMs);
}

export function updateScreenShake(now: number): void {
    // Calculamos el delta de tiempo (dt) de forma segura.
    // Límite máximo de 50ms para evitar que la cámara "salte" agresivamente 
    // si el jugador cambia de pestaña y vuelve.
    const dt = Math.min(now - lastUpdateMs, 50);
    lastUpdateMs = now;

    // Si no hay trauma, aseguramos que la sacudida esté en 0 y abortamos temprano (O(1) fast path)
    if (trauma <= 0) {
        if (shakeX !== 0 || shakeY !== 0) {
            shakeX = 0;
            shakeY = 0;
        }
        return;
    }

    // Decadencia lineal del trauma
    trauma = Math.max(0, trauma - traumaDecay * dt);

    // LA MAGIA: Elevar al cubo crea el impacto seco inicial ("Game Feel" avanzado)
    const power = trauma * trauma * trauma;

    // SÍNTESIS FM (Frecuencia Modulada) para Caos Orgánico.
    // En lugar de costosas funciones de Ruido Aleatorio (Noise), usamos fases 
    // trigonométricas distorsionadas por otros ángulos.
    // Esto crea un movimiento extremadamente violento, errático y realista 
    // con apenas 4 llamadas matemáticas súper rápidas.
    const t = now * 0.015; // Velocidad del temblor

    shakeX = MAX_SHAKE_OFFSET * power * Math.sin(t * 5.1 + Math.cos(t * 3.3));
    shakeY = MAX_SHAKE_OFFSET * power * Math.cos(t * 5.8 + Math.sin(t * 2.9));
}