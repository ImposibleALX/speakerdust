import { myId, currentServerTick } from "./gameState";
import { ENTITY_SMOOTH, LOCAL_SMOOTH, ANGLE_SMOOTH } from "./constants";

export let renderPlayers: Record<string, any> = {};
export let renderEnemies: Record<string, any> = {};
export let renderBullets: Record<string, any> = {};

export function lerpAngle(a: number, b: number, amt: number): number {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * amt;
}

/**
 * Sincronización de entidades (Jugadores/Enemigos)
 */
export function syncRenderState(renderMap: Record<string, any>, serverMap: Record<string, any>, dt: number, isAngle = false): void {
    // Calculamos alphas una sola vez por llamada
    const remoteAlpha = 1 - Math.pow(1 - ENTITY_SMOOTH, dt);
    const localAlpha = 1 - Math.pow(1 - LOCAL_SMOOTH, dt);
    const alphaAngle = 1 - Math.pow(1 - ANGLE_SMOOTH, dt);

    for (const id in serverMap) {
        const s = serverMap[id];
        const alpha = id === myId ? localAlpha : remoteAlpha;

        if (!renderMap[id]) {
            // Inicialización limpia: Copia profunda simple para evitar basura
            renderMap[id] = { ...s };
        } else {
            const r = renderMap[id];

            // Interpolación de posición
            r.x += (s.x - r.x) * alpha;
            r.y += (s.y - r.y) * alpha;

            // Interpolación de ángulo
            if (isAngle && s.angle !== undefined) {
                r.angle = lerpAngle(r.angle || 0, s.angle, alphaAngle);
            } else {
                r.angle = s.angle;
            }

            // BUG FIX: Sincronizar TODAS las propiedades necesarias, no solo vida
            r.hp = s.hp;
            r.maxHp = s.maxHp;
            r.shield = s.shield;
            r.score = s.score;
            r.alive = s.alive;
            r.team = s.team;
            r.shipClass = s.shipClass;
            r.name = s.name;   // Antes no se actualizaba
            r.color = s.color; // Antes no se actualizaba
        }
    }

    // Limpieza de entidades muertas/desconectadas
    for (const id in renderMap) {
        if (!serverMap[id]) delete renderMap[id];
    }
}

/**
 * Sincronización de física de naves (heading + angularVelocity)
 * Usa la misma interpolación exponencial que syncRenderState pero para campos de física
 */
export function syncShipPhysics(renderMap: Record<string, any>, serverMap: Record<string, any>, dt: number): void {
    const remoteAlpha = 1 - Math.pow(1 - ENTITY_SMOOTH, dt);
    const localAlpha = 1 - Math.pow(1 - LOCAL_SMOOTH, dt);
    const alphaAngle = 1 - Math.pow(1 - ANGLE_SMOOTH, dt);

    for (const id in serverMap) {
        const s = serverMap[id];
        const alpha = id === myId ? localAlpha : remoteAlpha;

        if (!renderMap[id]) {
            renderMap[id] = { ...s };
        } else {
            const r = renderMap[id];

            // Interpolación de posición
            r.x += (s.x - r.x) * alpha;
            r.y += (s.y - r.y) * alpha;

            // Interpolación de velocidad (para efectos visuales, estelas, etc.)
            r.vx += (s.vx - r.vx) * alpha;
            r.vy += (s.vy - r.vy) * alpha;

            // Interpolación de heading (orientación real de la nave)
            if (s.heading !== undefined) {
                r.heading = lerpAngle(r.heading || 0, s.heading, alphaAngle);
            }

            // Interpolación de velocidad angular
            if (s.angularVelocity !== undefined) {
                r.angularVelocity += (s.angularVelocity - r.angularVelocity) * alpha;
            }

            // Sincronizar otras propiedades
            r.angle = s.angle;
            r.hp = s.hp;
            r.maxHp = s.maxHp;
            r.shield = s.shield;
            r.score = s.score;
            r.alive = s.alive;
            r.team = s.team;
            r.shipClass = s.shipClass;
            r.name = s.name;
            r.color = s.color;
        }
    }

    for (const id in renderMap) {
        if (!serverMap[id]) delete renderMap[id];
    }
}

/**
 * Interpolación de balas autoritativa.
 * Usa suavizado exponencial para converger a la posición del servidor,
 * evitando la extrapolación lineal desde spawn que rompe misiles guiados (torpedo/guided_missile).
 */
export function extrapolateBullets(serverBullets: Record<string, any>, lastTickTime: number): void {
    const dt = Math.min((performance.now() - lastTickTime) / 1000, 0.1);
    const alpha = 1 - Math.pow(1 - 0.6, dt * 60);

    for (const id in serverBullets) {
        const b = serverBullets[id];

        if (!renderBullets[id]) {
            renderBullets[id] = { ...b };
        } else {
            const r = renderBullets[id];
            r.x += (b.x - r.x) * alpha;
            r.y += (b.y - r.y) * alpha;
        }

        const r = renderBullets[id];
        r.angle = b.angle;
        r.kind = b.kind;
        r.vx = b.vx;
        r.vy = b.vy;
    }

    for (const id in renderBullets) {
        if (!serverBullets[id]) {
            delete renderBullets[id];
        }
    }
}