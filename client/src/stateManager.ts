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
 * BUGFIX: When a bullet first appears, extrapolate backwards using its velocity
 * so it starts near the spawn point (turret), not at the server's current position.
 * This prevents the "hyperacceleration" visual glitch where bullets seemed to teleport.
 */
let _lastFrameTime = 0;

export function extrapolateBullets(serverBullets: Record<string, any>, lastTickTime: number): void {
    const now = performance.now();
    // SO: Usar frame delta (no tick age) para velocidad constante entre frames
    // R: https://stackoverflow.com/questions/22128680/client-side-extrapolation-jitter
    //    dt = tick age → f sube y baja con cada tick = tirones.
    //    frameDt = tiempo entre frames → velocidad CONSTANTE = fluido.
    const frameDt = _lastFrameTime === 0 ? 0 : Math.min((now - _lastFrameTime) / 1000, 0.05);
    _lastFrameTime = now;

    // Tick age solo para la corrección (alpha), no para la velocidad
    const tickAge = Math.min((now - lastTickTime) / 1000, 0.1);
    const alpha = Math.min(0.25, 1 - Math.pow(1 - 0.6, tickAge * 60));

    for (const id in serverBullets) {
        const b = serverBullets[id];

        if (!renderBullets[id]) {
            // BUGFIX: Bullets appear at server position which is already mid-flight.
            // Estimate the visual spawn point by stepping backwards ~3 ticks worth of velocity.
            // This makes bullets appear to originate from the ship's turret, not mid-air.
            // Exception: guided missiles and torpedoes change direction each tick, so
            // backwards extrapolation would place them at the wrong position. Skip for them.
            const vx = b.vx ?? 0;
            const vy = b.vy ?? 0;
            const isGuided = b.guidance === "guided";
            const BACK_STEPS = isGuided ? 0 : 3;
            renderBullets[id] = {
                ...b,
                x: b.x - vx * BACK_STEPS,
                y: b.y - vy * BACK_STEPS,
            };
        } else {
            const r = renderBullets[id];
            // Convert per-frame velocity to per-tick, combine with snap correction
            // https://stackoverflow.com/questions/66782355/client-side-extrapolation
            const f = frameDt * (1000 / 33);
            r.x += (b.vx ?? 0) * f + (b.x - r.x) * alpha;
            r.y += (b.vy ?? 0) * f + (b.y - r.y) * alpha;
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