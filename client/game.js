'use strict';

// ════════════════════════════════════════════════════════
//  SPEAKERDUST — Space Warfare Client  (v3 · fullscreen + teams + admin)
// ════════════════════════════════════════════════════════

const IS_LOCAL = location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "" ||
    location.protocol === "file:";

const WORKER_WS = IS_LOCAL
    ? "ws://localhost:8787"
    : "wss://speakerdust.soyimposibleyt.workers.dev";
const ROOM_ID = "sala-1";

// ── Constants ──────────────────────────────────────────────
const CAMERA_SMOOTH = 0.15;
const SHIELD_RADIUS = 28;
const PLAYER_TAG_OFFSET = 30;
const INPUT_RATE = 33;
const MAX_PARTICLES = 420;
const MAX_HP = 5;

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

// ── Canvas ─────────────────────────────────────────────
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gameCanvas"));
const ctx = canvas.getContext("2d");
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
function flashDamageOverlay() {
    const now = performance.now();
    if (now - lastDamageFlash < 200) return; // Previene ceguera por spam de hits
    lastDamageFlash = now;
    dmgOverlay.style.opacity = "1";
    setTimeout(() => { dmgOverlay.style.opacity = "0"; }, 80);
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
const shipCache = new Map();

function getCachedShip(grid, pal, ps) {
    const key = grid.length + "_" + grid[0].length + "_" + (pal[1] || "") + "_" + ps;
    if (shipCache.has(key)) return shipCache.get(key);
    const rows = grid.length, cols = grid[0].length;
    const oc = document.createElement("canvas");
    oc.width = cols * ps; oc.height = rows * ps;
    const octx = oc.getContext("2d");
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const v = grid[r][c];
            if (!v || !pal[v]) continue;
            octx.fillStyle = pal[v];
            octx.fillRect(c * ps, r * ps, ps, ps);
        }
    }
    const cached = { canvas: oc, cx: oc.width / 2, cy: oc.height / 2 };
    shipCache.set(key, cached);
    return cached;
}

function drawPixelShip(grid, cx, cy, angle, pal, ps) {
    const cached = getCachedShip(grid, pal, ps);
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(angle + Math.PI / 2);
    ctx.drawImage(cached.canvas, -Math.floor(cached.cx), -Math.floor(cached.cy));
    ctx.restore();
}

// ════════════════════════════════════════════════════════
//  SHIP BITMAPS
// ════════════════════════════════════════════════════════
const SHIP_PLAYER = [
    [0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 8, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 8, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 2, 2, 2, 1, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 4, 0, 1, 5, 6, 6, 6, 5, 1, 0, 4, 0],
    [0, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 0],
    [4, 7, 1, 5, 5, 2, 8, 2, 5, 5, 1, 7, 4],
    [4, 7, 1, 1, 1, 2, 2, 2, 1, 1, 1, 7, 4],
    [0, 4, 1, 6, 1, 1, 1, 1, 1, 6, 1, 4, 0],
    [0, 0, 4, 1, 1, 5, 5, 5, 1, 1, 4, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 4, 1, 6, 6, 6, 1, 4, 0, 0, 0],
    [0, 0, 0, 4, 4, 1, 1, 1, 4, 4, 0, 0, 0],
    [0, 0, 0, 0, 3, 3, 1, 3, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 3, 0, 3, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
];

const SHIP_SCOUT = [
    [0, 0, 0, 0, 2, 0, 0, 0, 0],
    [0, 0, 0, 1, 8, 1, 0, 0, 0],
    [0, 0, 4, 1, 2, 1, 4, 0, 0],
    [0, 4, 4, 1, 1, 1, 4, 4, 0],
    [4, 4, 1, 5, 6, 5, 1, 4, 4],
    [4, 1, 1, 1, 1, 1, 1, 1, 4],
    [0, 1, 6, 1, 2, 1, 6, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 1, 1, 1, 3, 0, 0],
    [0, 0, 0, 3, 0, 3, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
];

const SHIP_CRUISER_ENEMY = [
    [0, 0, 0, 0, 4, 2, 4, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 4, 4, 8, 4, 4, 0, 0, 0, 0, 0],
    [0, 0, 4, 4, 1, 1, 1, 4, 4, 0, 0, 0, 0],
    [0, 4, 4, 1, 5, 6, 5, 1, 4, 4, 0, 0, 0],
    [4, 4, 1, 1, 1, 1, 1, 1, 1, 4, 4, 0, 0],
    [4, 1, 1, 6, 1, 2, 1, 6, 1, 1, 4, 0, 0],
    [4, 1, 5, 1, 1, 8, 1, 1, 5, 1, 4, 0, 0],
    [4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 0, 0],
    [0, 4, 1, 5, 6, 1, 6, 5, 1, 4, 0, 0, 0],
    [0, 0, 4, 1, 1, 1, 1, 1, 4, 0, 0, 0, 0],
    [0, 0, 0, 4, 1, 1, 1, 4, 0, 0, 0, 0, 0],
    [0, 0, 0, 3, 3, 1, 3, 3, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 3, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
];

const SHIP_CAPITAL = [
    [0, 0, 0, 0, 0, 0, 0, 4, 2, 4, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 4, 4, 8, 4, 4, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 4, 4, 1, 1, 1, 4, 4, 0, 0, 0, 0, 0],
    [0, 0, 0, 4, 4, 4, 1, 5, 6, 5, 1, 4, 4, 4, 0, 0, 0],
    [0, 0, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 0, 0],
    [0, 4, 4, 1, 1, 5, 1, 2, 8, 2, 1, 5, 1, 1, 4, 4, 0],
    [4, 4, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 4, 4],
    [4, 1, 1, 5, 1, 6, 1, 1, 1, 1, 1, 6, 1, 5, 1, 1, 4],
    [4, 7, 1, 1, 1, 1, 1, 6, 8, 6, 1, 1, 1, 1, 1, 7, 4],
    [4, 7, 1, 6, 1, 5, 1, 1, 1, 1, 1, 5, 1, 6, 1, 7, 4],
    [4, 7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 7, 4],
    [4, 1, 1, 5, 1, 6, 1, 5, 5, 5, 1, 6, 1, 5, 1, 1, 4],
    [0, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 0],
    [0, 0, 4, 4, 1, 5, 1, 6, 6, 6, 1, 5, 1, 4, 4, 0, 0],
    [0, 0, 0, 4, 4, 1, 1, 1, 1, 1, 1, 1, 4, 4, 0, 0, 0],
    [0, 0, 0, 0, 4, 4, 3, 3, 1, 3, 3, 4, 4, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 3, 3, 0, 3, 0, 3, 3, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

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
    weaponDisp.textContent = NAVAL_WEAPON_ICONS[weapon] || weapon || "";
    weaponDisp.style.color = color;
    weaponDisp.style.textShadow = `0 0 10px ${color}`;
}

function drawShieldHUD(shield) {
    if (!shieldDisp) return;
    setDiff(shieldDisp, "◈".repeat(Math.max(0, shield)) + "◇".repeat(Math.max(0, 3 - shield)));
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
        objectiveDisp.textContent = "DOMINIO 0/0";
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
        s.y = (s.y + s.speed) % WORLD_H;
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
    ctx.fillStyle = "#02030e";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    if (!nebBuilt) buildNebulas();
    ctx.drawImage(nebOffscreen, 0, 0);

    ctx.strokeStyle = "rgba(8,15,48,0.5)";
    ctx.lineWidth = 1;
    for (let x = 0; x < WORLD_W; x += 48) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y < WORLD_H; y += 48) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    for (const s of stars) {
        ctx.globalAlpha = s.alpha * (0.65 + 0.35 * Math.sin(s.tw));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
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

        // Allied/Local Progress Ring
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

function explode(x, y, colors, n, spd = 4.5) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * spd + 0.8;
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
        if (b.x < -120 || b.y < -120 || b.x > WORLD_W + 120 || b.y > WORLD_H + 120) continue;
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
    const len = isHeavy ? 10 : 6;
    const dist = isHeavy ? 35 : isMedium ? 22 : 12;

    ctx.save();
    ctx.globalCompositeOperation = "screen"; // Hace que las partículas brillen como energía/fuego
    for (let i = 0; i < len; i++) {
        const t = i / len;
        // Animación suave usando performance.now()
        const pulse = Math.sin(performance.now() * 0.01 + i) * 1.5;
        const ex = x + mx * (dist + i * 4 + pulse) + (Math.random() - 0.5) * (isHeavy ? 6 : 3);
        const ey = y + my * (dist + i * 4 + pulse) + (Math.random() - 0.5) * (isHeavy ? 6 : 3);
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.fillStyle = i < 2 ? "#ffffff" : color;
        const sz = Math.max(1, Math.floor((1 - t) * (isHeavy ? 6 : 4)));
        ctx.fillRect(Math.round(ex), Math.round(ey), sz, sz);
    }
    ctx.restore();
}

function drawEnemies(enemies) {
    for (const id in enemies) {
        const e = enemies[id];
        const ps = 3;
        const isHeavy = e.kind === "battleship" || e.kind === "dreadnought";
        const isMedium = e.kind === "frigate" || e.kind === "cruiser";
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
        const pal = makePlayerPalette(hsl, p.team);
        const teamGlow = p.team === "red" ? "#ff3355" : p.team === "blue" ? "#3399ff" : (p.color ?? "#ffffff");

        ctx.shadowBlur = isMe ? 22 : 14;
        ctx.shadowColor = teamGlow;
        drawPixelShip(SHIP_PLAYER, p.x, p.y, p.angle, pal, isMe ? 3 : 2);
        ctx.shadowBlur = 0;

        if (isMe) {
            drawEngineTrail(p.x, p.y, p.angle, false, false, "#ff4400");

            // Spectatular Boost Trail
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

        // Shield ring
        if (isMe && myShield > 0) {
            ctx.strokeStyle = `rgba(68,170,255,${0.15 + myShield * 0.12})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(Math.round(p.x), Math.round(p.y), 28, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Aim line + crosshair (only for self)
        if (isMe) {
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
        }

        // Name + score tag
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
                r.angle = lerpAngle(r.angle || 0, s.angle, 0.35);
            }
            if (s.angle !== undefined && !isAngle) r.angle = s.angle;
            r.hp = s.hp; r.maxHp = s.maxHp; r.shield = s.shield; r.score = s.score;
            r.color = s.color; r.kind = s.kind; r.alive = s.alive;
            r.team = s.team; r.name = s.name;
            r.vx = s.vx; r.vy = s.vy; r.radius = s.radius;
            if (s.angle !== undefined && r.kind !== undefined) {
                r.angle = lerpAngle(r.angle || 0, s.angle, 0.4);
            }
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
    if (e.button === 0) {
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
adminClose?.addEventListener("click", () => adminPanel?.classList.add("hidden"));
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
            resizeCanvas(); generateStars(); nebBuilt = false; buildNebulas();
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
            myHp = me.hp ?? myHp;
            myMaxHp = me.maxHp ?? myMaxHp;
            myBoostEnergy = me.boostEnergy ?? myBoostEnergy;
            myHeat = me.weaponHeat ?? myHeat;
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
            myHp = me.hp ?? myHp;
            myMaxHp = me.maxHp ?? myMaxHp;
            myBoostEnergy = me.boostEnergy ?? myBoostEnergy;
            myHeat = me.weaponHeat ?? myHeat;
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
            myShield = 3; myHp = MAX_HP; myBoostEnergy = 100; myHeat = 0;
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
        if (msg.kind === "battleship" || msg.kind === "dreadnought") {
            explode(msg.x, msg.y, ["#ffcc00", "#ff6600", "#ffffff", "#4466ff"], 36, 6);
            explode(msg.x, msg.y, ["#ff4400", "#ff9900"], 20, 3);
            addScreenShake(8, 10);
            setTimeout(() => {
                explode(msg.x, msg.y, ["#ff4400", "#ff9900", "#ffff00", "#ffffff"], 50, 4);
            }, 150);
        } else if (msg.kind === "frigate" || msg.kind === "cruiser") {
            explode(msg.x, msg.y, ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], 24, 5);
        } else {
            explode(msg.x, msg.y, ["#ff2060", "#ffaa20", "#ffffff"], 16, 4);
        }
    },
    hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) {
            playImpactSound(false);
            lastHitSoundTime = now;
        }
        explode(msg.x, msg.y, ["#ffffff", "#ffdd88"], 6, 2);

        const me = serverPlayers[myId];
        if (me && Math.hypot(msg.x - me.x, msg.y - me.y) < 100) {
            if (msg.weapon === "railgun") addScreenShake(3, 5);
            if (msg.playerId === myId) flashDamageOverlay();
        }
    },
    shield_hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) {
            playImpactSound(msg.reason === "impact");
            lastHitSoundTime = now;
        }

        if (msg.playerId === myId) {
            myShield = Math.max(0, myShield - 1);
            drawShieldHUD(myShield);
            flashDamageOverlay();
            const p = serverPlayers[myId];
            if (p) explode(p.x, p.y, ["#4488ff", "#aaccff"], 8, 2);
        }
    },
    player_dead(msg) {
        playExplosionSound();
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
        myShield = 3; myHp = MAX_HP; myBoostEnergy = 100; myHeat = 0;
        updateHUD();
    },
    objective(msg) {
        serverZones[msg.zoneId] = {
            ...(serverZones[msg.zoneId] || {}),
            id: msg.zoneId,
            owner: msg.owner,
            progress: msg.progress,
            label: msg.label || msg.zoneId,
        };
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
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff; // Fix de salto polar

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
    drawShieldHUD(myShield);
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
    if (overlay) overlay.classList.remove("hidden");
    if (overlayScore) setDiff(overlayScore, `SCORE: ${String(score || 0).padStart(6, "0")}`);
}

restartBtn?.addEventListener("click", () => {
    overlay?.classList.add("hidden");
    gameOver = false; lastShot = 0;
    myWeapon = "naval_cannon"; myShield = 3; myHp = MAX_HP;
    myBoostEnergy = 100; myHeat = 0;
    isMouseShooting = false;
    for (const k in keys) keys[k] = false;
    drawWeaponHUD(myWeapon); drawShieldHUD(myShield); drawHpHUD(myHp);
    drawEnergyHUD(myBoostEnergy); drawHeatHUD(myHeat); updateHUD();
    if (socket?.readyState === WebSocket.OPEN) {
        send("respawn");
        return;
    }
    socket?.close();
    connect();
});

// ════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════
generateStars();

function gameLoop(now) {
    requestAnimationFrame(gameLoop);

    updateStars();

    const dpr = window.devicePixelRatio || 1;
    const availW = canvas.width / dpr;
    const availH = canvas.height / dpr;

    const me = renderPlayers[myId];
    if (me) {
        let targetCamX = me.x - availW / 2;
        let targetCamY = me.y - availH / 2;
        targetCamX = Math.max(-200, Math.min(WORLD_W + 200 - availW, targetCamX));
        targetCamY = Math.max(-200, Math.min(WORLD_H + 200 - availH, targetCamY));
        cameraX = lerp(cameraX, targetCamX, CAMERA_SMOOTH);
        cameraY = lerp(cameraY, targetCamY, CAMERA_SMOOTH);
    }

    mx = screenMx + cameraX;
    my = screenMy + cameraY;

    if (isMouseShooting || keys[" "]) fireShot();
    if (now - lastInputTime >= INPUT_RATE) {
        sendInput();
        lastInputTime = now;
    }

    syncRenderState(renderPlayers, serverPlayers, true);
    syncRenderState(renderEnemies, serverEnemies, true);
    syncRenderState(renderBullets, serverBullets, true);

    tickParticles();

    // Nearby Dreadnought Hum
    let dreadnoughtNear = false;
    for (const e of Object.values(renderEnemies)) {
        if (e.kind === "dreadnought" && me && Math.hypot(e.x - me.x, e.y - me.y) < 150) {
            dreadnoughtNear = true; break;
        }
    }
    if (dreadnoughtNear && Math.random() < 0.1) playTone(40, 0.1, "sine", 0.02, 35);

    // Camera Shake Application
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

    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform just in case
}

window.addEventListener("click", () => ensureAudio(), { once: true });
window.addEventListener("keydown", () => ensureAudio(), { once: true });

connect();
requestAnimationFrame(gameLoop);