import { WEAPON_STATS, DEFAULT_LOADOUTS, SHIP_ATTACHMENTS } from "@speakerdust/shared";
import type { WeaponKind } from "@speakerdust/shared";
import { SHIP_BITMAPS } from "./assets/bitmaps";
import { createPixelShipRenderer } from "./renderer/renderer";
import { generateToken } from "./network/codec";

const IS_LOCAL = location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "" ||
    location.protocol === "file:";

const WORKER_WS = IS_LOCAL
    ? "ws://localhost:8787"
    : "wss://speakerdust.soyimposibleyt.workers.dev";
const ROOM_ID = "sala-1";
let userInteracted = false;

const SHIELD_RADIUS = 28;
const PLAYER_TAG_OFFSET = 30;
const INPUT_RATE = 33;
const MAX_PARTICLES = 420;
const SPECTATOR_CAM_SPEED = 8;

const COOLDOWN_TABLE: Record<WeaponKind, number> = {} as Record<WeaponKind, number>;
for (const [kind, stats] of Object.entries(WEAPON_STATS)) {
    COOLDOWN_TABLE[kind as WeaponKind] = stats.cooldown * 33;
}

const QUICK_CHAT = [
    "¡Atacad!", "Defended la base", "Necesito apoyo", "Retirada",
    "¡Bien hecho!", "Cuidado con el flanco", "Esperad mi señal",
    "Voy a por el objetivo", "¡Gran trabajo!",
];

function getCanvas(id: string): HTMLCanvasElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found in DOM`);
    if (!(el instanceof HTMLCanvasElement)) throw new Error(`Element #${id} is not a <canvas>`);
    return el;
}
const canvas = getCanvas("gameCanvas");
const ctx = canvas.getContext("2d")!;
let WORLD_W = 1200, WORLD_H = 800;

const $ = (id: string) => document.getElementById(id);
const hudEl = $("hud")!;
const statusBarEl = $("status-bar")!;
const weaponDisp = $("weapon-display")!;
const shieldDisp = $("shield-display")!;
const scoreDisp = $("score")!;
const waveNumDisp = $("wave-num")!;
const playerCountDisp = $("player-count")!;
const connStatusEl = $("connection-status")!;
const overlay = $("screen-overlay")!;
const overlayScore = $("overlay-score")!;
const restartBtn = $("restart-btn") as HTMLButtonElement;
const hpDisp = $("hp-display")!;
const energyDisp = $("energy-display")!;
const heatDisp = $("heat-display")!;
const objectiveDisp = $("objective-display")!;
const teamBadge = $("team-badge")!;
const adminPanel = $("admin-panel")!;
const adminClose = $("admin-close")!;
const adminAuthForm = $("admin-auth-form") as HTMLFormElement;
const adminKeyInput = $("admin-key-input") as HTMLInputElement;
const adminAuthStatus = $("admin-auth-status")!;
const adminControls = $("admin-controls")!;
const adminResetAllBtn = $("admin-reset-all-btn")!;
const adminClearEnemiesBtn = $("admin-clear-enemies-btn")!;
const adminWaveInput = $("admin-wave-input") as HTMLInputElement;
const adminSetWaveBtn = $("admin-set-wave-btn")!;
const adminJoinRed = $("admin-join-red")!;
const adminJoinBlue = $("admin-join-blue")!;
const adminGodmodeBtn = $("admin-godmode-btn")!;
const adminHealBtn = $("admin-heal-btn")!;
const adminResetDataBtn = $("admin-reset-data-btn")!;
const adminPlayerList = $("admin-player-list")!;

let shakeStrength = 0;
let shakeUntil = 0;
let lastShakeBurstAt = 0;

function addScreenShake(intensity: number, durationMs: number): void {
    const now = performance.now();
    if (now - lastShakeBurstAt < 80) return;
    lastShakeBurstAt = now;
    shakeStrength = Math.min(2.2, Math.max(shakeStrength, intensity));
    shakeUntil = Math.max(shakeUntil, now + durationMs);
}

function getScreenShakeOffset(now: number): { x: number; y: number } {
    if (now >= shakeUntil) {
        shakeStrength = 0;
        return { x: 0, y: 0 };
    }
    const t = 1 - Math.max(0, Math.min(1, (shakeUntil - now) / 220));
    const amp = shakeStrength * (1 - t);
    const s = Math.sin(now * 0.05);
    return { x: s * amp * 6, y: Math.cos(now * 0.043) * amp * 6 };
}

const dmgOverlay = document.createElement("div");
dmgOverlay.id = "damage-overlay";
dmgOverlay.style.cssText = "pointer-events:none;position:fixed;top:0;left:0;width:100%;height:100%;background:radial-gradient(transparent 60%, rgba(255,0,0,0.5));opacity:0;transition:opacity 0.1s;z-index:100;";
document.body.appendChild(dmgOverlay);

let lastDamageFlash = 0;
let dmgFlashTimeout: ReturnType<typeof setTimeout> | null = null;
function flashDamageOverlay(): void {
    const now = performance.now();
    if (now - lastDamageFlash < 200) return;
    lastDamageFlash = now;
    if (dmgFlashTimeout) clearTimeout(dmgFlashTimeout);
    dmgOverlay.style.opacity = "1";
    dmgFlashTimeout = setTimeout(() => { dmgOverlay.style.opacity = "0"; }, 80);
}

let playerDamageFlashUntil = 0;
function triggerPlayerDamageFlash(): void {
    playerDamageFlashUntil = performance.now() + 120;
}

let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let cachedNoiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctxAudio: AudioContext): AudioBuffer {
    if (cachedNoiseBuffer) return cachedNoiseBuffer;
    const length = ctxAudio.sampleRate * 2;
    const buffer = ctxAudio.createBuffer(1, length, ctxAudio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    cachedNoiseBuffer = buffer;
    return buffer;
}

function ensureAudio(): AudioContext | null {
    if (!audioCtx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return null;
        audioCtx = new Ctor();
        masterCompressor = audioCtx.createDynamicsCompressor();
        masterCompressor.threshold.setValueAtTime(-14, audioCtx.currentTime);
        masterCompressor.knee.setValueAtTime(0, audioCtx.currentTime);
        masterCompressor.ratio.setValueAtTime(12, audioCtx.currentTime);
        masterCompressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
        masterCompressor.release.setValueAtTime(0.1, audioCtx.currentTime);
        masterCompressor.connect(audioCtx.destination);
        cachedNoiseBuffer = null;
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => { });
    return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.06, sweepTo: number | null = null): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const osc = ctxAudio.createOscillator();
    const amp = ctxAudio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctxAudio.currentTime);
    if (sweepTo !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), ctxAudio.currentTime + duration);
    }
    amp.gain.setValueAtTime(gain, ctxAudio.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + duration);
    osc.connect(amp);
    amp.connect(masterCompressor);
    osc.start();
    osc.stop(ctxAudio.currentTime + duration);
}

function playNoise(duration: number, gain = 0.06): void {
    const ctxAudio = ensureAudio();
    if (!ctxAudio || !masterCompressor) return;
    const source = ctxAudio.createBufferSource();
    const amp = ctxAudio.createGain();
    const filter = ctxAudio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 520;
    source.buffer = getNoiseBuffer(ctxAudio);
    amp.gain.setValueAtTime(gain, ctxAudio.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(masterCompressor);
    source.start();
    source.stop(ctxAudio.currentTime + duration);
}

function triggerHaptic(duration = 50, intensity = 0.5): void {
    try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (gp && gp.vibrationActuator) {
                (gp.vibrationActuator as any).playEffect("dual-rumble", {
                    duration,
                    strongMagnitude: intensity,
                    weakMagnitude: intensity * 0.5,
                }).catch(() => { });
            }
        }
    } catch (_) { }
    if (userInteracted && navigator.vibrate) {
        try { navigator.vibrate(duration); } catch (_) { }
    }
}

let viewW = 0, viewH = 0;

function resizeCanvas(): void {
    const hudH = hudEl?.offsetHeight ?? 0;
    const statH = statusBarEl?.offsetHeight ?? 0;
    viewW = window.innerWidth;
    viewH = window.innerHeight - hudH - statH;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
    canvas.style.marginTop = hudH + "px";
    canvas.style.marginLeft = "0px";
    canvas.style.display = "block";

    const wrap = document.getElementById("canvas-wrap");
    if (wrap) {
        wrap.style.top = hudH + "px";
        wrap.style.bottom = statH + "px";
    }
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const { drawPixelShip } = createPixelShipRenderer(ctx);

const NAVAL_WEAPON_COLORS: Record<WeaponKind, string> = {
    naval_cannon: "#ffd36a", autocannon: "#a8ff78", plasma_broadside: "#d86bff",
    railgun: "#7df9ff", torpedo: "#ff9030", guided_missile: "#ff6a3d",
    energy_bomb: "#ffe66d", emp_launcher: "#66ccff",
};
const NAVAL_WEAPON_ICONS: Record<WeaponKind, string> = {
    naval_cannon: "NAVAL CANNON", autocannon: "AUTOCANNON", plasma_broadside: "PLASMA BROADSIDE",
    railgun: "RAILGUN", torpedo: "TORPEDO", guided_missile: "GUIDED MISSILE",
    energy_bomb: "ENERGY BOMB", emp_launcher: "EMP LAUNCHER",
};

function setDiff(el: HTMLElement | null, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
}

function renderMeter(value: number, max: number, width: number, filledChar: string, emptyChar: string): string {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeMax = max > 0 ? max : 1;
    const clamped = Math.max(0, Math.min(safeMax, safeValue));
    const filled = Math.round((clamped / safeMax) * width);
    return filledChar.repeat(filled) + emptyChar.repeat(Math.max(0, width - filled));
}

function drawWeaponHUD(weapon: WeaponKind): void {
    if (!weaponDisp) return;
    const color = NAVAL_WEAPON_COLORS[weapon] || "#fff";
    setDiff(weaponDisp, NAVAL_WEAPON_ICONS[weapon] || weapon || "");
    weaponDisp.style.color = color;
    weaponDisp.style.textShadow = `0 0 10px ${color}`;
}

function drawShieldHUD(shield: number, shieldMax: number): void {
    if (!shieldDisp) return;
    const sMax = shieldMax || 3;
    setDiff(shieldDisp, "◈".repeat(Math.max(0, shield)) + "◇".repeat(Math.max(0, sMax - shield)));
    shieldDisp.style.color = shield > 1 ? "#4af" : shield === 1 ? "#fa0" : "#f44";
}

function drawHpHUD(hp: number, maxHp: number): void {
    if (!hpDisp) return;
    const currentMax = maxHp > 0 ? maxHp : 5;
    setDiff(hpDisp, "◈".repeat(Math.max(0, hp)) + "◇".repeat(Math.max(0, currentMax - hp)));
    hpDisp.style.color = hp > (currentMax * 0.4) ? "#a8ff78" : hp > (currentMax * 0.2) ? "#ffd36a" : "#ff6a7a";
}

function drawEnergyHUD(energy: number): void {
    if (energyDisp) setDiff(energyDisp, renderMeter(energy, 100, 10, "█", "░"));
}

function drawHeatHUD(heat: number): void {
    if (!heatDisp) return;
    setDiff(heatDisp, renderMeter(heat, 100, 10, "█", "░"));
    heatDisp.style.color = heat > 75 ? "#ff6a7a" : heat > 45 ? "#ffb35a" : "#ffd36a";
}

function drawObjectiveHUD(zones: Record<string, any>): void {
    if (!objectiveDisp) return;
    const list = Object.values(zones || {});
    if (!list.length) {
        setDiff(objectiveDisp, "DOMINIO 0/0");
        return;
    }
    const playersOwned = list.filter((z: any) => z.owner === "red" || z.owner === "blue").length;
    const maxProg = (z: any) => Math.max(z.redProgress || 0, z.blueProgress || 0, z.enemyProgress || 0);
    const focus = list.reduce((best: any, z: any) => maxProg(z) > maxProg(best) ? z : best, list[0]);
    const pct = Math.round(maxProg(focus));
    let ownerText = "NEUTRAL";
    if (focus.owner === myTeam) ownerText = "ALLY";
    else if (focus.owner === "red" || focus.owner === "blue") ownerText = "RIVAL";
    else if (focus.owner === "enemies") ownerText = "ENEMY";
    setDiff(objectiveDisp, `CONTROL ${playersOwned}/${list.length} • ${focus.label || "ZONE"} ${pct}% ${ownerText}`);
}

function updateTeamBadge(team: string): void {
    if (!teamBadge) return;
    setDiff(teamBadge, team === "red" ? "◆ RED TEAM" : team === "blue" ? "◆ BLUE TEAM" : "◇ SPECTATOR");
    teamBadge.className = team === "red" ? "team-badge-red" : "team-badge-blue";
}

function playWeaponSound(weapon: string): void {
    switch (weapon) {
        case "naval_cannon": case "railgun":
            playTone(880, 0.04, "square", 0.035, 1360); break;
        case "plasma_broadside": case "autocannon":
            playTone(620, 0.03, "triangle", 0.028, 740);
            playTone(820, 0.04, "triangle", 0.025, 1040); break;
        case "torpedo": case "guided_missile":
            playTone(180, 0.12, "sawtooth", 0.04, 90);
            playTone(70, 0.16, "triangle", 0.03, 40); break;
        default: playTone(880, 0.04, "square", 0.035, 1360);
    }
}

function playImpactSound(strong = false): void {
    playNoise(strong ? 0.06 : 0.03, strong ? 0.045 : 0.02);
    playTone(strong ? 260 : 420, strong ? 0.05 : 0.03, "square", strong ? 0.03 : 0.015, strong ? 140 : 260);
}

function playExplosionSound(): void {
    playNoise(0.16, 0.08);
    playTone(72, 0.18, "sawtooth", 0.04, 35);
}

function playObjectiveSound(): void {
    playTone(660, 0.05, "triangle", 0.03, 880);
    playTone(990, 0.08, "triangle", 0.03, 1320);
}

interface Star {
    x: number; y: number; size: number; speed: number;
    alpha: number; tw: number; tws: number;
}
let stars: Star[] = [];
const nebOffscreen = document.createElement("canvas");
let nebBuilt = false;

function generateStars(): void {
    stars = Array.from({ length: 280 }, () => ({
        x: Math.random() * WORLD_W, y: Math.random() * WORLD_H,
        size: Math.random() < 0.06 ? 2 : 1,
        speed: Math.random() * 0.45 + 0.05,
        alpha: Math.random() * 0.6 + 0.3,
        tw: Math.random() * Math.PI * 2,
        tws: Math.random() * 0.05 + 0.015,
    }));
}

function updateStars(): void {
    for (const s of stars) s.tw += s.tws;
}

function buildNebulas(): void {
    nebOffscreen.width = WORLD_W;
    nebOffscreen.height = WORLD_H;
    const nc = nebOffscreen.getContext("2d")!;
    const defs = [
        { x: 200, y: 150, r: 240, h: 195, a: 0.08 },
        { x: 950, y: 620, r: 280, h: 270, a: 0.07 },
        { x: 600, y: 400, r: 200, h: 330, a: 0.05 },
        { x: 100, y: 650, r: 210, h: 150, a: 0.06 },
        { x: 1080, y: 200, r: 180, h: 20, a: 0.06 },
    ];
    for (const d of defs) {
        const g = nc.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        g.addColorStop(0, `hsla(${d.h},65%,45%,${d.a})`);
        g.addColorStop(0.5, `hsla(${d.h},55%,25%,${d.a * 0.5})`);
        g.addColorStop(1, "transparent");
        nc.fillStyle = g;
        nc.fillRect(0, 0, WORLD_W, WORLD_H);
    }
    nebBuilt = true;
}

function drawBackground(): void {
    ctx.fillStyle = "#02030e";
    ctx.fillRect(cameraX, cameraY, viewW, viewH);

    ctx.strokeStyle = "rgba(8,15,48,0.5)";
    ctx.lineWidth = 1;
    const startX = Math.floor(cameraX / 48) * 48;
    const startY = Math.floor(cameraY / 48) * 48;
    const endX = cameraX + viewW + 48;
    const endY = cameraY + viewH + 48;
    for (let x = startX; x < endX; x += 48) {
        const sx = Math.round(x - cameraX) + cameraX;
        ctx.beginPath(); ctx.moveTo(sx, cameraY); ctx.lineTo(sx, endY); ctx.stroke();
    }
    for (let y = startY; y < endY; y += 48) {
        const sy = Math.round(y - cameraY) + cameraY;
        ctx.beginPath(); ctx.moveTo(cameraX, sy); ctx.lineTo(endX, sy); ctx.stroke();
    }

    const wrapS = 2000;
    for (const s of stars) {
        let px = ((s.x - cameraX * (s.speed * 1.5)) % wrapS + wrapS) % wrapS;
        let py = ((s.y - cameraY * (s.speed * 1.5)) % wrapS + wrapS) % wrapS;
        if (px < 0 || px > viewW || py < 0 || py > viewH) continue;
        ctx.globalAlpha = s.alpha * (0.6 + 0.4 * Math.sin(s.tw));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(px) + cameraX, Math.round(py) + cameraY, s.size, s.size);
    }
    ctx.globalAlpha = 1;
}

function drawObjectives(zones: Record<string, any>): void {
    for (const id in zones) {
        const zone = zones[id];
        const ownerColor = zone.owner === "red" ? "#ff3355"
            : zone.owner === "blue" ? "#3399ff"
                : zone.owner === "enemies" ? "#ff4a88" : "#7f8aa8";
        const alpha = zone.owner === "neutral" ? 0.12 : 0.2;
        const fill = ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
        fill.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`);
        fill.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.45})`);
        fill.addColorStop(1, "transparent");

        ctx.save();
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = ownerColor;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14; ctx.shadowColor = ownerColor;
        ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = ownerColor;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.radius * 0.62, 0, Math.PI * 2); ctx.stroke();

        const prog = myTeam === "red" ? zone.redProgress : zone.blueProgress;
        if (prog > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(zone.x, zone.y, zone.radius + 6, -Math.PI / 2, -Math.PI / 2 + (prog / 100) * Math.PI * 2);
            ctx.strokeStyle = myTeam === "red" ? "#ff3355" : "#3399ff";
            ctx.lineWidth = 3;
            ctx.shadowBlur = 10;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalAlpha = 0.9;
        ctx.fillStyle = ownerColor;
        ctx.font = "7px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillText(zone.label || "ZONA", Math.round(zone.x - cameraX) + cameraX, Math.round(zone.y - zone.radius - 10 - cameraY) + cameraY);
        ctx.font = "6px 'Press Start 2P', monospace";
        const maxProgress = Math.max(zone.redProgress || 0, zone.blueProgress || 0, zone.enemyProgress || 0);
        ctx.fillText(`${Math.round(maxProgress)}%`, Math.round(zone.x - cameraX) + cameraX, Math.round(zone.y + zone.radius + 12 - cameraY) + cameraY);
        ctx.restore();
    }
}

interface Particle {
    x: number; y: number; vx: number; vy: number;
    sz: number; color: string; life: number; maxLife: number;
}
let particles: Particle[] = [];

function explode(x: number, y: number, colors: string[], n: number, spd = 4.5, scale = 1): void {
    const effectiveN = Math.round(n * scale);
    const effectiveSpd = spd * scale;
    for (let i = 0; i < effectiveN; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * effectiveSpd + 0.8;
        particles.push({
            x, y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            sz: Math.floor(Math.random() * 5 + 2),
            color: colors[Math.floor(Math.random() * colors.length)] ?? "#fff",
            life: 30 + Math.random() * 15, maxLife: 45,
        });
    }
}

function tickParticles(): void {
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.91; p.vy *= 0.91;
        p.life--;
    }
}

function drawParticles(): void {
    for (const p of particles) {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        const s = Math.max(1, Math.ceil(p.sz * (p.life / p.maxLife)));
        ctx.fillRect(Math.round(p.x - cameraX) + cameraX, Math.round(p.y - cameraY) + cameraY, s, s);
    }
    ctx.globalAlpha = 1;
}

function drawBullets(bullets: Record<string, any>): void {
    for (const id in bullets) {
        const b = bullets[id];
        const margin = 150;
        if (b.x < cameraX - margin || b.y < cameraY - margin ||
            b.x > cameraX + viewW + margin || b.y > cameraY + viewH + margin) continue;

        const a = b.angle !== undefined ? b.angle : Math.atan2(b.vy, b.vx);
        const bx = Math.round(b.x - cameraX) + cameraX;
        const by = Math.round(b.y - cameraY) + cameraY;

        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(a);

        const kind = b.kind;
        if (kind === "naval_cannon") {
            ctx.shadowBlur = 14; ctx.shadowColor = "#ffd36a";
            ctx.fillStyle = "#ffb35a"; ctx.fillRect(-4, -4, 8, 8);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#ffd36a"; ctx.fillRect(-7, -7, 14, 14);
        } else if (kind === "autocannon") {
            ctx.shadowBlur = 8; ctx.shadowColor = "#a8ff78";
            ctx.fillStyle = "#ccffaa"; ctx.fillRect(-5, -1, 10, 3);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#a8ff78"; ctx.fillRect(-7, -3, 14, 7);
        } else if (kind === "plasma_broadside") {
            ctx.shadowBlur = 10; ctx.shadowColor = "#cc00ff";
            ctx.fillStyle = "#dd66ff"; ctx.fillRect(-3, -3, 6, 6);
            ctx.globalAlpha = 0.4; ctx.fillStyle = "#aa00ff"; ctx.fillRect(-5, -5, 10, 10);
        } else if (kind === "railgun") {
            ctx.shadowBlur = 10; ctx.shadowColor = "#00e5ff";
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-12, -1, 24, 3);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#00e5ff"; ctx.fillRect(-15, -3, 30, 7);
        } else if (kind === "torpedo") {
            ctx.shadowBlur = 8; ctx.shadowColor = "#ff9030";
            ctx.fillStyle = "#ffaa00"; ctx.fillRect(-16, -3, 4, 6);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-14, -2, 2, 4);
            ctx.fillStyle = "#333333"; ctx.fillRect(-12, -5, 6, 10);
            ctx.fillStyle = "#aaaaaa"; ctx.fillRect(-6, -4, 12, 8);
            ctx.fillStyle = "#ff4444"; ctx.fillRect(6, -3, 6, 6);
            ctx.fillRect(12, -2, 2, 4);
        } else if (kind === "guided_missile") {
            ctx.shadowBlur = 4; ctx.shadowColor = "#ff6a3d";
            ctx.fillStyle = "#ffaa00"; ctx.fillRect(-12, -2, 3, 4);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-10, -1, 1, 2);
            ctx.fillStyle = "#888888"; ctx.fillRect(-9, -3, 5, 6);
            ctx.fillStyle = "#cccccc"; ctx.fillRect(-4, -2, 8, 4);
            ctx.fillStyle = "#555555"; ctx.fillRect(-6, -4, 4, 2);
            ctx.fillStyle = "#555555"; ctx.fillRect(-6, 2, 4, 2);
            ctx.fillStyle = "#ff4444"; ctx.fillRect(4, -2, 4, 4);
            ctx.fillRect(8, -1, 2, 2);
        } else if (kind === "energy_bomb") {
            ctx.shadowBlur = 18; ctx.shadowColor = "#ffe66d";
            ctx.fillStyle = "#ffcc00"; ctx.fillRect(-6, -6, 12, 12);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-2, -2, 4, 4);
            ctx.globalAlpha = 0.3; ctx.fillStyle = "#ffff66"; ctx.fillRect(-10, -10, 20, 20);
        } else if (kind === "emp_launcher") {
            ctx.shadowBlur = 12; ctx.shadowColor = "#66ccff";
            ctx.fillStyle = "#ccffff"; ctx.fillRect(-4, -4, 8, 8);
            ctx.globalAlpha = 0.4; ctx.fillStyle = "#3399ff"; ctx.fillRect(-8, -8, 16, 16);
        } else {
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-2, -2, 4, 4);
        }

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function parseHSL(hsl: string): number[] {
    const m = hsl.match(/[\d.]+/g);
    return m ? m.map(Number) : [180, 80, 60];
}

function makePlayerPalette(hsl: number[], team: string): Record<number, string> {
    const [h = 180, s = 80, l = 60] = hsl;
    const tintH = team === "red" ? 0 : team === "blue" ? 210 : h;
    const useH = team ? tintH : h;
    return {
        1: `hsl(${useH},${s}%,${l}%)`,
        2: `hsl(${useH},${s - 10}%,${Math.min(l + 20, 90)}%)`,
        3: `hsl(${(useH + 200) % 360},${Math.max(s - 30, 30)}%,${Math.max(l - 20, 30)}%)`,
        4: `hsl(${(useH + 40) % 360},${s}%,${Math.max(l - 15, 15)}%)`,
        5: `hsl(${useH},${Math.max(s - 20, 20)}%,${Math.min(l + 10, 80)}%)`,
        6: `hsl(${useH},${s}%,${Math.max(l - 35, 10)}%)`,
        7: `hsl(${(useH + 20) % 360},${Math.max(s - 5, 40)}%,${Math.min(l + 5, 85)}%)`,
        8: "#a0eeff",
    };
}

const PAL_SCOUT: Record<number, string> = Object.freeze({
    1: "#b50035", 2: "#ff1c51", 3: "#ffaa00", 4: "#e6004b",
    5: "#ff7093", 6: "#4a0016", 7: "#ff2a5f", 8: "#a0eeff",
});
const PAL_CRUISER_ENEMY: Record<number, string> = Object.freeze({
    1: "#4a0080", 2: "#8a00cc", 3: "#ffaa00", 4: "#aa00ff",
    5: "#ba66ff", 6: "#1a002b", 7: "#d488ff", 8: "#a0eeff",
});
const PAL_CAPITAL: Record<number, string> = Object.freeze({
    1: "#12204a", 2: "#2d4bb5", 3: "#ffaa00", 4: "#e62a4a",
    5: "#4272f5", 6: "#070c21", 7: "#5788fa", 8: "#a0eeff",
});
const PAL_FLASH_RED: Record<number, string> = Object.freeze({
    1: "#ff0000", 2: "#ff5555", 3: "#ffaa00", 4: "#ff0000",
    5: "#aa0000", 6: "#550000", 7: "#ff0000", 8: "#ffffff",
});

function drawShipEngines(
    x: number,
    y: number,
    angle: number,
    shipType: string,
    color: string,
    ps: number,
    reverse: boolean = false
): void {
    const attachments = SHIP_ATTACHMENTS[shipType];
    if (!attachments) return;

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const dir = reverse ? -1 : 1;

    for (const engine of attachments.engines) {
        const mx = engine.x * ps;
        const my = engine.y * ps;
        const ex = x + mx * cos - my * sin;
        const ey = y + mx * sin + my * cos;

        const len = engine.size === "large" ? 14 : engine.size === "medium" ? 10 : 7;
        const width = engine.size === "large" ? 5 : engine.size === "medium" ? 3 : 2;

        for (let i = 0; i < len; i++) {
            const t = i / len;
            const trailDx = -Math.cos(angle) * dir;
            const trailDy = -Math.sin(angle) * dir;

            const pulse = Math.sin(performance.now() * 0.015 + i) * 2;
            const jitter = Math.sin(performance.now() * 0.02 + i * 2.7) * (i * 0.5);

            const px = ex + trailDx * (i * 4 + pulse) + jitter;
            const py = ey + trailDy * (i * 4 + pulse) + jitter;

            ctx.globalAlpha = (1 - t) * 0.7;
            ctx.fillStyle = i < 2 ? "#ffffff" : color;
            const sz = Math.max(1, Math.floor((1 - t) * width * (ps / 2.5)));
            ctx.fillRect(Math.round(px - cameraX) + cameraX, Math.round(py - cameraY) + cameraY, sz, sz);
        }
    }
    ctx.restore();
}

function drawEnemies(enemies: Record<string, any>): void {
    for (const id in enemies) {
        const e = enemies[id];
        const ps = 3;
        const shipClass = e.shipClass || "corvette";

        const isHeavy = shipClass === "battleship" || shipClass === "dreadnought";
        const isMedium = shipClass === "destroyer" || shipClass === "missile_frigate" || shipClass === "cruiser";

        const glowC = isHeavy ? "#4466ff" : isMedium ? "#cc00ff" : "#ff2060";

        const shipType = isHeavy ? "capital" : isMedium ? "cruiser" : "scout";
        const grid = SHIP_BITMAPS[shipType]!;

        const pal = isHeavy
            ? PAL_CAPITAL
            : isMedium
                ? PAL_CRUISER_ENEMY
                : PAL_SCOUT;

        const rx = Math.round(e.x - cameraX) + cameraX;
        const ry = Math.round(e.y - cameraY) + cameraY;
        drawShipEngines(rx, ry, e.angle, shipType, glowC, ps);

        ctx.shadowBlur = isHeavy ? 22 : 14;
        ctx.shadowColor = glowC;
        drawPixelShip(grid, rx, ry, e.angle, pal, ps);
        ctx.shadowBlur = 0;

        const maxHpSafe = e.maxHp > 0 ? e.maxHp : 10;
        const pct = Math.max(0, Math.min(1, e.hp / maxHpSafe));
        const bw = isHeavy ? 44 : isMedium ? 32 : 22;
        const bh = 3;
        const bx = Math.round(e.x - bw / 2 - cameraX) + cameraX;
        const by = Math.round(e.y - (isHeavy ? 40 : 30) - cameraY) + cameraY;
        ctx.fillStyle = "#220000";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = pct > 0.6 ? glowC : pct > 0.3 ? "#ffaa00" : "#ff2020";
        ctx.fillRect(bx, by, Math.round(bw * pct), bh);
    }
}

function drawPlayers(players: Record<string, any>, myId: string | null, mx: number, my: number, myShield: number): void {
    for (const id in players) {
        const p = players[id];
        if (!p.alive) continue;
        const isMe = id === myId;
        const hsl = parseHSL(p.color ?? "hsl(180,80%,60%)");
        const prx = Math.round(p.x - cameraX) + cameraX;
        const pry = Math.round(p.y - cameraY) + cameraY;

        let pal = makePlayerPalette(hsl, p.team);
        if (isMe && performance.now() < playerDamageFlashUntil) {
            pal = PAL_FLASH_RED;
        }

        const teamGlow = p.team === "red" ? "#ff3355" : p.team === "blue" ? "#3399ff" : (p.color ?? "#ffffff");

        ctx.shadowBlur = isMe ? 22 : 14;
        ctx.shadowColor = teamGlow;
        drawPixelShip(SHIP_BITMAPS.player!, prx, pry, p.angle, pal, isMe ? 3 : 2, "player", DEFAULT_LOADOUTS.player, Math.floor(performance.now() / 50));
        ctx.shadowBlur = 0;

        if (isMe) {
            const ps = 3;
            const trailColor = myTeam === "red" ? "#ff5500" : (myTeam === "blue" ? "#00aaff" : "#ffffff");
            const reversing = keys["s"] || keys["arrowdown"];
            drawShipEngines(prx, pry, p.angle, "player", trailColor, ps, reversing);

            if ((keys["shift"] || (serverPlayers[myId!]?.boostCooldown > 0)) && myBoostEnergy >= 28) {
                const mx_boost = -Math.cos(p.angle);
                const my_boost = -Math.sin(p.angle);
                for (let i = 0; i < 6; i++) {
                    const t = performance.now() * 0.01 + i * 1.3;
                    const ex = p.x + mx_boost * (18 + i * 4) + Math.sin(t) * 2.5;
                    const ey = p.y + my_boost * (18 + i * 4) + Math.cos(t + 0.7) * 2.5;
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = "#00ccff";
                    ctx.fillRect(Math.round(ex - cameraX) + cameraX, Math.round(ey - cameraY) + cameraY, 3, 3);
                }
                ctx.globalAlpha = 1;
            }
        }

        if (isMe && myShield > 0) {
            ctx.strokeStyle = `rgba(68,170,255,${0.15 + myShield * 0.12})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(prx, pry, 28, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (isMe && !gameOver) {
            ctx.strokeStyle = "rgba(0,229,255,0.22)";
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 7]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mx, my); ctx.stroke();
            ctx.setLineDash([]);
            const cs = 9;
            ctx.strokeStyle = "rgba(0,229,255,0.8)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mx - cs, my); ctx.lineTo(mx + cs, my);
            ctx.moveTo(mx, my - cs); ctx.lineTo(mx, my + cs);
            ctx.stroke();
            ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.stroke();

            const now = performance.now();
            const cd = COOLDOWN_TABLE[myWeapon] || 200;
            const elapsed = now - lastShot;
            const remaining = Math.max(0, cd - elapsed);
            if (remaining > 0) {
                const barLen = 20;
                const ratio = remaining / cd;
                ctx.fillStyle = "rgba(255,255,255,0.7)";
                ctx.fillRect(mx - barLen / 2, my + 15, barLen, 3);
                ctx.fillStyle = "#ffaa00";
                ctx.fillRect(mx - barLen / 2, my + 15, barLen * (1 - ratio), 3);
            }
        }

        ctx.font = "6px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = isMe ? "rgba(0,229,255,0.85)"
            : p.team === "red" ? "rgba(255,100,100,0.7)"
                : p.team === "blue" ? "rgba(100,180,255,0.7)" : "rgba(200,220,255,0.5)";
        const tagY = Math.round(p.y - (isMe ? 42 : 30) - cameraY) + cameraY;
        if (p.name) ctx.fillText(p.name.slice(0, 8), Math.round(p.x - cameraX) + cameraX, tagY - 8);
        ctx.fillText(`${p.score ?? 0}`, Math.round(p.x - cameraX) + cameraX, tagY);
    }
}

let waveFlash = 0;
function drawWaveFlash(): void {
    if (waveFlash <= 0) return;
    ctx.globalAlpha = (waveFlash / 50) * 0.3;
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = 1;
    waveFlash--;
}

let myId: string | null = null;
let myTeam = "red";
let myWeapon: WeaponKind = "naval_cannon";
let myShield = 3;
let myHp = 5;
let myMaxShield = 3;
let myMaxHp = 5;
let myBoostEnergy = 100;
let myHeat = 0;
let gameOver = false;
let respawnState: "idle" | "requesting" = "idle";
let respawnTimer: ReturnType<typeof setTimeout> | null = null;
let score = 0;
let currentWave = 1;
let serverPlayers: Record<string, any> = {};
let serverBullets: Record<string, any> = {};
let serverEnemies: Record<string, any> = {};
let serverZones: Record<string, any> = {};

let cameraX = 0, cameraY = 0;
let lastFrameTime = 0;
let lastTickTime = 0;
let screenMx = window.innerWidth / 2, screenMy = window.innerHeight / 2;

let renderPlayers: Record<string, any> = {};
let renderEnemies: Record<string, any> = {};
let renderBullets: Record<string, any> = {};

function lerpAngle(a: number, b: number, amt: number): number {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * amt;
}

const ENTITY_SMOOTH = 0.2;
const ANGLE_SMOOTH = 0.4;

function syncRenderState(renderMap: Record<string, any>, serverMap: Record<string, any>, dt: number, isAngle = false): void {
    const alpha = 1 - Math.pow(1 - ENTITY_SMOOTH, dt);
    const alphaAngle = 1 - Math.pow(1 - ANGLE_SMOOTH, dt);

    for (const id in serverMap) {
        const s = serverMap[id];

        if (!renderMap[id]) {
            renderMap[id] = { ...s };
        } else {
            const r = renderMap[id];

            r.x += (s.x - r.x) * alpha;
            r.y += (s.y - r.y) * alpha;

            if (isAngle && s.angle !== undefined) {
                r.angle = lerpAngle(r.angle || 0, s.angle, alphaAngle);
            } else if (s.angle !== undefined) {
                r.angle = s.angle;
            }

            r.hp = s.hp; r.maxHp = s.maxHp; r.shield = s.shield; r.score = s.score;
            r.color = s.color; r.shipClass = s.shipClass; r.alive = s.alive;
            r.team = s.team; r.name = s.name;
            r.vx = s.vx; r.vy = s.vy; r.radius = s.radius;
        }
    }
    for (const id in renderMap) {
        if (!serverMap[id]) delete renderMap[id];
    }
}

const keys: Record<string, boolean> = {};
let isMouseShooting = false;

window.addEventListener("keydown", (e: KeyboardEvent) => {
    keys[e.key.toLowerCase()] = true;
    if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < QUICK_CHAT.length) send("chat", { text: QUICK_CHAT[idx] });
    }
    if ((e.key.toLowerCase() === "q" || e.key === "Tab") && !e.repeat) {
        e.preventDefault();
        send("switch_weapon");
    }
    if (e.key === "Shift" && !e.repeat) {
        e.preventDefault();
        sendBoost();
    }
    if (e.key === " " && !e.repeat) e.preventDefault();
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        adminPanel?.classList.toggle("hidden");
        canvas.style.cursor = adminPanel?.classList.contains("hidden") ? "none" : "default";
    }
});
window.addEventListener("keyup", (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    isMouseShooting = false;
});

let mx = WORLD_W / 2, my = WORLD_H / 2;
canvas.addEventListener("mousemove", (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    screenMx = e.clientX - r.left;
    screenMy = e.clientY - r.top;
});
canvas.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button === 0 && !gameOver) {
        isMouseShooting = true;
        fireShot();
    } else if (e.button === 2) {
        e.preventDefault();
        sendBoost();
    }
});
window.addEventListener("mouseup", (e: MouseEvent) => { if (e.button === 0) isMouseShooting = false; });
canvas.addEventListener("contextmenu", (e: Event) => e.preventDefault());

let lastShot = 0;
function fireShot(): void {
    const now = performance.now();
    const cd = COOLDOWN_TABLE[myWeapon] ?? 200;
    if (now - lastShot < cd || gameOver) return;
    lastShot = now;
    send("shoot");
}

function sendBoost(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver || myBoostEnergy < 28) return;
    send("boost");
}

adminClose?.addEventListener("click", () => {
    adminPanel?.classList.add("hidden");
    canvas.style.cursor = "none";
});
adminAuthForm?.addEventListener("submit", (e: Event) => {
    e.preventDefault();
    send("admin_auth", { key: adminKeyInput?.value ?? "" });
});
adminResetAllBtn?.addEventListener("click", () => send("admin_reset_all"));
adminClearEnemiesBtn?.addEventListener("click", () => send("admin_clear_enemies"));
adminSetWaveBtn?.addEventListener("click", () => {
    const wave = parseInt(adminWaveInput?.value ?? "1", 10);
    if (!isNaN(wave) && wave > 0) send("admin_set_wave", { wave });
});
adminJoinRed?.addEventListener("click", () => {
    send("set_team", { team: "red" });
    myTeam = "red"; updateTeamBadge("red");
});
adminJoinBlue?.addEventListener("click", () => {
    send("set_team", { team: "blue" });
    myTeam = "blue"; updateTeamBadge("blue");
});
adminGodmodeBtn?.addEventListener("click", () => send("admin_godmode"));
adminHealBtn?.addEventListener("click", () => send("admin_heal_all"));
adminResetDataBtn?.addEventListener("click", () => {
    localStorage.clear();
    setDiff(adminResetDataBtn, "DATA CLEARED");
    setTimeout(() => { window.location.reload(); }, 500);
});

function refreshAdminPlayerList(): void {
    if (!adminPlayerList) return;
    adminPlayerList.innerHTML = "";
    for (const [id, p] of Object.entries(serverPlayers)) {
        const row = document.createElement("div");
        row.className = "admin-player-row";
        const nameSpan = document.createElement("span");
        nameSpan.className = `admin-player-name admin-player-team-${p.team || "red"}`;
        nameSpan.textContent = `[${(p.team || "?").toUpperCase()}] ${p.name || id.slice(0, 6)}`;
        const kickBtn = document.createElement("button");
        kickBtn.className = "admin-kick-btn";
        kickBtn.textContent = "KICK";
        kickBtn.dataset.id = id;
        kickBtn.addEventListener("click", () => send("admin_kick", { targetId: id }));
        row.appendChild(nameSpan);
        row.appendChild(kickBtn);
        adminPlayerList.appendChild(row);
    }
}

let socket: WebSocket | null = null;
let isAdmin = false;
let lastHitSoundTime = 0;

function send(type: string, payload: Record<string, any> = {}): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type, ...payload }));
}

function connect(): void {
    setStatus("connecting");
    const token = generateToken("player");
    const wsUrl = IS_LOCAL
        ? `${WORKER_WS}/room/${ROOM_ID}?token=${token}`
        : `${WORKER_WS}/room/${ROOM_ID}?token=${token}`;
    try {
        socket = new WebSocket(wsUrl);
    } catch (e) {
        setStatus("disconnected");
        setTimeout(connect, 3000);
        return;
    }
    socket.addEventListener("open", () => setStatus("connected"));
    socket.addEventListener("message", (e: MessageEvent) => handleMsg(JSON.parse(e.data)));
    socket.addEventListener("close", () => {
        setStatus("disconnected");
        setTimeout(connect, 2500);
    });
    socket.addEventListener("error", () => setStatus("disconnected"));
}

function syncPlayerState(me: any): void {
    score = me.score;
    myShield = me.shield ?? myShield;
    myMaxShield = me.shieldMax ?? 3;
    myHp = me.hp ?? myHp;
    myMaxHp = me.maxHp ?? myMaxHp;
    myBoostEnergy = me.boostEnergy ?? myBoostEnergy;
    myHeat = me.weaponHeat ?? myHeat;
    if (me.weapon && me.weapon !== myWeapon) {
        myWeapon = me.weapon;
        drawWeaponHUD(myWeapon);
    }
    if (gameOver && me.alive) {
        gameOver = false;
        if (overlay) {
            overlay.classList.add("hidden");
            overlay.style.pointerEvents = "auto";
        }
        document.body.style.cursor = "none";
        canvas.style.cursor = "crosshair";
        lastShot = 0; particles = [];
    }
    if (me.isAdmin && !isAdmin) {
        isAdmin = true;
        adminControls?.classList.remove("hidden");
        setDiff(adminAuthStatus, "◆ ADMIN ACTIVE");
        if (adminAuthStatus) adminAuthStatus.className = "ok";
    }
    if (!me.alive && !gameOver) {
        gameOver = true;
        showGameOver();
    }
}

function shouldShakeForExplosion(msg: { x: number; y: number; kind?: string }): boolean {
    const me = serverPlayers[myId!];
    if (!me || !me.alive) return false;
    const radius = msg.kind === "dreadnought" ? 540 : msg.kind === "battleship" ? 380 : 160;
    return Math.hypot(msg.x - me.x, msg.y - me.y) <= radius;
}

const msgHandlers: Record<string, (msg: any) => void> = {
    init(msg) {
        myId = msg.playerId;
        myTeam = msg.team || "red";
        updateTeamBadge(myTeam);
        if (WORLD_W !== msg.worldW || WORLD_H !== msg.worldH) {
            WORLD_W = msg.worldW; WORLD_H = msg.worldH;
            resizeCanvas(); generateStars(); nebBuilt = false;
        }
        serverPlayers = msg.players;
        serverBullets = Object.assign({}, msg.bullets, msg.enemyBullets || {});
        serverEnemies = msg.enemies;
        serverZones = msg.zones ?? {};
        currentWave = msg.wave;
        const me = serverPlayers[myId!];
        if (me) syncPlayerState(me);
        updateHUD();
    },
    tick(msg) {
        lastTickTime = performance.now();
        serverPlayers = msg.players;
        serverBullets = Object.assign({}, msg.bullets, msg.enemyBullets || {});
        serverEnemies = msg.enemies;
        if (msg.zones) serverZones = msg.zones;
        currentWave = msg.wave;
        const me = serverPlayers[myId!];
        if (me) syncPlayerState(me);
        updateHUD();
        if (isAdmin) refreshAdminPlayerList();
    },
    admin_authed(msg) {
        if (msg.ok) {
            isAdmin = true;
            adminControls?.classList.remove("hidden");
            setDiff(adminAuthStatus, "◆ ADMIN ACTIVE");
            if (adminAuthStatus) adminAuthStatus.className = "ok";
        } else {
            setDiff(adminAuthStatus, "✕ WRONG KEY");
            if (adminAuthStatus) adminAuthStatus.className = "";
        }
    },
    admin_event(msg) {
        if (msg.action === "reset_all") {
            myShield = myMaxShield; myHp = myMaxHp; myBoostEnergy = 100; myHeat = 0;
            updateHUD();
        }
    },
    admin_godmode(msg) {
        if (adminGodmodeBtn) setDiff(adminGodmodeBtn, msg.active ? "GODMODE ON" : "GODMODE OFF");
        if (adminGodmodeBtn) {
            adminGodmodeBtn.className = msg.active ? "admin-btn-danger" : "admin-btn-warn";
        }
    },
    weapon_changed(msg) {
        myWeapon = msg.weapon;
        lastShot = 0;
        drawWeaponHUD(myWeapon);
    },
    shockwave(msg) {
        if (msg.ownerId !== myId) return;
        if (!audioCtx) ensureAudio();
        playWeaponSound(msg.weapon);
    },
    explosion(msg) {
        playExplosionSound();
        const scale = msg.kind === "dreadnought" ? 2.5 : msg.kind === "battleship" ? 1.8 : 1.0;
        if (msg.kind === "battleship" || msg.kind === "dreadnought") {
            explode(msg.x, msg.y, ["#ffcc00", "#ff6600", "#ffffff", "#4466ff"], 40, 7, scale);
            explode(msg.x, msg.y, ["#ff4400", "#ff9900"], 20, 3, 1);
            if (shouldShakeForExplosion(msg)) {
                addScreenShake(msg.kind === "dreadnought" ? 1.8 : 1.2, msg.kind === "dreadnought" ? 260 : 180);
            }
            setTimeout(() => { explode(msg.x, msg.y, ["#ff4400", "#ff9900", "#ffff00", "#ffffff"], 60, 5, scale); }, 150);
        } else if (msg.kind === "frigate" || msg.kind === "cruiser") {
            explode(msg.x, msg.y, ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], 24, 5, scale);
        } else {
            explode(msg.x, msg.y, ["#ff2060", "#ffaa20", "#ffffff"], 16, 4, scale);
        }
        const me = serverPlayers[myId!];
        if (me && me.alive && Math.hypot(msg.x - me.x, msg.y - me.y) < 200) {
            playImpactSound(true);
            triggerHaptic(100, 0.8);
        }
    },
    hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) { playImpactSound(false); lastHitSoundTime = now; }
        explode(msg.x, msg.y, ["#ffffff", "#ffdd88"], 6, 2);
        const me = serverPlayers[myId!];
        if (me && Math.hypot(msg.x - me.x, msg.y - me.y) < 100) {
            if (msg.playerId === myId) {
                triggerHaptic(30, 0.3);
                flashDamageOverlay();
                triggerPlayerDamageFlash();
            }
        }
    },
    shield_hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) { playImpactSound(msg.reason === "impact"); lastHitSoundTime = now; }
        if (msg.playerId === myId) {
            addScreenShake(0.55, 140);
            triggerHaptic(40, 0.5);
            myShield = Math.max(0, myShield - 1);
            drawShieldHUD(myShield, myMaxShield);
            flashDamageOverlay();
            triggerPlayerDamageFlash();
            const p = serverPlayers[myId!];
            if (p) explode(p.x, p.y, ["#4488ff", "#aaccff"], 8, 2);
        }
    },
    player_dead(msg) {
        playExplosionSound();
        triggerHaptic(150, 1.0);
        explode(msg.x, msg.y, ["#00e5ff", "#ffffff", "#0088ff"], 30, 6);
        if (msg.playerId === myId) { gameOver = true; showGameOver(); }
    },
    respawned() {
        if (respawnState === "idle") return;
        respawnState = "idle";
        if (respawnTimer) { clearTimeout(respawnTimer); respawnTimer = null; }
        if (restartBtn) { restartBtn.disabled = false; setDiff(restartBtn, "↻ RESPECTAR"); }
        gameOver = false;
        if (overlay) {
            overlay.classList.add("hidden");
            overlay.style.pointerEvents = "auto";
        }
        document.body.style.cursor = "none";
        canvas.style.cursor = "crosshair";
        lastShot = 0; particles = [];
    },
    player_team(msg) {
        if (serverPlayers[msg.playerId]) serverPlayers[msg.playerId].team = msg.team;
        if (msg.playerId === myId) { myTeam = msg.team; updateTeamBadge(myTeam); }
    },
    new_wave(msg) {
        playTone(520, 0.08, "triangle", 0.04, 820);
        currentWave = msg.wave;
        waveFlash = 50;
        myShield = myMaxShield;
        myHp = myMaxHp;
        myBoostEnergy = 100;
        myHeat = 0;
        if (gameOver) {
            gameOver = false;
            if (overlay) {
                overlay.classList.add("hidden");
                overlay.style.pointerEvents = "auto";
            }
            lastShot = 0; particles = [];
        }
        updateHUD();
    },
    objective(msg) {
        const zone = serverZones[msg.zoneId] || {};
        zone.id = msg.zoneId;
        zone.owner = msg.owner;
        zone.label = msg.label || msg.zoneId;
        zone.x = msg.x ?? zone.x;
        zone.y = msg.y ?? zone.y;
        zone.radius = msg.radius ?? zone.radius;
        if (msg.owner === "red") zone.redProgress = msg.progress;
        else if (msg.owner === "blue") zone.blueProgress = msg.progress;
        else if (msg.owner === "enemies") zone.enemyProgress = msg.progress;
        serverZones[msg.zoneId] = zone;
        playObjectiveSound();
        drawObjectiveHUD(serverZones);
    },
};

function handleMsg(msg: any): void {
    const handler = msgHandlers[msg.type];
    if (handler) handler(msg);
}

let lastInputTime = 0;
let lastInputState = { forward: 0, strafe: 0, angle: 0 };

function sendInput(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;
    let forward = 0, strafe = 0;
    if (keys["w"] || keys["arrowup"]) forward += 1;
    if (keys["s"] || keys["arrowdown"]) forward -= 1;
    if (keys["a"] || keys["arrowleft"]) strafe -= 1;
    if (keys["d"] || keys["arrowright"]) strafe += 1;
    const p = serverPlayers[myId!];
    let angle = p ? Math.atan2(my - p.y, mx - p.x) : 0;
    angle = Math.round(angle * 100) / 100;
    let angleDiff = Math.abs(angle - lastInputState.angle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    if (forward !== lastInputState.forward ||
        strafe !== lastInputState.strafe ||
        angleDiff > 0.03) {
        lastInputState = { forward, strafe, angle };
        send("move", { forward, strafe, angle });
    }
}

function updateHUD(): void {
    if (scoreDisp) setDiff(scoreDisp, String(score || 0).padStart(6, "0"));
    if (waveNumDisp) setDiff(waveNumDisp, String(currentWave || 1));
    if (playerCountDisp) setDiff(playerCountDisp, String(Object.keys(serverPlayers).length));
    drawWeaponHUD(myWeapon);
    drawShieldHUD(myShield, myMaxShield);
    drawHpHUD(myHp, myMaxHp);
    drawEnergyHUD(myBoostEnergy);
    drawHeatHUD(myHeat);
    drawObjectiveHUD(serverZones);
}

function setStatus(s: string): void {
    if (!connStatusEl) return;
    const map: Record<string, [string, string]> = {
        connecting: ["status-connecting", "◆ CONNECTING..."],
        connected: ["status-connected", "◆ CONNECTED"],
        disconnected: ["status-disconnected", "◆ DISCONNECTED"],
    };
    const entry: [string, string] = (map[s] ?? map["disconnected"])!;
    const [cls, text] = entry;
    connStatusEl.className = cls;
    setDiff(connStatusEl, text);
}

function showGameOver(): void {
    if (overlay) {
        overlay.classList.remove("hidden");
        overlay.style.background = "rgba(0,0,0,0.4)";
        overlay.style.pointerEvents = "auto";
    }
    document.body.style.cursor = "default";
    canvas.style.cursor = "default";
    if (restartBtn) {
        if (respawnState === "requesting") {
            restartBtn.disabled = true;
            setDiff(restartBtn, "RESPAWNING...");
        } else {
            restartBtn.disabled = false;
            restartBtn.style.pointerEvents = "auto";
        }
    }
    if (overlayScore) setDiff(overlayScore, `PUNTOS: ${String(score || 0).padStart(6, "0")}\nMODO ESPECTADOR (WASD)`);
}

restartBtn?.addEventListener("click", () => {
    if (respawnState === "requesting") return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    respawnState = "requesting";
    restartBtn.disabled = true;
    setDiff(restartBtn, "RESPAWNING...");
    send("respawn");
    if (respawnTimer) clearTimeout(respawnTimer);
    respawnTimer = setTimeout(() => {
        respawnState = "idle";
        restartBtn.disabled = false;
        setDiff(restartBtn, "↻ RESPECTAR");
        respawnTimer = null;
    }, 5000);
});

(function initTutorial(): void {
    if (localStorage.getItem("speakerdust_tutorial_seen")) return;
    const tut = document.createElement("div");
    tut.id = "tutorial-overlay";
    tut.innerHTML = `
        <div style="background:rgba(0,0,0,0.85);color:#fff;padding:20px;border:1px solid #0ff;max-width:320px;text-align:left;font-family:monospace;box-shadow: 0 0 15px #0ff;">
            <h3 style="color:#0ff; text-align:center;">CONTROLES</h3>
            <p><b>WASD / Flechas</b> – Mover</p>
            <p><b>Ratón</b> – Apuntar / Disparar</p>
            <p><b>Q / Tab</b> – Cambiar arma</p>
            <p><b>Shift / Click Der</b> – Turbo</p>
            <p><b>1‑9</b> – Mensajes rápidos</p>
            <p style="color:#aaa;font-size:0.8em;text-align:center;margin-top:15px;">Click para comenzar</p>
        </div>`;
    tut.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:200;";
    document.body.appendChild(tut);
    const dismiss = () => {
        tut.remove();
        localStorage.setItem("speakerdust_tutorial_seen", "1");
        ensureAudio();
    };
    tut.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss, { once: true });
})();

generateStars();
canvas.style.cursor = "none";

function gameLoop(now: number): void {
    requestAnimationFrame(gameLoop);

    updateStars();

    const dpr = window.devicePixelRatio || 1;
    const availW = Math.ceil(viewW);
    const availH = Math.ceil(viewH);
    const cameraCenterX = availW / 2;
    const cameraCenterY = availH / 2;

    const dt = Math.min((now - lastFrameTime) / (1000 / 60), 3);
    lastFrameTime = now;

    syncRenderState(renderPlayers, serverPlayers, dt, true);
    syncRenderState(renderEnemies, serverEnemies, dt, true);
    {
        const elapsed = (performance.now() - lastTickTime) / 1000;
        const next: Record<string, any> = {};
        for (const id in serverBullets) {
            const b = serverBullets[id];
            next[id] = {
                ...b,
                x: b.x + (b.vx || 0) * elapsed,
                y: b.y + (b.vy || 0) * elapsed,
            };
        }
        renderBullets = next;
    }

    const me = renderPlayers[myId!];
    if (me && !gameOver) {
        cameraX = me.x - cameraCenterX;
        cameraY = me.y - cameraCenterY;
    } else if (gameOver) {
        let panX = 0, panY = 0;
        if (keys["w"] || keys["arrowup"]) panY -= 1;
        if (keys["s"] || keys["arrowdown"]) panY += 1;
        if (keys["a"] || keys["arrowleft"]) panX -= 1;
        if (keys["d"] || keys["arrowright"]) panX += 1;
        cameraX += panX * SPECTATOR_CAM_SPEED;
        cameraY += panY * SPECTATOR_CAM_SPEED;
    }

    mx = screenMx + cameraX;
    my = screenMy + cameraY;

    if (!gameOver && (isMouseShooting || keys[" "])) fireShot();
    if (now - lastInputTime >= INPUT_RATE) {
        sendInput();
        lastInputTime = now;
    }

    tickParticles();

    let dreadnoughtNear = false;
    for (const e of Object.values(renderEnemies)) {
        if (e.shipClass === "dreadnought" && me && Math.hypot(e.x - me.x, e.y - me.y) < 150) {
            dreadnoughtNear = true; break;
        }
    }
    if (dreadnoughtNear && Math.random() < 0.1) playTone(40, 0.1, "sine", 0.02, 35);

    const shake = getScreenShakeOffset(now);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.scale(dpr, dpr);
    ctx.translate(-cameraX - shake.x, -cameraY - shake.y);

    drawBackground();
    drawObjectives(serverZones);
    drawWaveFlash();
    drawBullets(renderBullets);
    drawEnemies(renderEnemies);
    drawPlayers(renderPlayers, myId, mx, my, myShield);
    drawParticles();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

window.addEventListener("click", () => { userInteracted = true; ensureAudio(); }, { once: true });
window.addEventListener("keydown", () => { userInteracted = true; ensureAudio(); }, { once: true });

document.addEventListener("visibilitychange", () => {
    if (document.hidden && audioCtx) {
        audioCtx.suspend().catch(() => { });
    } else if (!document.hidden && audioCtx) {
        audioCtx.resume().catch(() => { });
    }
});

connect();
requestAnimationFrame(gameLoop);
