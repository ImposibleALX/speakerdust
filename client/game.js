// ════════════════════════════════════════════════════════
//  SPEAKERDUST — Space Warfare Client  (v2 · robustecido)
//  Auto-connects to production OR localhost
// ════════════════════════════════════════════════════════

// ── Detect environment ───────────────────────────────────
const IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    || location.hostname === "" || location.protocol === "file:";

const WORKER_WS = IS_LOCAL
    ? "ws://localhost:8787"
    : "wss://speakerdust.soyimposibleyt.workers.dev";
const ROOM_ID = "sala-1";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gameCanvas"));
const ctx = canvas.getContext("2d");
let WORLD_W = 1200, WORLD_H = 800;
let VIEW_W = 1200, VIEW_H = 800;
let OFFSET_X = 0, OFFSET_Y = 0;

// ── HUD elements (cached) ────────────────────────────────
const hudEl = document.getElementById("hud");
const statusBarEl = document.getElementById("status-bar");
const weaponDisp = document.getElementById("weapon-display");
const shieldDisp = document.getElementById("shield-display");
const scoreDisp = document.getElementById("score");
const waveNumDisp = document.getElementById("wave-num");
const playerCountDisp = document.getElementById("player-count");
const connStatusEl = document.getElementById("connection-status");
const overlay = document.getElementById("screen-overlay");
const overlayScore = document.getElementById("overlay-score");
const restartBtn = document.getElementById("restart-btn");
const hullDisp = document.getElementById("hull-display");
const energyDisp = document.getElementById("energy-display");
const heatDisp = document.getElementById("heat-display");
const objectiveDisp = document.getElementById("objective-display");

let audioCtx = null;

// ── Audio System ─────────────────────────────────────────
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

let masterCompressor = null;

function ensureAudio() {
    if (!audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        audioCtx = new Ctor();
        masterCompressor = audioCtx.createDynamicsCompressor();
        masterCompressor.threshold.value = -14;
        masterCompressor.knee.value = 0;
        masterCompressor.ratio.value = 12;
        masterCompressor.attack.value = 0.003;
        masterCompressor.release.value = 0.1;
        masterCompressor.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => { });
    }
    return audioCtx;
}

function playTone(freq, duration, type = "sine", gain = 0.04, sweepTo = null) {
    const ctxAudio = ensureAudio();
    if (!ctxAudio) return;
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

function playNoise(duration, gain = 0.04) {
    const ctxAudio = ensureAudio();
    if (!ctxAudio) return;
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

// ── Screen Resize Logic ──────────────────────────────────
function resizeCanvas() {
    const hudH = hudEl?.offsetHeight ?? 0;
    const statH = statusBarEl?.offsetHeight ?? 0;
    const availW = window.innerWidth;
    const availH = window.innerHeight - hudH - statH;
    
    const scale = Math.min(availW / WORLD_W, availH / WORLD_H);
    
    VIEW_W = availW / scale;
    VIEW_H = availH / scale;
    OFFSET_X = (VIEW_W - WORLD_W) / 2;
    OFFSET_Y = (VIEW_H - WORLD_H) / 2;
    
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    canvas.style.width = availW + "px";
    canvas.style.height = availH + "px";
    canvas.style.marginTop = hudH + "px";
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
    const key = grid.length + "_" + (pal[1] || "") + "_" + ps;
    if (shipCache.has(key)) return shipCache.get(key);

    const rows = grid.length, cols = grid[0].length;
    const oc = document.createElement("canvas");
    oc.width = cols * ps;
    oc.height = rows * ps;
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
    // Sub-pixel corrections to avoid blur
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(angle + Math.PI / 2);
    ctx.drawImage(cached.canvas, -Math.floor(cached.cx), -Math.floor(cached.cy));
    ctx.restore();
}

// ════════════════════════════════════════════════════════
//  SHIP BITMAPS  (top-down view, facing up = row 0)
// ════════════════════════════════════════════════════════

// ── Player: CORVETTE CLASS (13×17) ───────────────────────
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

// ── Enemy 1: SCOUT INTERCEPTOR (9×11) ───────────────────
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

// ── Enemy 2: CRUISER WARSHIP (13×14) ────────────────────
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

// ── Enemy 3: CAPITAL DREADNOUGHT (17×19) ────────────────
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
function makePlayerPalette(hsl) {
    const [h, s, l] = hsl;
    return {
        1: `hsl(${h},${s}%,${l}%)`,
        2: `hsl(${h},${s - 10}%,${Math.min(l + 20, 90)}%)`, // softer secondary hull
        // engine flame less intense
        3: `hsl(${(h + 200) % 360},${Math.max(s - 30, 30)}%,${Math.max(l - 20, 30)}%)`,
        4: `hsl(${(h + 40) % 360},${s}%,${Math.max(l - 15, 15)}%)`,
        // trim slightly desaturated
        5: `hsl(${h},${Math.max(s - 20, 20)}%,${Math.min(l + 10, 80)}%)`,
        // panel darker
        6: `hsl(${h},${s}%,${Math.max(l - 35, 10)}%)`,
        // wing accent subtle
        7: `hsl(${(h + 20) % 360},${Math.max(s - 5, 40)}%,${Math.min(l + 5, 85)}%)`,
        8: "#a0eeff",
    };
}

const PAL_SCOUT = {
    1: "#b50035", 2: "#ff1c51", 3: "#ffaa00", 4: "#e6004b",
    5: "#ff7093", 6: "#4a0016", 7: "#ff2a5f", 8: "#a0eeff",
};
const PAL_CRUISER_ENEMY = {
    1: "#4a0080", 2: "#8a00cc", 3: "#ffaa00", 4: "#aa00ff",
    5: "#ba66ff", 6: "#1a002b", 7: "#d488ff", 8: "#a0eeff",
};
const PAL_CAPITAL = {
    1: "#12204a", 2: "#2d4bb5", 3: "#ffaa00", 4: "#e62a4a",
    5: "#4272f5", 6: "#070c21", 7: "#5788fa", 8: "#a0eeff",
};

// ════════════════════════════════════════════════════════
//  WEAPONS HUD
// ════════════════════════════════════════════════════════
const WEAPON_COLORS = { laser: "#00e5ff", spread: "#a8ff78", missile: "#ff9030" };
const WEAPON_ICONS = { laser: "▶ LASER", spread: "≫ SPREAD", missile: "⊕ MISSILE" };

function drawWeaponHUD(weapon) {
    if (!weaponDisp) return;
    weaponDisp.textContent = WEAPON_ICONS[weapon] || "";
    weaponDisp.style.color = WEAPON_COLORS[weapon] || "#fff";
    weaponDisp.style.textShadow = `0 0 10px ${WEAPON_COLORS[weapon]}`;
}

function drawShieldHUD(shield) {
    if (!shieldDisp) return;
    shieldDisp.textContent = "◈".repeat(Math.max(0, shield)) + "◇".repeat(Math.max(0, 3 - shield));
    shieldDisp.style.color = shield > 1 ? "#4af" : shield === 1 ? "#fa0" : "#f44";
}

function drawHullHUD(hull) {
    if (!hullDisp) return;
    hullDisp.textContent = "◈".repeat(Math.max(0, hull)) + "◇".repeat(Math.max(0, MAX_HULL - hull));
    hullDisp.style.color = hull > 2 ? "#a8ff78" : hull === 2 ? "#ffd36a" : "#ff6a7a";
}

function drawEnergyHUD(energy) {
    if (!energyDisp) return;
    energyDisp.textContent = renderMeter(energy, 100, 10, "█", "░");
}

function drawHeatHUD(heat) {
    if (!heatDisp) return;
    heatDisp.textContent = renderMeter(heat, 100, 10, "█", "░");
    heatDisp.style.color = heat > 75 ? "#ff6a7a" : heat > 45 ? "#ffb35a" : "#ffd36a";
}

function drawObjectiveHUD(zones) {
    if (!objectiveDisp) return;
    const list = Object.values(zones || {});
    if (!list.length) {
        objectiveDisp.textContent = "DOMINIO 0/0";
        return;
    }
    const playersOwned = list.filter(zone => zone.owner === "players").length;
    const focus = list.reduce((best, zone) => Math.abs(zone.progress || 0) > Math.abs(best.progress || 0) ? zone : best, list[0]);
    const pct = Math.round(focus.progress || 0);
    const ownerText = focus.owner === "players" ? "NUESTRA" : focus.owner === "enemies" ? "ENEMIGA" : "NEUTRAL";
    objectiveDisp.textContent = `DOMINIO ${playersOwned}/${list.length} • ${focus.label || "ZONA"} ${pct}% ${ownerText}`;
}

function renderMeter(value, max, width, filledChar, emptyChar) {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeMax = max > 0 ? max : 1;
    const clamped = Math.max(0, Math.min(safeMax, safeValue));
    const filled = Math.round((clamped / safeMax) * width);
    return filledChar.repeat(filled) + emptyChar.repeat(Math.max(0, width - filled));
}

function playWeaponSound(weapon) {
    if (weapon === "laser") {
        playTone(880, 0.04, "square", 0.025, 1360);
    } else if (weapon === "spread") {
        playTone(620, 0.03, "triangle", 0.02, 740);
        playTone(820, 0.04, "triangle", 0.018, 1040);
    } else if (weapon === "missile") {
        playTone(180, 0.12, "sawtooth", 0.03, 90);
        playTone(70, 0.16, "triangle", 0.02, 40);
    }
}

function playImpactSound(strong = false) {
    playNoise(strong ? 0.06 : 0.03, strong ? 0.03 : 0.015);
    playTone(strong ? 260 : 420, strong ? 0.05 : 0.03, "square", strong ? 0.02 : 0.01, strong ? 140 : 260);
}

function playExplosionSound() {
    playNoise(0.16, 0.06);
    playTone(72, 0.18, "sawtooth", 0.03, 35);
}

function playObjectiveSound() {
    playTone(660, 0.05, "triangle", 0.02, 880);
    playTone(990, 0.08, "triangle", 0.02, 1320);
}

// ════════════════════════════════════════════════════════
//  BACKGROUND (dynamic world size)
// ════════════════════════════════════════════════════════
let stars = [];
const nebOffscreen = document.createElement("canvas");
let nebBuilt = false;

function generateStars() {
    stars = Array.from({ length: 240 }, () => ({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        size: Math.random() < 0.06 ? 2 : 1,
        speed: Math.random() * 0.55 + 0.08,
        alpha: Math.random() * 0.6 + 0.3,
        tw: Math.random() * Math.PI * 2,
        tws: Math.random() * 0.05 + 0.015,
    }));
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
    const sx = WORLD_W / 1200;
    const sy = WORLD_H / 800;
    for (const d of defs) {
        const g = nc.createRadialGradient(d.x * sx, d.y * sy, 0, d.x * sx, d.y * sy, d.r * Math.max(sx, sy));
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
    ctx.fillRect(-OFFSET_X, -OFFSET_Y, VIEW_W, VIEW_H);
    if (!nebBuilt) buildNebulas();
    ctx.drawImage(nebOffscreen, 0, 0);

    ctx.strokeStyle = "rgba(8,15,48,0.6)";
    ctx.lineWidth = 1;
    for (let x = 0; x < WORLD_W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
    for (let y = 0; y < WORLD_H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }

    for (const s of stars) {
        s.y = (s.y + s.speed) % WORLD_H;
        s.tw += s.tws;
        ctx.globalAlpha = s.alpha * (0.65 + 0.35 * Math.sin(s.tw));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
    ctx.globalAlpha = 1;
}

function drawObjectives(zones) {
    for (const zone of Object.values(zones || {})) {
        const ownerColor = zone.owner === "players" ? "#00e5ff" : zone.owner === "enemies" ? "#ff4a88" : "#7f8aa8";
        const alpha = zone.owner === "neutral" ? 0.12 : 0.2;
        const fill = ctx.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
        fill.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`);
        fill.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.45})`);
        fill.addColorStop(1, "transparent");

        ctx.save();
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = ownerColor;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.shadowColor = ownerColor;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = ownerColor;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius * 0.62, 0, Math.PI * 2);
        ctx.stroke();

        const progress = Math.abs(zone.progress || 0) / 100;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = ownerColor;
        ctx.font = "7px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillText(zone.label || "ZONA", Math.round(zone.x), Math.round(zone.y - zone.radius - 10));
        ctx.font = "6px 'Press Start 2P', monospace";
        ctx.fillText(`${Math.round(zone.progress || 0)}%`, Math.round(zone.x), Math.round(zone.y + zone.radius + 12));
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
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            sz: Math.floor(Math.random() * 5 + 2),
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 30 + Math.random() * 15, maxLife: 45
        });
    }
}

function tickParticles() {
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.91; p.vy *= 0.91; p.life--; }
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
    for (const b of Object.values(bullets)) {
        const a = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(Math.round(b.x), Math.round(b.y));
        ctx.rotate(a + Math.PI / 2);

        if (b.kind === "laser") {
            ctx.shadowBlur = 12; ctx.shadowColor = "#00e5ff";
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-2, -9, 4, 18);
            ctx.globalAlpha = 0.45; ctx.fillStyle = "#00e5ff"; ctx.fillRect(-4, -11, 8, 22);
            ctx.globalAlpha = 1;
        } else if (b.kind === "spread") {
            ctx.shadowBlur = 10; ctx.shadowColor = "#a8ff78";
            ctx.fillStyle = "#ccffaa"; ctx.fillRect(-2, -6, 4, 12);
            ctx.globalAlpha = 0.4; ctx.fillStyle = "#a8ff78"; ctx.fillRect(-4, -8, 8, 16);
            ctx.globalAlpha = 1;
        } else if (b.kind === "missile") {
            ctx.shadowBlur = 4; ctx.shadowColor = "#ff6600";
            ctx.fillStyle = "#ffaa00"; ctx.fillRect(-2, 8, 4, 4);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(-1, 8, 2, 2);
            ctx.fillStyle = "#888888"; ctx.fillRect(-4, 4, 8, 4);
            ctx.fillStyle = "#cccccc"; ctx.fillRect(-2, -4, 4, 12);
            ctx.fillStyle = "#ff4444"; ctx.fillRect(-2, -8, 4, 4);
            ctx.fillRect(-1, -10, 2, 2);
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function drawEnemyBullets(bullets) {
    for (const b of Object.values(bullets)) {
        const color = b.kind === "shell" ? "#ffb35a" : b.kind === "spread" ? "#ff7ab8" : "#ff3060";
        const glow = b.kind === "shell" ? "#ffd36a" : b.kind === "spread" ? "#ff9bd0" : "#ff3060";
        const size = b.kind === "shell" ? 7 : b.kind === "spread" ? 6 : 5;
        const half = Math.floor(size / 2);

        ctx.shadowBlur = b.kind === "shell" ? 14 : 10;
        ctx.shadowColor = glow;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(b.x) - half, Math.round(b.y) - half, size, size);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = glow;
        ctx.fillRect(Math.round(b.x) - size, Math.round(b.y) - size, size * 2, size * 2);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    }
}

// ════════════════════════════════════════════════════════
//  DRAW – ENEMIES
// ════════════════════════════════════════════════════════
function drawEnemies(enemies) {
    for (const e of Object.values(enemies)) {
        const ps = 3;
        const glowC = e.kind === "capital" ? "#4466ff" : e.kind === "cruiser" ? "#cc00ff" : "#ff2060";
        const ship = e.kind === "capital" ? SHIP_CAPITAL : e.kind === "cruiser" ? SHIP_CRUISER_ENEMY : SHIP_SCOUT;
        const pal = e.kind === "capital" ? PAL_CAPITAL : e.kind === "cruiser" ? PAL_CRUISER_ENEMY : PAL_SCOUT;

        // Comportamiento de IA visual mejorado (Estelas de motor de enemigos)
        drawEnemyEngineTrail(e, glowC);

        ctx.shadowBlur = e.kind === "capital" ? 22 : 14;
        ctx.shadowColor = glowC;
        drawPixelShip(ship, e.x, e.y, e.angle, pal, ps);
        ctx.shadowBlur = 0;

        // HP bar (Previene divisiones por cero en clientes locales/bugs)
        const maxHpSafe = e.maxHp > 0 ? e.maxHp : 10;
        const pct = Math.max(0, Math.min(1, e.hp / maxHpSafe));
        const bw = e.kind === "capital" ? 44 : e.kind === "cruiser" ? 32 : 22;
        const bh = 3, bx = Math.round(e.x - bw / 2), by = Math.round(e.y - (e.kind === "capital" ? 40 : 30));

        ctx.fillStyle = "#220000"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = pct > 0.6 ? glowC : pct > 0.3 ? "#ffaa00" : "#ff2020";
        ctx.fillRect(bx, by, Math.round(bw * pct), bh);
    }
}

// Efecto añadido para robustecer la presentación de los enemigos (IA)
function drawEnemyEngineTrail(e, color) {
    const mx = -Math.cos(e.angle || 0);
    const my = -Math.sin(e.angle || 0);
    const isCap = e.kind === "capital";
    const len = isCap ? 10 : 6;
    const dist = isCap ? 35 : e.kind === "cruiser" ? 22 : 12;

    for (let i = 0; i < len; i++) {
        const t = i / len;
        const ex = e.x + mx * (dist + i * 4) + (Math.random() - 0.5) * (isCap ? 10 : 4);
        const ey = e.y + my * (dist + i * 4) + (Math.random() - 0.5) * (isCap ? 10 : 4);
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = i < 2 ? "#ffffff" : color;
        const sz = Math.max(1, Math.floor((1 - t) * (isCap ? 5 : 3)));
        ctx.fillRect(Math.round(ex), Math.round(ey), sz, sz);
    }
    ctx.globalAlpha = 1;
}

// ════════════════════════════════════════════════════════
//  DRAW – PLAYERS
// ════════════════════════════════════════════════════════
function drawPlayers(players, myId, mx, my, myShield) {
    for (const [id, p] of Object.entries(players)) {
        if (p.alive === false) continue;
        const isMe = id === myId;
        const hsl = parseHSL(p.color ?? "hsl(180,80%,60%)");
        const pal = makePlayerPalette(hsl);

        ctx.shadowBlur = isMe ? 22 : 14;
        ctx.shadowColor = p.color ?? "#ffffff";
        drawPixelShip(SHIP_PLAYER, p.x, p.y, p.angle, pal, isMe ? 3 : 2);
        ctx.shadowBlur = 0;

        // Engine trail
        if (isMe) drawEngineTrail(p);

        // Shield ring
        if (isMe && myShield > 0) {
            ctx.strokeStyle = `rgba(68,170,255,${0.15 + myShield * 0.12})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(Math.round(p.x), Math.round(p.y), 28, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Aim line + crosshair
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

        // Score tag
        ctx.font = "6px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = isMe ? "rgba(0,229,255,0.85)" : "rgba(200,220,255,0.5)";
        ctx.fillText(`${p.score ?? 0}`, Math.round(p.x), Math.round(p.y - (isMe ? 42 : 30)));
    }
}

function drawEngineTrail(p) {
    const mx = -Math.cos(p.angle);
    const my = -Math.sin(p.angle);
    for (let i = 0; i < 8; i++) {
        const t = i / 8;
        const ex = p.x + mx * (16 + i * 5) + (Math.random() - 0.5) * 5;
        const ey = p.y + my * (16 + i * 5) + (Math.random() - 0.5) * 5;
        ctx.globalAlpha = (1 - t) * 0.65;
        ctx.fillStyle = i < 2 ? "#ffffff" : i < 5 ? "#ff9030" : "#ff4400";
        const sz = Math.max(1, Math.floor((1 - t) * 5));
        ctx.fillRect(Math.round(ex), Math.round(ey), sz, sz);
    }
    ctx.globalAlpha = 1;
}

function parseHSL(hsl) {
    const m = hsl.match(/[\d.]+/g);
    return m ? m.map(Number) : [180, 80, 60];
}

// ════════════════════════════════════════════════════════
//  WAVE FLASH
// ════════════════════════════════════════════════════════
let waveFlash = 0;
function drawWaveFlash() {
    if (waveFlash <= 0) return;
    ctx.globalAlpha = (waveFlash / 50) * 0.3;
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(-OFFSET_X, -OFFSET_Y, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
    waveFlash--;
}

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════
let myId = null;
let myWeapon = "laser";
let myShield = 3;
let myHull = 3;
let myBoostEnergy = 100;
let myHeat = 0;
let gameOver = false;
let score = 0;
let currentWave = 1;
let serverPlayers = {};
let serverBullets = {};
let serverEnemyBullets = {};
let serverEnemies = {};
let serverZones = {};
const MAX_HULL = 3;

// Client-side interpolation state
let renderPlayers = {};
let renderEnemies = {};
let renderBullets = {};
let renderEnemyBullets = {};

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
            if (isAngle && s.angle !== undefined) r.angle = lerpAngle(r.angle || 0, s.angle, 0.35);
            r.hp = s.hp; r.maxHp = s.maxHp; r.shield = s.shield; r.score = s.score; r.color = s.color;
            r.kind = s.kind; r.alive = s.alive;
        }
    }
    for (const id in renderMap) {
        if (!serverMap[id]) delete renderMap[id];
    }
}

// ════════════════════════════════════════════════════════
//  INPUT (Mejorado e Intuitivo)
// ════════════════════════════════════════════════════════
const keys = {};
let isMouseShooting = false;

window.addEventListener("keydown", e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

// Limpia teclas atascadas al perder foco (Bugfix de coherencia y feel)
window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    isMouseShooting = false;
});

// Q / Tab para cambiar arma, Shift para Boost (mantenido)
window.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "q" || e.key === "Tab") {
        if (e.repeat) return;
        e.preventDefault();
        socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "switch_weapon" }));
    }
    if (e.key === "Shift" && !e.repeat) {
        e.preventDefault();
        sendBoost();
    }
    // Barra espaciadora puede disparar, pero controlamos en el loop para evitar spam/repetir
    if (e.key === " " && !e.repeat) {
        e.preventDefault();
    }
});

let mx = WORLD_W / 2, my = WORLD_H / 2;
canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    mx = (e.clientX - r.left) * scaleX - OFFSET_X;
    my = (e.clientY - r.top) * scaleY - OFFSET_Y;
});

// Auto-fire y Dash en ratón para hacerlo extremadamente intuitivo
canvas.addEventListener("mousedown", e => {
    if (e.button === 0) { // Clic izquierdo: Auto-fire
        isMouseShooting = true;
        fireShot();
    } else if (e.button === 2) { // Clic derecho: Boost/Dash rápido (mejora intuitiva)
        e.preventDefault();
        sendBoost();
    }
});

window.addEventListener("mouseup", e => {
    if (e.button === 0) isMouseShooting = false;
});
canvas.addEventListener("contextmenu", e => e.preventDefault());

let lastShot = 0;
const COOLDOWN_TABLE = { laser: 170, spread: 600, missile: 900 };

function fireShot() {
    const now = performance.now();
    const cd = COOLDOWN_TABLE[myWeapon] ?? 200;
    if (now - lastShot < cd || gameOver) return;
    lastShot = now;
    ensureAudio();
    playWeaponSound(myWeapon);
    socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "shoot" }));
}

function sendBoost() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver || myBoostEnergy < 28) return;
    ensureAudio();
    playTone(180, 0.08, "square", 0.03, 90);
    socket.send(JSON.stringify({ type: "boost" }));
}

// ════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════
let socket;

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
    socket.addEventListener("close", () => { setStatus("disconnected"); setTimeout(connect, 2500); });
    socket.addEventListener("error", () => setStatus("disconnected"));
}

function handleMsg(msg) {
    switch (msg.type) {
        case "init":
            myId = msg.playerId;
            if (WORLD_W !== msg.worldW || WORLD_H !== msg.worldH) {
                WORLD_W = msg.worldW;
                WORLD_H = msg.worldH;
                resizeCanvas();
                generateStars();
                nebBuilt = false;
                buildNebulas();
            }
            serverPlayers = msg.state.players;
            serverBullets = msg.state.bullets;
            serverEnemyBullets = msg.state.enemyBullets ?? {};
            serverEnemies = msg.state.enemies;
            serverZones = msg.state.zones ?? {};
            currentWave = msg.state.wave;
            const initMe = serverPlayers[myId];
            if (initMe) {
                score = initMe.score;
                myShield = initMe.shield ?? myShield;
                myHull = initMe.hull ?? myHull;
                myBoostEnergy = initMe.boostEnergy ?? myBoostEnergy;
                myHeat = initMe.weaponHeat ?? myHeat;
            }
            updateHUD();
            break;
        case "tick":
            serverPlayers = msg.players;
            serverBullets = msg.bullets;
            serverEnemyBullets = msg.enemyBullets ?? {};
            serverEnemies = msg.enemies;
            if (msg.zones) {
                for (const id in msg.zones) {
                    if (serverZones[id]) {
                        serverZones[id].owner = msg.zones[id].owner;
                        serverZones[id].progress = msg.zones[id].progress;
                    } else {
                        serverZones[id] = msg.zones[id];
                    }
                }
            }
            currentWave = msg.wave;
            const me = serverPlayers[myId];
            if (me) {
                score = me.score;
                myShield = me.shield ?? myShield;
                myHull = me.hull ?? myHull;
                myBoostEnergy = me.boostEnergy ?? myBoostEnergy;
                myHeat = me.weaponHeat ?? myHeat;
            }
            updateHUD();
            break;
        case "weapon_changed":
            myWeapon = msg.weapon;
            lastShot = 0; // Cooldown fresh immediately upon cycle
            drawWeaponHUD(myWeapon);
            break;
        case "explosion":
            playExplosionSound();
            if (msg.kind === "capital") {
                explode(msg.x, msg.y, ["#ffcc00", "#ff6600", "#ffffff", "#4466ff"], 36, 6);
                explode(msg.x, msg.y, ["#ff4400", "#ff9900"], 20, 3);
            } else if (msg.kind === "cruiser") {
                explode(msg.x, msg.y, ["#cc00ff", "#ff80ff", "#ffffff", "#ff9030"], 24, 5);
            } else {
                explode(msg.x, msg.y, ["#ff2060", "#ff9030", "#ffffff"], 16, 4.5);
            }
            break;
        case "hit":
            playImpactSound(false);
            explode(msg.x, msg.y, ["#ffffff", "#ffdd88"], 6, 2);
            break;
        case "shield_hit":
            playImpactSound(msg.reason === "impact");
            if (msg.playerId === myId) {
                myShield = Math.max(0, myShield - 1);
                drawShieldHUD(myShield);
                const p = serverPlayers[myId];
                if (p) explode(p.x, p.y, ["#4488ff", "#aaccff"], 8, 2);
            }
            break;
        case "player_dead":
            playExplosionSound();
            explode(msg.x, msg.y, ["#00e5ff", "#ffffff", "#0088ff"], 30, 6);
            if (msg.playerId === myId) { gameOver = true; showGameOver(); }
            break;
        case "new_wave":
            playTone(520, 0.08, "triangle", 0.03, 820);
            currentWave = msg.wave;
            waveFlash = 50;
            myShield = 3;
            myHull = MAX_HULL;
            myBoostEnergy = 100;
            myHeat = 0;
            updateHUD();
            break;
        case "objective":
            serverZones[msg.zoneId] = {
                ...(serverZones[msg.zoneId] || {}),
                id: msg.zoneId,
                owner: msg.owner,
                progress: msg.progress,
                label: msg.label || msg.zoneId,
            };
            playObjectiveSound();
            drawObjectiveHUD(serverZones);
            break;
    }
}

// Input → Server (Enviado a intervalo constante)
let lastInput = 0;
function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;
    let forward = 0, strafe = 0;
    if (keys["w"] || keys["arrowup"]) forward += 1;
    if (keys["s"] || keys["arrowdown"]) forward -= 1;
    if (keys["a"] || keys["arrowleft"]) strafe -= 1;
    if (keys["d"] || keys["arrowright"]) strafe += 1;
    const p = serverPlayers[myId];
    const angle = p ? Math.atan2(my - p.y, mx - p.x) : 0;
    socket.send(JSON.stringify({ type: "move", forward, strafe, angle }));
}

// ════════════════════════════════════════════════════════
//  HUD
// ════════════════════════════════════════════════════════
function updateHUD() {
    if (scoreDisp) scoreDisp.textContent = String(score || 0).padStart(6, "0");
    if (waveNumDisp) waveNumDisp.textContent = String(currentWave || 1);
    if (playerCountDisp) playerCountDisp.textContent = String(Object.keys(serverPlayers).length);
    drawWeaponHUD(myWeapon);
    drawShieldHUD(myShield);
    drawHullHUD(myHull);
    drawEnergyHUD(myBoostEnergy);
    drawHeatHUD(myHeat);
    drawObjectiveHUD(serverZones);
}

function setStatus(s) {
    if (!connStatusEl) return;
    const map = {
        connecting: ["status-connecting", "◆ CONECTANDO..."],
        connected: ["status-connected", "◆ CONECTADO"],
        disconnected: ["status-disconnected", "◆ DESCONECTADO"]
    };
    const pair = map[s] ?? map.disconnected;
    connStatusEl.className = pair[0];
    connStatusEl.textContent = pair[1];
}

function showGameOver() {
    if (overlay) overlay.classList.remove("hidden");
    if (overlayScore) overlayScore.textContent = `PUNTOS: ${String(score || 0).padStart(6, "0")}`;
}

restartBtn?.addEventListener("click", () => {
    overlay?.classList.add("hidden");
    gameOver = false;
    lastShot = 0;
    myWeapon = "laser";
    myShield = 3;
    myHull = MAX_HULL;
    myBoostEnergy = 100;
    myHeat = 0;

    // Limpiar Inputs previniendo que la nave dispare sola tras renacer
    isMouseShooting = false;
    for (const k in keys) keys[k] = false;

    drawWeaponHUD(myWeapon);
    drawShieldHUD(myShield);
    drawHullHUD(myHull);
    drawEnergyHUD(myBoostEnergy);
    drawHeatHUD(myHeat);
    updateHUD();

    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "respawn" }));
        return;
    }

    socket?.close();
    connect();
});

// ════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════
const INPUT_RATE = 33;
let lastInputTime = 0;
generateStars(); // inicial

function gameLoop(now) {
    requestAnimationFrame(gameLoop);

    // Autofire logic acoplado al frame rendering previene inputs ignorados y lo hace sumamente intuitivo
    if (isMouseShooting || keys[" "]) fireShot();

    // Sincronización de movimiento constante y suave a 30 Hz hacia el servidor
    if (now - lastInputTime >= INPUT_RATE) {
        sendInput();
        lastInputTime = now;
    }

    syncRenderState(renderPlayers, serverPlayers, true);
    syncRenderState(renderEnemies, serverEnemies, true);
    syncRenderState(renderBullets, serverBullets, false);
    syncRenderState(renderEnemyBullets, serverEnemyBullets, false);

    ctx.save();
    ctx.translate(OFFSET_X, OFFSET_Y);

    tickParticles();
    drawBackground();
    drawObjectives(serverZones);
    drawWaveFlash();
    drawEnemyBullets(renderEnemyBullets);
    drawBullets(renderBullets);
    drawEnemies(renderEnemies);
    drawPlayers(renderPlayers, myId, mx, my, myShield);
    drawParticles();

    ctx.restore();
}

connect();
requestAnimationFrame(gameLoop);