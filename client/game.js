import { SHIP_PLAYER, SHIP_SCOUT, SHIP_CRUISER_ENEMY, SHIP_CAPITAL } from "./assets/bitmaps.js";
import { SHIP_ATTACHMENTS } from "./assets/attachments.js";
import { createPixelShipRenderer } from "./view/renderer.js";

'use strict';

void SHIP_ATTACHMENTS;
const IS_LOCAL = location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "" ||
    location.protocol === "file:";

const WORKER_WS = IS_LOCAL
    ? "ws://localhost:8787"
    : "wss://speakerdust.soyimposibleyt.workers.dev";
const ROOM_ID = "sala-1";
let userInteracted = false;

// ── Constants ──────────────────────────────────────────────
const CAMERA_SMOOTH = 0.15;
const SHIELD_RADIUS = 28;
const PLAYER_TAG_OFFSET = 30;
const INPUT_RATE = 33;
const MAX_PARTICLES = 420;
const MAX_HP = 5;
const SPECTATOR_CAM_SPEED = 8; // Velocidad de cámara en modo espectador

const COOLDOWN_TABLE = Object.freeze({
    naval_cannon: 1782,
    autocannon: 396,
    plasma_broadside: 2706,
    railgun: 3432,
    torpedo: 3168,
    guided_missile: 2376,
    energy_bomb: 2970,
    emp_launcher: 2508,
});

// ── Quick Chat Messages ─────────────────────────────────
const QUICK_CHAT = [
    "¡Atacad!",
    "Defended la base",
    "Necesito apoyo",
    "Retirada",
    "¡Bien hecho!",
    "Cuidado con el flanco",
    "Esperad mi señal",
    "Voy a por el objetivo",
    "¡Gran trabajo!",
];

// ── Canvas ─────────────────────────────────────────────
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gameCanvas"));
const ctx = canvas.getContext("2d");
const { drawPixelShip } = createPixelShipRenderer(ctx);
let WORLD_W = 1200, WORLD_H = 800;

// ── HUD elements ─────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hudEl = $("hud");
const statusBarEl = $("status-bar");
const weaponDisp = $("weapon-display");
const shieldDisp = $("shield-display");
const scoreDisp = $("score");
const waveNumDisp = $("wave-num");
const playerCountDisp = $("player-count");
const connStatusEl = $("connection-status");
const overlay = $("screen-overlay");
const overlayScore = $("overlay-score");
const restartBtn = $("restart-btn");
const hpDisp = $("hp-display");
const armorDisp = $("armor-display");
const energyDisp = $("energy-display");
const heatDisp = $("heat-display");
const objectiveDisp = $("objective-display");
const teamBadge = $("team-badge");

// ── Visual Effects State ─────────────────────────────────
let shakeX = 0, shakeY = 0, shakeDuration = 0;
const dmgOverlay = document.createElement("div");
dmgOverlay.id = "damage-overlay";
dmgOverlay.style = "pointer-events:none;position:fixed;top:0;left:0;width:100%;height:100%;background:radial-gradient(transparent 60%, rgba(255,0,0,0.5));opacity:0;transition:opacity 0.1s;z-index:100;";
document.body.appendChild(dmgOverlay);

function addScreenShake(intensity, duration) {
    shakeDuration = Math.max(shakeDuration, duration);
    shakeX = Math.max(shakeX, intensity);
    shakeY = Math.max(shakeY, intensity);
}

let lastDamageFlash = 0;
let dmgFlashTimeout = null;
function flashDamageOverlay() {
    const now = performance.now();
    if (now - lastDamageFlash < 200) return;
    lastDamageFlash = now;
    if (dmgFlashTimeout) clearTimeout(dmgFlashTimeout);
    dmgOverlay.style.opacity = "1";
    dmgFlashTimeout = setTimeout(() => { dmgOverlay.style.opacity = "0"; }, 80);
}

// Player ship damage flash
let playerDamageFlashUntil = 0;
function triggerPlayerDamageFlash() {
    playerDamageFlashUntil = performance.now() + 120;
}

// ── Admin panel elements ──────────────────────────────────
const adminPanel = $("admin-panel");
const adminClose = $("admin-close");
const adminAuthForm = $("admin-auth-form");
const adminKeyInput = $("admin-key-input");
const adminAuthBtn = $("admin-auth-btn");
const adminAuthStatus = $("admin-auth-status");
const adminControls = $("admin-controls");
const adminResetAllBtn = $("admin-reset-all-btn");
const adminClearEnemiesBtn = $("admin-clear-enemies-btn");
const adminWaveInput = $("admin-wave-input");
const adminSetWaveBtn = $("admin-set-wave-btn");
const adminJoinRed = $("admin-join-red");
const adminJoinBlue = $("admin-join-blue");
const adminPlayerList = $("admin-player-list");

// ── Audio System ─────────────────────────────────────────
let audioCtx = null;
let masterCompressor = null;
let cachedNoiseBuffer = null;

function getNoiseBuffer(ctxAudio) {
    if (cachedNoiseBuffer) return cachedNoiseBuffer;
    const length = ctxAudio.sampleRate * 2;
    const buffer = ctxAudio.createBuffer(1, length, ctxAudio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    cachedNoiseBuffer = buffer;
    return buffer;
}

function ensureAudio() {
    if (!audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
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

function playTone(freq, duration, type = "sine", gain = 0.06, sweepTo = null) {
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

function playNoise(duration, gain = 0.06) {
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

// ── Haptic Feedback ──────────────────────────────────────
function triggerHaptic(duration = 50, intensity = 0.5) {
    try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (gp && gp.vibrationActuator) {
                gp.vibrationActuator.playEffect("dual-rumble", {
                    duration: duration,
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

// ── True Fullscreen Canvas ───────────────────────────────
function resizeCanvas() {
    const hudH = hudEl?.offsetHeight ?? 0;
    const statH = statusBarEl?.offsetHeight ?? 0;
    const availW = window.innerWidth;
    const availH = window.innerHeight - hudH - statH;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = availW * dpr;
    canvas.height = availH * dpr;
    canvas.style.width = availW + "px";
    canvas.style.height = availH + "px";
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

// ════════════════════════════════════════════════════════
//  PIXEL-ART RENDERER
//  0=transparent 1=hull 2=bridge 3=engine 4=weapon
//  5=trim 6=panel 7=wing-accent 8=window
// ════════════════════════════════════════════════════════
// ── Palettes ──────────────────────────────────────────────
function makePlayerPalette(hsl, team) {
    const [h, s, l] = hsl;
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

const PAL_SCOUT = Object.freeze({
    1: "#b50035", 2: "#ff1c51", 3: "#ffaa00", 4: "#e6004b",
    5: "#ff7093", 6: "#4a0016", 7: "#ff2a5f", 8: "#a0eeff",
});
const PAL_CRUISER_ENEMY = Object.freeze({
    1: "#4a0080", 2: "#8a00cc", 3: "#ffaa00", 4: "#aa00ff",
    5: "#ba66ff", 6: "#1a002b", 7: "#d488ff", 8: "#a0eeff",
});
const PAL_CAPITAL = Object.freeze({
    1: "#12204a", 2: "#2d4bb5", 3: "#ffaa00", 4: "#e62a4a",
    5: "#4272f5", 6: "#070c21", 7: "#5788fa", 8: "#a0eeff",
});
const PAL_FLASH_RED = Object.freeze({
    1: "#ff0000", 2: "#ff5555", 3: "#ffaa00", 4: "#ff0000",
    5: "#aa0000", 6: "#550000", 7: "#ff0000", 8: "#ffffff",
});

// ════════════════════════════════════════════════════════
//  WEAPONS HUD DATA
// ════════════════════════════════════════════════════════
const NAVAL_WEAPON_COLORS = Object.freeze({
    naval_cannon: "#ffd36a",
    autocannon: "#a8ff78",
    plasma_broadside: "#d86bff",
    railgun: "#7df9ff",
    torpedo: "#ff9030",
    guided_missile: "#ff6a3d",
    energy_bomb: "#ffe66d",
    emp_launcher: "#66ccff",
});
const NAVAL_WEAPON_ICONS = Object.freeze({
    naval_cannon: "NAVAL CANNON",
    autocannon: "AUTOCANNON",
    plasma_broadside: "PLASMA BROADSIDE",
    railgun: "RAILGUN",
    torpedo: "TORPEDO",
    guided_missile: "GUIDED MISSILE",
    energy_bomb: "ENERGY BOMB",
    emp_launcher: "EMP LAUNCHER",
});

// ── DOM Helpers ──────────────────────────────────────────
function setDiff(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
}

function renderMeter(value, max, width, filledChar, emptyChar) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeMax = max > 0 ? max : 1;
    const clamped = Math.max(0, Math.min(safeMax, safeValue));
    const filled = Math.round((clamped / safeMax) * width);
    return filledChar.repeat(filled) + emptyChar.repeat(Math.max(0, width - filled));
}

function drawWeaponHUD(weapon) {
    if (!weaponDisp) return;
    const color = NAVAL_WEAPON_COLORS[weapon] || "#fff";
    setDiff(weaponDisp, NAVAL_WEAPON_ICONS[weapon] || weapon || "");
    weaponDisp.style.color = color;
    weaponDisp.style.textShadow = `0 0 10px ${color}`;
}

function drawShieldHUD(shield, shieldMax) {
    if (!shieldDisp) return;
    const sMax = shieldMax || 3;
    setDiff(shieldDisp, "◈".repeat(Math.max(0, shield)) + "◇".repeat(Math.max(0, sMax - shield)));
    shieldDisp.style.color = shield > 1 ? "#4af" : shield === 1 ? "#fa0" : "#f44";
}

function drawHpHUD(hp, maxHp) {
    if (!hpDisp) return;
    const currentMax = maxHp > 0 ? maxHp : MAX_HP;
    setDiff(hpDisp, "◈".repeat(Math.max(0, hp)) + "◇".repeat(Math.max(0, currentMax - hp)));
    hpDisp.style.color = hp > (currentMax * 0.4) ? "#a8ff78" : hp > (currentMax * 0.2) ? "#ffd36a" : "#ff6a7a";
}

function drawEnergyHUD(energy) {
    if (energyDisp) setDiff(energyDisp, renderMeter(energy, 100, 10, "█", "░"));
}

function drawHeatHUD(heat) {
    if (!heatDisp) return;
    setDiff(heatDisp, renderMeter(heat, 100, 10, "█", "░"));
    heatDisp.style.color = heat > 75 ? "#ff6a7a" : heat > 45 ? "#ffb35a" : "#ffd36a";
}

function drawObjectiveHUD(zones) {
    if (!objectiveDisp) return;
    const list = Object.values(zones || {});
    if (!list.length) {
        setDiff(objectiveDisp, "DOMINIO 0/0");
        return;
    }
    const playersOwned = list.filter(z => z.owner === "red" || z.owner === "blue").length;
    const maxProg = (z) => Math.max(z.redProgress || 0, z.blueProgress || 0, z.enemyProgress || 0);
    const focus = list.reduce((best, z) => maxProg(z) > maxProg(best) ? z : best, list[0]);
    const pct = Math.round(maxProg(focus));
    let ownerText = "NEUTRAL";
    if (focus.owner === myTeam) ownerText = "ALLY";
    else if (focus.owner === "red" || focus.owner === "blue") ownerText = "RIVAL";
    else if (focus.owner === "enemies") ownerText = "ENEMY";
    setDiff(objectiveDisp, `CONTROL ${playersOwned}/${list.length} • ${focus.label || "ZONE"} ${pct}% ${ownerText}`);
}

function updateTeamBadge(team) {
    if (!teamBadge) return;
    setDiff(teamBadge, team === "red" ? "◆ RED TEAM" : team === "blue" ? "◆ BLUE TEAM" : "◇ SPECTATOR");
    teamBadge.className = team === "red" ? "team-badge-red" : "team-badge-blue";
}

// ── Audio sounds ──────────────────────────────────────────
function playWeaponSound(weapon) {
    switch (weapon) {
        case "naval_cannon":
        case "railgun":
            playTone(880, 0.04, "square", 0.035, 1360);
            break;
        case "plasma_broadside":
        case "autocannon":
            playTone(620, 0.03, "triangle", 0.028, 740);
            playTone(820, 0.04, "triangle", 0.025, 1040);
            break;
        case "torpedo":
        case "guided_missile":
            playTone(180, 0.12, "sawtooth", 0.04, 90);
            playTone(70, 0.16, "triangle", 0.03, 40);
            break;
        default:
            playTone(880, 0.04, "square", 0.035, 1360);
    }
}

function playImpactSound(strong = false) {
    playNoise(strong ? 0.06 : 0.03, strong ? 0.045 : 0.02);
    playTone(strong ? 260 : 420, strong ? 0.05 : 0.03, "square", strong ? 0.03 : 0.015, strong ? 140 : 260);
}

function playExplosionSound() {
    playNoise(0.16, 0.08);
    playTone(72, 0.18, "sawtooth", 0.04, 35);
}

function playObjectiveSound() {
    playTone(660, 0.05, "triangle", 0.03, 880);
    playTone(990, 0.08, "triangle", 0.03, 1320);
}

// ════════════════════════════════════════════════════════
//  BACKGROUND
// ════════════════════════════════════════════════════════
let stars = [];
const nebOffscreen = document.createElement("canvas");
let nebBuilt = false;

function generateStars() {
    stars = Array.from({ length: 280 }, () => ({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        size: Math.random() < 0.06 ? 2 : 1,
        speed: Math.random() * 0.45 + 0.05,
        alpha: Math.random() * 0.6 + 0.3,
        tw: Math.random() * Math.PI * 2,
        tws: Math.random() * 0.05 + 0.015,
    }));
}

function updateStars() {
    for (const s of stars) {
        s.tw += s.tws;
    }
}

function buildNebulas() {
    nebOffscreen.width = WORLD_W;
    nebOffscreen.height = WORLD_H;
    const nc = nebOffscreen.getContext("2d");
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

function drawBackground() {
    const dpr = window.devicePixelRatio || 1;
    const availW = canvas.width / dpr;
    const availH = canvas.height / dpr;

    ctx.fillStyle = "#02030e";
    ctx.fillRect(cameraX, cameraY, availW, availH);

    ctx.strokeStyle = "rgba(8,15,48,0.5)";
    ctx.lineWidth = 1;
    const startX = Math.floor(cameraX / 48) * 48;
    const startY = Math.floor(cameraY / 48) * 48;
    const endX = cameraX + availW + 48;
    const endY = cameraY + availH + 48;

    for (let x = startX; x < endX; x += 48) {
        ctx.beginPath(); ctx.moveTo(x, cameraY); ctx.lineTo(x, endY); ctx.stroke();
    }
    for (let y = startY; y < endY; y += 48) {
        ctx.beginPath(); ctx.moveTo(cameraX, y); ctx.lineTo(endX, y); ctx.stroke();
    }

    // Estrellas infinitas: envolvemos px/py en un área virtual mayor que el monitor (e.g. 2000px)
    const wrapS = 2000;
    for (const s of stars) {
        let px = ((s.x - cameraX * (s.speed * 1.5)) % wrapS + wrapS) % wrapS;
        let py = ((s.y - cameraY * (s.speed * 1.5)) % wrapS + wrapS) % wrapS;

        if (px > availW || py > availH) continue;

        ctx.globalAlpha = s.alpha * (0.6 + 0.4 * Math.sin(s.tw));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(cameraX + px), Math.round(cameraY + py), s.size, s.size);
    }
    ctx.globalAlpha = 1;
}

function drawObjectives(zones) {
    for (const id in zones) {
        const zone = zones[id];
        const ownerColor = zone.owner === "red" ? "#ff3355"
            : zone.owner === "blue" ? "#3399ff"
                : zone.owner === "enemies" ? "#ff4a88"
                    : "#7f8aa8";
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

        // Progress ring based on stored team progress values
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
        ctx.fillText(zone.label || "ZONA", Math.round(zone.x), Math.round(zone.y - zone.radius - 10));
        ctx.font = "6px 'Press Start 2P', monospace";
        const maxProgress = Math.max(zone.redProgress || 0, zone.blueProgress || 0, zone.enemyProgress || 0);
        ctx.fillText(`${Math.round(maxProgress)}%`, Math.round(zone.x), Math.round(zone.y + zone.radius + 12));
        ctx.restore();
    }
}

// ════════════════════════════════════════════════════════
//  PARTICLES
// ════════════════════════════════════════════════════════
let particles = [];

// Fix: Escala multiplicada correctamente para naves pesadas
function explode(x, y, colors, n, spd = 4.5, scale = 1) {
    const effectiveN = Math.round(n * scale);
    const effectiveSpd = spd * scale;
    for (let i = 0; i < effectiveN; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * effectiveSpd + 0.8;
        particles.push({
            x, y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            sz: Math.floor(Math.random() * 5 + 2),
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 30 + Math.random() * 15,
            maxLife: 45,
        });
    }
}

function tickParticles() {
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.91;
        p.vy *= 0.91;
        p.life--;
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        const s = Math.max(1, Math.ceil(p.sz * (p.life / p.maxLife)));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    ctx.globalAlpha = 1;
}

// ════════════════════════════════════════════════════════
//  DRAW – BULLETS
// ════════════════════════════════════════════════════════
function drawBullets(bullets) {
    for (const id in bullets) {
        const b = bullets[id];
        const margin = 150;
        const dpr = window.devicePixelRatio || 1;
        const viewW = canvas.width / dpr;
        const viewH = canvas.height / dpr;

        // Frustum Culling dinámico de balas
        if (b.x < cameraX - margin || b.y < cameraY - margin ||
            b.x > cameraX + viewW + margin || b.y > cameraY + viewH + margin) {
            continue;
        }

        const a = b.angle !== undefined ? b.angle : Math.atan2(b.vy, b.vx);
        const bx = Math.round(b.x);
        const by = Math.round(b.y);

        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(a + Math.PI / 2);

        const kind = b.kind;
        if (kind === "naval_cannon") {
            ctx.shadowBlur = 14; ctx.shadowColor = "#ffd36a";
            ctx.fillStyle = "#ffb35a"; ctx.fillRect(-4, -4, 8, 8);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#ffd36a"; ctx.fillRect(-7, -7, 14, 14);
        } else if (kind === "autocannon") {
            ctx.shadowBlur = 8; ctx.shadowColor = "#a8ff78";
            ctx.fillStyle = "#ccffaa"; ctx.fillRect(-1, -5, 3, 10);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#a8ff78"; ctx.fillRect(-3, -7, 7, 14);
        } else if (kind === "plasma_broadside") {
            ctx.shadowBlur = 10; ctx.shadowColor = "#cc00ff";
            ctx.fillStyle = "#dd66ff"; ctx.fillRect(-3, -3, 6, 6);
            ctx.globalAlpha = 0.4; ctx.fillStyle = "#aa00ff"; ctx.fillRect(-5, -5, 10, 10);
        } else if (kind === "railgun") {
            ctx.shadowBlur = 10; ctx.shadowColor = "#00e5ff";
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-1, -12, 3, 24);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#00e5ff"; ctx.fillRect(-3, -15, 7, 30);
        } else if (kind === "torpedo") {
            ctx.shadowBlur = 8; ctx.shadowColor = "#ff9030";
            ctx.fillStyle = "#ffaa00"; ctx.fillRect(-3, 12, 6, 4);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-2, 12, 4, 2);
            ctx.fillStyle = "#333333"; ctx.fillRect(-5, 6, 10, 6);
            ctx.fillStyle = "#aaaaaa"; ctx.fillRect(-4, -6, 8, 12);
            ctx.fillStyle = "#ff4444"; ctx.fillRect(-3, -12, 6, 6);
            ctx.fillRect(-2, -14, 4, 2);
        } else if (kind === "guided_missile") {
            ctx.shadowBlur = 4; ctx.shadowColor = "#ff6a3d";
            ctx.fillStyle = "#ffaa00"; ctx.fillRect(-2, 9, 4, 3);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-1, 9, 2, 1);
            ctx.fillStyle = "#888888"; ctx.fillRect(-3, 4, 6, 5);
            ctx.fillStyle = "#cccccc"; ctx.fillRect(-2, -4, 4, 8);
            ctx.fillStyle = "#555555"; ctx.fillRect(-4, 2, 2, 4);
            ctx.fillStyle = "#555555"; ctx.fillRect(2, 2, 2, 4);
            ctx.fillStyle = "#ff4444"; ctx.fillRect(-2, -8, 4, 4);
            ctx.fillRect(-1, -10, 2, 2);
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

// ════════════════════════════════════════════════════════
//  DRAW – ENEMIES & ENGINE TRAILS
// ════════════════════════════════════════════════════════
function drawEngineTrail(x, y, angle, isHeavy, isMedium, color) {
    const mx = -Math.cos(angle);
    const my = -Math.sin(angle);

    const dist = isHeavy ? 32 : isMedium ? 20 : 10;
    const spread = isHeavy ? 12 : isMedium ? 6 : 0;

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    const len = isHeavy ? 12 : 8;
    for (let i = 0; i < len; i++) {
        const t = i / len;
        const pulse = Math.sin(performance.now() * 0.015 + i) * 2;

        const baseX = x + mx * (dist + i * 5 + pulse);
        const baseY = y + my * (dist + i * 5 + pulse);
        const jitter = (Math.random() - 0.5) * (i * 1.5);

        const renderTrailPoint = (offsetX, offsetY) => {
            const ex = baseX + offsetX + jitter;
            const ey = baseY + offsetY + jitter;
            ctx.globalAlpha = (1 - t) * 0.7;
            ctx.fillStyle = i < 2 ? "#ffffff" : color;
            const sz = Math.max(1, Math.floor((1 - t) * (isHeavy ? 6 : 4)));
            ctx.fillRect(Math.round(ex), Math.round(ey), sz, sz);
        };

        if (isHeavy) {
            renderTrailPoint(0, 0);
            renderTrailPoint(-my * spread, mx * spread);
            renderTrailPoint(my * spread, -mx * spread);
        } else if (isMedium) {
            renderTrailPoint(-my * spread, mx * spread);
            renderTrailPoint(my * spread, -mx * spread);
        } else {
            renderTrailPoint(0, 0);
        }
    }
    ctx.restore();
}

function drawEnemies(enemies) {
    for (const id in enemies) {
        const e = enemies[id];
        const ps = 3;
        const kind = e.kind || "corvette";
        const isHeavy = kind === "battleship" || kind === "dreadnought";
        const isMedium = kind === "frigate" || kind === "cruiser";
        const glowC = isHeavy ? "#4466ff" : isMedium ? "#cc00ff" : "#ff2060";
        const ship = isHeavy ? SHIP_CAPITAL : isMedium ? SHIP_CRUISER_ENEMY : SHIP_SCOUT;
        const pal = isHeavy ? PAL_CAPITAL : isMedium ? PAL_CRUISER_ENEMY : PAL_SCOUT;

        drawEngineTrail(e.x, e.y, e.angle, isHeavy, isMedium, glowC);

        ctx.shadowBlur = isHeavy ? 22 : 14;
        ctx.shadowColor = glowC;
        drawPixelShip(ship, e.x, e.y, e.angle, pal, ps);
        ctx.shadowBlur = 0;

        const maxHpSafe = e.maxHp > 0 ? e.maxHp : 10;
        const pct = Math.max(0, Math.min(1, e.hp / maxHpSafe));
        const bw = isHeavy ? 44 : isMedium ? 32 : 22;
        const bh = 3, bx = Math.round(e.x - bw / 2), by = Math.round(e.y - (isHeavy ? 40 : 30));
        ctx.fillStyle = "#220000"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = pct > 0.6 ? glowC : pct > 0.3 ? "#ffaa00" : "#ff2020";
        ctx.fillRect(bx, by, Math.round(bw * pct), bh);
    }
}

// ════════════════════════════════════════════════════════
//  DRAW – PLAYERS
// ════════════════════════════════════════════════════════
function parseHSL(hsl) {
    const m = hsl.match(/[\d.]+/g);
    return m ? m.map(Number) : [180, 80, 60];
}

function drawPlayers(players, myId, mx, my, myShield) {
    for (const id in players) {
        const p = players[id];
        if (!p.alive) continue;
        const isMe = id === myId;
        const hsl = parseHSL(p.color ?? "hsl(180,80%,60%)");

        let pal = makePlayerPalette(hsl, p.team);
        // Hit flash animation
        if (isMe && performance.now() < playerDamageFlashUntil) {
            pal = PAL_FLASH_RED;
        }

        const teamGlow = p.team === "red" ? "#ff3355" : p.team === "blue" ? "#3399ff" : (p.color ?? "#ffffff");

        ctx.shadowBlur = isMe ? 22 : 14;
        ctx.shadowColor = teamGlow;
        drawPixelShip(SHIP_PLAYER, p.x, p.y, p.angle, pal, isMe ? 3 : 2);
        ctx.shadowBlur = 0;

        if (isMe) {
            // Estela con color de equipo
            const trailColor = myTeam === "red" ? "#ff5500" : (myTeam === "blue" ? "#00aaff" : "#ffffff");
            drawEngineTrail(p.x, p.y, p.angle, false, false, trailColor);

            if (keys["shift"] || (serverPlayers[myId]?.boostCooldown > 0)) {
                const mx_boost = -Math.cos(p.angle);
                const my_boost = -Math.sin(p.angle);
                for (let i = 0; i < 6; i++) {
                    const ex = p.x + mx_boost * (18 + i * 4) + (Math.random() - 0.5) * 5;
                    const ey = p.y + my_boost * (18 + i * 4) + (Math.random() - 0.5) * 5;
                    ctx.globalAlpha = 0.7;
                    ctx.fillStyle = "#00ccff";
                    ctx.fillRect(Math.round(ex), Math.round(ey), 3, 3);
                }
                ctx.globalAlpha = 1;
            }
        }

        if (isMe && myShield > 0) {
            ctx.strokeStyle = `rgba(68,170,255,${0.15 + myShield * 0.12})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(Math.round(p.x), Math.round(p.y), 28, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Draw HUD local elements (only if playing)
        if (isMe && !gameOver) {
            // Crosshair
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

            // Reload Indicator
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
                : p.team === "blue" ? "rgba(100,180,255,0.7)"
                    : "rgba(200,220,255,0.5)";
        const tagY = Math.round(p.y - (isMe ? 42 : 30));
        if (p.name) ctx.fillText(p.name.slice(0, 8), Math.round(p.x), tagY - 8);
        ctx.fillText(`${p.score ?? 0}`, Math.round(p.x), tagY);
    }
}

// ════════════════════════════════════════════════════════
//  WAVE FLASH
// ════════════════════════════════════════════════════════
let waveFlash = 0;
function drawWaveFlash() {
    if (waveFlash <= 0) return;
    ctx.globalAlpha = (waveFlash / 50) * 0.3;
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = 1;
    waveFlash--;
}

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════
let myId = null;
let myTeam = "red";
let myWeapon = "naval_cannon";
let myShield = 3;
let myHp = MAX_HP;
let myMaxShield = 3;
let myMaxHp = MAX_HP;
let myBoostEnergy = 100;
let myHeat = 0;
let gameOver = false;
let score = 0;
let currentWave = 1;
let serverPlayers = {};
let serverBullets = {};
let serverEnemies = {};
let serverZones = {};

let cameraX = 0, cameraY = 0;
let screenMx = window.innerWidth / 2, screenMy = window.innerHeight / 2;

let renderPlayers = {};
let renderEnemies = {};
let renderBullets = {};

// ── Interpolation helpers ─────────────────────────────────
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

function lerpAngle(a, b, amt) {
    let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return a + delta * amt;
}

function syncRenderState(renderMap, serverMap, isAngle = false) {
    for (const id in serverMap) {
        const s = serverMap[id];
        if (!renderMap[id]) {
            renderMap[id] = { ...s };
        } else {
            const r = renderMap[id];
            r.x = lerp(r.x, s.x, 0.45);
            r.y = lerp(r.y, s.y, 0.45);
            if (isAngle && s.angle !== undefined) {
                r.angle = lerpAngle(r.angle || 0, s.angle, 0.4);
            }
            else if (s.angle !== undefined) {
                r.angle = s.angle;
            }

            r.hp = s.hp; r.maxHp = s.maxHp; r.shield = s.shield; r.score = s.score;
            r.color = s.color; r.kind = s.kind; r.alive = s.alive;
            r.team = s.team; r.name = s.name;
            r.vx = s.vx; r.vy = s.vy; r.radius = s.radius;
        }
    }
    for (const id in renderMap) {
        if (!serverMap[id]) delete renderMap[id];
    }
}

// ════════════════════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════════════════════
const keys = {};
let isMouseShooting = false;

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;

    // Quick chat (1-9)
    if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < QUICK_CHAT.length) {
            send("chat", { text: QUICK_CHAT[idx] });
        }
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
        // Show cursor when admin panel visible
        canvas.style.cursor = adminPanel?.classList.contains("hidden") ? "none" : "default";
    }
});
window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    isMouseShooting = false;
});

let mx = WORLD_W / 2, my = WORLD_H / 2;
canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    screenMx = e.clientX - r.left;
    screenMy = e.clientY - r.top;
});
canvas.addEventListener("mousedown", e => {
    if (e.button === 0 && !gameOver) {
        isMouseShooting = true;
        fireShot();
    } else if (e.button === 2) {
        e.preventDefault();
        sendBoost();
    }
});
window.addEventListener("mouseup", e => { if (e.button === 0) isMouseShooting = false; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

let lastShot = 0;
function fireShot() {
    const now = performance.now();
    const cd = COOLDOWN_TABLE[myWeapon] ?? 200;
    if (now - lastShot < cd || gameOver) return;
    lastShot = now;
    ensureAudio();
    playWeaponSound(myWeapon);
    send("shoot");
}

function sendBoost() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver || myBoostEnergy < 28) return;
    ensureAudio();
    playTone(180, 0.08, "square", 0.04, 90);
    send("boost");
}

// ════════════════════════════════════════════════════════
//  ADMIN PANEL LOGIC
// ════════════════════════════════════════════════════════
adminClose?.addEventListener("click", () => {
    adminPanel?.classList.add("hidden");
    canvas.style.cursor = "none";
});
adminAuthForm?.addEventListener("submit", (e) => {
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

function refreshAdminPlayerList() {
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

// ════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════
let socket;
let isAdmin = false;
let lastHitSoundTime = 0;

function send(type, payload = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type, ...payload }));
}

function connect() {
    setStatus("connecting");
    try {
        socket = new WebSocket(`${WORKER_WS}/room/${ROOM_ID}`);
    } catch (e) {
        setStatus("disconnected");
        setTimeout(connect, 3000);
        return;
    }
    socket.addEventListener("open", () => setStatus("connected"));
    socket.addEventListener("message", e => handleMsg(JSON.parse(e.data)));
    socket.addEventListener("close", () => {
        setStatus("disconnected");
        setTimeout(connect, 2500);
    });
    socket.addEventListener("error", () => setStatus("disconnected"));
}

const msgHandlers = {
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
        const me = serverPlayers[myId];
        if (me) {
            score = me.score;
            myShield = me.shield ?? myShield;
            myMaxShield = me.shieldMax ?? 3;
            myHp = me.hp ?? myHp;
            myMaxHp = me.maxHp ?? myMaxHp;
            myBoostEnergy = me.boostEnergy ?? myBoostEnergy;
            myHeat = me.weaponHeat ?? myHeat;

            // Fix: Resurrection logic on reconnect
            if (gameOver && me.alive) {
                gameOver = false;
                if (overlay) {
                    overlay.classList.add("hidden");
                    overlay.style.pointerEvents = "auto";
                }
                lastShot = 0; particles = [];
            }
            if (!me.alive && !gameOver) {
                gameOver = true;
                showGameOver();
            }
        }
        updateHUD();
    },
    tick(msg) {
        serverPlayers = msg.players;
        serverBullets = Object.assign({}, msg.bullets, msg.enemyBullets || {});
        serverEnemies = msg.enemies;
        if (msg.zones) serverZones = msg.zones;
        currentWave = msg.wave;
        const me = serverPlayers[myId];
        if (me) {
            score = me.score;
            myShield = me.shield ?? myShield;
            myMaxShield = me.shieldMax ?? 3;
            myHp = me.hp ?? myHp;
            myMaxHp = me.maxHp ?? myMaxHp;
            myBoostEnergy = me.boostEnergy ?? myBoostEnergy;
            myHeat = me.weaponHeat ?? myHeat;

            if (gameOver && me.alive) {
                gameOver = false;
                if (overlay) {
                    overlay.classList.add("hidden");
                    overlay.style.pointerEvents = "auto";
                }
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
    weapon_changed(msg) {
        myWeapon = msg.weapon;
        lastShot = 0;
        drawWeaponHUD(myWeapon);
    },
    explosion(msg) {
        playExplosionSound();
        const scale = msg.kind === "dreadnought" ? 2.5 : msg.kind === "battleship" ? 1.8 : 1.0;
        if (msg.kind === "battleship" || msg.kind === "dreadnought") {
            explode(msg.x, msg.y, ["#ffcc00", "#ff6600", "#ffffff", "#4466ff"], 40, 7, scale);
            explode(msg.x, msg.y, ["#ff4400", "#ff9900"], 20, 3, 1);
            addScreenShake(8, 10);
            setTimeout(() => {
                explode(msg.x, msg.y, ["#ff4400", "#ff9900", "#ffff00", "#ffffff"], 60, 5, scale);
            }, 150);
        } else if (msg.kind === "frigate" || msg.kind === "cruiser") {
            explode(msg.x, msg.y, ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], 24, 5, scale);
        } else {
            explode(msg.x, msg.y, ["#ff2060", "#ffaa20", "#ffffff"], 16, 4, scale);
        }

        // Extra shake and heavy sound if near player
        const me = serverPlayers[myId];
        if (me && me.alive && Math.hypot(msg.x - me.x, msg.y - me.y) < 200) {
            addScreenShake(6, 8);
            playImpactSound(true);
            triggerHaptic(100, 0.8);
        }
    },
    hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) {
            playImpactSound(false);
            lastHitSoundTime = now;
        }
        explode(msg.x, msg.y, ["#ffffff", "#ffdd88"], 6, 2);

        // Minor haptic
        const me = serverPlayers[myId];
        if (me && Math.hypot(msg.x - me.x, msg.y - me.y) < 100) {
            if (msg.weapon === "railgun") addScreenShake(3, 5);
            if (msg.playerId === myId) {
                triggerHaptic(30, 0.3);
                flashDamageOverlay();
                triggerPlayerDamageFlash();
            }
        }
    },
    shield_hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) {
            playImpactSound(msg.reason === "impact");
            lastHitSoundTime = now;
        }

        if (msg.playerId === myId) {
            triggerHaptic(40, 0.5);
            myShield = Math.max(0, myShield - 1);
            drawShieldHUD(myShield, myMaxShield);
            flashDamageOverlay();
            triggerPlayerDamageFlash();
            const p = serverPlayers[myId];
            if (p) explode(p.x, p.y, ["#4488ff", "#aaccff"], 8, 2);
        }
    },
    player_dead(msg) {
        playExplosionSound();
        triggerHaptic(150, 1.0);
        explode(msg.x, msg.y, ["#00e5ff", "#ffffff", "#0088ff"], 30, 6);
        if (msg.playerId === myId) {
            gameOver = true;
            showGameOver();
        }
    },
    player_team(msg) {
        if (serverPlayers[msg.playerId]) serverPlayers[msg.playerId].team = msg.team;
        if (msg.playerId === myId) {
            myTeam = msg.team;
            updateTeamBadge(myTeam);
        }
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
        // Fix: Map single progress to appropriate team field dynamically
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
    }
};

function handleMsg(msg) {
    const handler = msgHandlers[msg.type];
    if (handler) handler(msg);
}

// ── Input → Server ────────────────────────────────────────
let lastInputTime = 0;
let lastInputState = { forward: 0, strafe: 0, angle: 0 };

function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;
    let forward = 0, strafe = 0;
    if (keys["w"] || keys["arrowup"]) forward += 1;
    if (keys["s"] || keys["arrowdown"]) forward -= 1;
    if (keys["a"] || keys["arrowleft"]) strafe -= 1;
    if (keys["d"] || keys["arrowright"]) strafe += 1;
    const p = serverPlayers[myId];
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

// ════════════════════════════════════════════════════════
//  HUD UPDATE
// ════════════════════════════════════════════════════════
function updateHUD() {
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

function setStatus(s) {
    if (!connStatusEl) return;
    const map = {
        connecting: ["status-connecting", "◆ CONNECTING..."],
        connected: ["status-connected", "◆ CONNECTED"],
        disconnected: ["status-disconnected", "◆ DISCONNECTED"],
    };
    const [cls, text] = map[s] || map.disconnected;
    connStatusEl.className = cls;
    setDiff(connStatusEl, text);
}

function showGameOver() {
    if (overlay) {
        overlay.classList.remove("hidden");
        overlay.style.background = "rgba(0,0,0,0.4)";
        overlay.style.pointerEvents = "auto";
    }
    document.body.style.cursor = "default";
    canvas.style.cursor = "default";
    if (restartBtn) {
        restartBtn.style.pointerEvents = "auto";
    }
    if (overlayScore) {
        setDiff(overlayScore, `PUNTOS: ${String(score || 0).padStart(6, "0")}\nMODO ESPECTADOR (WASD)`);
    }
}

// Respawn button now sends a respawn command instead of reconnecting
restartBtn?.addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        send("respawn");
    }
    updateHUD();

    if (overlay) {
        overlay.classList.add("hidden");
        overlay.style.pointerEvents = "none";
    }
    document.body.style.cursor = "none";
    canvas.style.cursor = "none";
    gameOver = false;
    lastShot = 0;
    particles = [];
    myWeapon = "naval_cannon";
    myShield = myMaxShield;
    myHp = myMaxHp;
    myBoostEnergy = 100;
    myHeat = 0;
    isMouseShooting = false;
    for (const k in keys) keys[k] = false;
});

// ── Tutorial overlay (first visit) ───────────────────────
(function initTutorial() {
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

// ════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════
generateStars();
canvas.style.cursor = "none"; // Ocultar cursor en juego

function gameLoop(now) {
    requestAnimationFrame(gameLoop);

    updateStars();

    const dpr = window.devicePixelRatio || 1;
    const availW = canvas.width / dpr;
    const availH = canvas.height / dpr;

    // Camera logic (Includes Soft clamp to world bounds & Spectator Mode)
    const me = renderPlayers[myId];
    if (me && !gameOver) {
        let targetCamX = me.x - availW / 2;
        let targetCamY = me.y - availH / 2;

        cameraX = lerp(cameraX, targetCamX, CAMERA_SMOOTH);
        cameraY = lerp(cameraY, targetCamY, CAMERA_SMOOTH);
    } else if (gameOver) {
        // Free camera in spectator mode
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

    syncRenderState(renderPlayers, serverPlayers, true);
    syncRenderState(renderEnemies, serverEnemies, true);

    // Render local reference to bullets (avoids spread operator overhead per frame)
    renderBullets = serverBullets;

    tickParticles();

    let dreadnoughtNear = false;
    for (const e of Object.values(renderEnemies)) {
        if (e.kind === "dreadnought" && me && Math.hypot(e.x - me.x, e.y - me.y) < 150) {
            dreadnoughtNear = true; break;
        }
    }
    if (dreadnoughtNear && Math.random() < 0.1) playTone(40, 0.1, "sine", 0.02, 35);

    if (shakeDuration > 0) {
        const sx = (Math.random() - 0.5) * shakeX * (shakeDuration / 12);
        const sy = (Math.random() - 0.5) * shakeY * (shakeDuration / 12);
        cameraX += sx; cameraY += sy;
        shakeDuration--;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.scale(dpr, dpr);
    ctx.translate(-Math.round(cameraX), -Math.round(cameraY));

    drawBackground();
    drawObjectives(serverZones);
    drawWaveFlash();
    drawBullets(renderBullets);
    drawEnemies(renderEnemies);
    drawPlayers(renderPlayers, myId, mx, my, myShield);
    drawParticles();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Ensure interactions initialize audio gracefully
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
