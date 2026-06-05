// ════════════════════════════════════════════════════════
//  SPEAKERDUST — Space Warfare Client
//  Auto-connects to production OR localhost
// ════════════════════════════════════════════════════════

// ── Detect environment ───────────────────────────────────
const IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1"
              || location.hostname === "" || location.protocol === "file:";

const WORKER_WS  = IS_LOCAL
  ? "ws://localhost:8787"
  : "wss://speakerdust.soyimposibleyt.workers.dev";
const ROOM_ID    = "sala-1";

// ── Canvas ───────────────────────────────────────────────
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gameCanvas"));
const ctx    = canvas.getContext("2d");
let WORLD_W = 1200, WORLD_H = 800;

function resizeCanvas() {
    const hudH  = document.getElementById("hud").offsetHeight;
    const statH = document.getElementById("status-bar").offsetHeight;
    const scale = Math.min(window.innerWidth / WORLD_W, (window.innerHeight - hudH - statH) / WORLD_H);
    canvas.width  = WORLD_W;
    canvas.height = WORLD_H;
    canvas.style.width    = Math.floor(WORLD_W * scale) + "px";
    canvas.style.height   = Math.floor(WORLD_H * scale) + "px";
    canvas.style.marginTop = hudH + "px";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ════════════════════════════════════════════════════════
//  PIXEL-ART RENDERER
//  0=transparent 1=hull 2=bridge 3=engine 4=weapon
//  5=trim 6=panel 7=wing-accent 8=window
// ════════════════════════════════════════════════════════
function drawPixelShip(grid, cx, cy, angle, pal, ps) {
    const rows = grid.length, cols = grid[0].length;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(angle + Math.PI / 2);
    const ox = -Math.floor(cols / 2) * ps;
    const oy = -Math.floor(rows / 2) * ps;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const v = grid[r][c];
            if (!v || !pal[v]) continue;
            ctx.fillStyle = pal[v];
            ctx.fillRect(ox + c * ps, oy + r * ps, ps, ps);
        }
    }
    ctx.restore();
}

// ════════════════════════════════════════════════════════
//  SHIP BITMAPS  (top-down view, facing up = row 0)
// ════════════════════════════════════════════════════════

// ── Player: CORVETTE CLASS (13×17) ───────────────────────
// Sleek needle-nose command ship with swept wings
const SHIP_PLAYER = [
    [0,0,0,0,0,0,2,0,0,0,0,0,0],
    [0,0,0,0,0,1,2,1,0,0,0,0,0],
    [0,0,0,0,1,1,2,1,1,0,0,0,0],
    [0,0,0,0,1,2,2,2,1,0,0,0,0],
    [0,0,4,1,1,1,1,1,1,1,4,0,0],
    [0,4,4,1,1,5,1,5,1,1,4,4,0],
    [4,4,1,1,1,1,1,1,1,1,1,4,4],
    [4,7,1,1,5,1,6,1,5,1,1,7,4],
    [4,7,1,1,1,1,6,1,1,1,1,7,4],
    [0,4,1,1,5,1,1,1,5,1,1,4,0],
    [0,0,4,1,1,1,1,1,1,1,4,0,0],
    [0,0,0,1,1,1,8,8,1,1,1,0,0],
    [0,0,0,4,1,1,1,1,1,1,4,0,0],
    [0,0,0,4,4,1,1,1,4,4,0,0,0],
    [0,0,0,0,3,3,1,3,3,0,0,0,0],
    [0,0,0,0,3,0,3,0,3,0,0,0,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
];

// ── Enemy 1: SCOUT INTERCEPTOR (9×11) ───────────────────
// Fast, angular, sharp wings
const SHIP_SCOUT = [
    [0,0,0,0,4,0,0,0,0],
    [0,0,0,0,2,0,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,4,1,1,1,4,0,0],
    [0,4,4,1,5,1,4,4,0],
    [4,4,1,1,1,1,1,4,4],
    [4,1,1,6,1,6,1,1,4],
    [0,0,1,1,1,1,1,0,0],
    [0,0,3,1,1,1,3,0,0],
    [0,0,3,0,1,0,3,0,0],
    [0,0,0,0,3,0,0,0,0],
];

// ── Enemy 2: CRUISER WARSHIP (13×14) ────────────────────
// Wide, armored, triple-cannon fore
const SHIP_CRUISER_ENEMY = [
    [0,0,0,4,0,4,4,4,0,4,0,0,0],
    [0,0,4,4,4,4,2,4,4,4,4,0,0],
    [0,4,4,1,1,1,2,1,1,1,4,4,0],
    [0,4,1,1,1,1,2,1,1,1,1,4,0],
    [4,4,1,1,5,1,1,1,5,1,1,4,4],
    [4,1,1,1,1,1,1,1,1,1,1,1,4],
    [4,1,5,1,1,6,1,6,1,1,5,1,4],
    [4,1,1,1,1,1,1,1,1,1,1,1,4],
    [4,4,1,1,5,1,1,1,5,1,1,4,4],
    [0,4,1,1,1,1,1,1,1,1,1,4,0],
    [0,0,4,4,1,1,1,1,1,4,4,0,0],
    [0,0,0,3,3,1,1,1,3,3,0,0,0],
    [0,0,0,3,0,3,1,3,0,3,0,0,0],
    [0,0,0,0,0,3,3,3,0,0,0,0,0],
];

// ── Enemy 3: CAPITAL DREADNOUGHT (17×19) ────────────────
// Massive fortress ship with heavy guns and orbital thrusters
const SHIP_CAPITAL = [
    [0,0,0,0,0,4,0,0,4,0,0,4,0,0,0,0,0],
    [0,0,0,0,4,4,4,4,4,4,4,4,4,0,0,0,0],
    [0,0,0,4,4,1,1,2,2,2,1,1,4,4,0,0,0],
    [0,0,4,4,1,1,1,2,2,2,1,1,1,4,4,0,0],
    [0,4,4,1,1,5,1,2,2,2,1,5,1,1,4,4,0],
    [4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,4,4],
    [4,1,1,5,1,1,6,1,1,1,6,1,1,5,1,1,4],
    [4,1,1,1,1,1,1,1,8,1,1,1,1,1,1,1,4],
    [4,7,1,1,1,1,1,1,1,1,1,1,1,1,1,7,4],
    [4,7,1,1,6,1,1,1,1,1,1,1,6,1,1,7,4],
    [4,7,1,1,1,1,1,1,1,1,1,1,1,1,1,7,4],
    [4,1,1,5,1,1,6,1,1,1,6,1,1,5,1,1,4],
    [4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,4,4],
    [0,4,4,1,1,5,1,1,1,1,1,5,1,1,4,4,0],
    [0,0,4,4,1,1,1,1,1,1,1,1,1,4,4,0,0],
    [0,0,0,4,4,3,3,1,1,1,3,3,4,4,0,0,0],
    [0,0,0,0,4,3,0,3,1,3,0,3,4,0,0,0,0],
    [0,0,0,0,0,0,0,3,3,3,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0],
];

// ── Palettes ──────────────────────────────────────────────
function makePlayerPalette(hsl) {
    const [h, s, l] = hsl;
    return {
        1: `hsl(${h},${s}%,${l}%)`,
        2: `hsl(${h},${s-10}%,${Math.min(l+30,95)}%)`,
        3: "#ff9030",
        4: `hsl(${(h+40)%360},${s}%,${Math.max(l-15,10)}%)`,
        5: `hsl(${h},${s-15}%,${l+18}%)`,
        6: `hsl(${h},${s}%,${Math.max(l-28,5)}%)`,
        7: `hsl(${(h+20)%360},${s+5}%,${l+10}%)`,
        8: "#a0eeff",
    };
}

const PAL_SCOUT = {
    1: "#c0003c", 2: "#ff3060", 3: "#ff6600", 4: "#ff0060", 5: "#ff80a0", 6: "#600020", 7: "#ff4070", 8: "#ffaacc",
};
const PAL_CRUISER_ENEMY = {
    1: "#5c0099", 2: "#9900cc", 3: "#ff6600", 4: "#cc00ff", 5: "#bb55ff", 6: "#2a0044", 7: "#dd88ff", 8: "#e0aaff",
};
const PAL_CAPITAL = {
    1: "#1a2a66", 2: "#3355cc", 3: "#ff6600", 4: "#ff3355", 5: "#4477ee", 6: "#0a1030", 7: "#5588ff", 8: "#88bbff",
};

// ════════════════════════════════════════════════════════
//  WEAPONS HUD
// ════════════════════════════════════════════════════════
const WEAPON_COLORS = { laser: "#00e5ff", spread: "#a8ff78", missile: "#ff9030" };
const WEAPON_ICONS  = { laser: "▶ LASER", spread: "≫ SPREAD", missile: "⊕ MISSILE" };

function drawWeaponHUD(weapon) {
    const el = document.getElementById("weapon-display");
    if (!el) return;
    el.textContent = WEAPON_ICONS[weapon] || "";
    el.style.color = WEAPON_COLORS[weapon] || "#fff";
    el.style.textShadow = `0 0 10px ${WEAPON_COLORS[weapon]}`;
}

function drawShieldHUD(shield) {
    const el = document.getElementById("shield-display");
    if (!el) return;
    el.textContent = "◈".repeat(shield) + "◇".repeat(Math.max(0, 3 - shield));
    el.style.color = shield > 1 ? "#4af" : shield === 1 ? "#fa0" : "#f44";
}

// ════════════════════════════════════════════════════════
//  BACKGROUND
// ════════════════════════════════════════════════════════
const stars = Array.from({ length: 240 }, () => ({
    x: Math.random() * 1200, y: Math.random() * 800,
    size: Math.random() < 0.06 ? 2 : 1,
    speed: Math.random() * 0.55 + 0.08,
    alpha: Math.random() * 0.6 + 0.3,
    tw: Math.random() * Math.PI * 2,
    tws: Math.random() * 0.05 + 0.015,
}));

const nebOffscreen = document.createElement("canvas");
nebOffscreen.width = 1200; nebOffscreen.height = 800;
let nebBuilt = false;

function buildNebulas() {
    const nc = nebOffscreen.getContext("2d");
    const defs = [
        { x: 200, y: 150, r: 240, h: 195, a: 0.08 },
        { x: 950, y: 620, r: 280, h: 270, a: 0.07 },
        { x: 600, y: 400, r: 200, h: 330, a: 0.05 },
        { x: 100, y: 650, r: 210, h: 150, a: 0.06 },
        { x: 1080, y: 200, r: 180, h: 20,  a: 0.06 },
    ];
    for (const d of defs) {
        const g = nc.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
        g.addColorStop(0,   `hsla(${d.h},65%,45%,${d.a})`);
        g.addColorStop(0.5, `hsla(${d.h},55%,25%,${d.a * 0.5})`);
        g.addColorStop(1,   "transparent");
        nc.fillStyle = g;
        nc.fillRect(0, 0, 1200, 800);
    }
    nebBuilt = true;
}

function drawBackground() {
    ctx.fillStyle = "#02030e";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    if (!nebBuilt) buildNebulas();
    ctx.drawImage(nebOffscreen, 0, 0);

    ctx.strokeStyle = "rgba(8,15,48,0.6)";
    ctx.lineWidth = 1;
    for (let x = 0; x < WORLD_W; x += 48) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,WORLD_H); ctx.stroke(); }
    for (let y = 0; y < WORLD_H; y += 48) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(WORLD_W,y); ctx.stroke(); }

    for (const s of stars) {
        s.y = (s.y + s.speed) % WORLD_H;
        s.tw += s.tws;
        ctx.globalAlpha = s.alpha * (0.65 + 0.35 * Math.sin(s.tw));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
    ctx.globalAlpha = 1;
}

// ════════════════════════════════════════════════════════
//  PARTICLES
// ════════════════════════════════════════════════════════
let particles = [];

function explode(x, y, colors, n, spd = 4.5) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * spd + 0.8;
        particles.push({ x, y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            sz: Math.floor(Math.random() * 5 + 2),
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 30 + Math.random() * 15, maxLife: 45 });
    }
}

function tickParticles() {
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) { p.x+=p.vx; p.y+=p.vy; p.vx*=0.91; p.vy*=0.91; p.life--; }
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
        } else { // missile
            ctx.shadowBlur = 14; ctx.shadowColor = "#ff9030";
            ctx.fillStyle = "#ffdd88"; ctx.fillRect(-3, -10, 6, 20);
            ctx.fillStyle = "#ff6600"; ctx.fillRect(-3,  8,   6,  6);
            ctx.globalAlpha = 0.35; ctx.fillStyle = "#ff9030"; ctx.fillRect(-7, -12, 14, 28);
            ctx.globalAlpha = 1;
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function drawEnemyBullets(bullets) {
    for (const b of Object.values(bullets)) {
        ctx.shadowBlur  = 10;
        ctx.shadowColor = "#ff3060";
        ctx.fillStyle   = "#ff3060";
        ctx.fillRect(Math.round(b.x) - 3, Math.round(b.y) - 3, 6, 6);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle   = "#ff80a0";
        ctx.fillRect(Math.round(b.x) - 5, Math.round(b.y) - 5, 10, 10);
        ctx.globalAlpha = 1;
        ctx.shadowBlur  = 0;
    }
}

// ════════════════════════════════════════════════════════
//  DRAW – ENEMIES (3 unique classes)
// ════════════════════════════════════════════════════════
function drawEnemies(enemies) {
    for (const e of Object.values(enemies)) {
        const ps    = e.kind === "capital" ? 3 : e.kind === "cruiser" ? 3 : 3;
        const glowC = e.kind === "capital" ? "#4466ff" : e.kind === "cruiser" ? "#cc00ff" : "#ff2060";
        const ship  = e.kind === "capital" ? SHIP_CAPITAL : e.kind === "cruiser" ? SHIP_CRUISER_ENEMY : SHIP_SCOUT;
        const pal   = e.kind === "capital" ? PAL_CAPITAL  : e.kind === "cruiser" ? PAL_CRUISER_ENEMY  : PAL_SCOUT;

        ctx.shadowBlur  = e.kind === "capital" ? 22 : 14;
        ctx.shadowColor = glowC;
        drawPixelShip(ship, e.x, e.y, e.angle, pal, ps);
        ctx.shadowBlur  = 0;

        // HP bar
        const bw = e.kind === "capital" ? 44 : e.kind === "cruiser" ? 32 : 22;
        const bh = 3, bx = Math.round(e.x - bw/2), by = Math.round(e.y - (e.kind === "capital" ? 40 : 30));
        const pct = e.hp / e.maxHp;
        ctx.fillStyle = "#220000"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = pct > 0.6 ? glowC : pct > 0.3 ? "#ffaa00" : "#ff2020";
        ctx.fillRect(bx, by, Math.round(bw * pct), bh);
    }
}

// ════════════════════════════════════════════════════════
//  DRAW – PLAYERS
// ════════════════════════════════════════════════════════
function drawPlayers(players, myId, mx, my, myShield) {
    for (const [id, p] of Object.entries(players)) {
        if (!p.alive) continue;
        const isMe = id === myId;
        const hsl  = parseHSL(p.color);
        const pal  = makePlayerPalette(hsl);

        ctx.shadowBlur  = isMe ? 22 : 14;
        ctx.shadowColor = p.color;
        drawPixelShip(SHIP_PLAYER, p.x, p.y, p.angle, pal, isMe ? 3 : 2);
        ctx.shadowBlur  = 0;

        // Engine trail
        if (isMe) drawEngineTrail(p);

        // Shield ring
        if (isMe && myShield > 0) {
            ctx.strokeStyle = `rgba(68,170,255,${0.15 + myShield * 0.12})`;
            ctx.lineWidth   = 2;
            ctx.beginPath();
            ctx.arc(Math.round(p.x), Math.round(p.y), 28, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Aim line + crosshair
        if (isMe) {
            ctx.strokeStyle = "rgba(0,229,255,0.22)";
            ctx.lineWidth   = 1;
            ctx.setLineDash([5, 7]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mx, my); ctx.stroke();
            ctx.setLineDash([]);

            const cs = 9;
            ctx.strokeStyle = "rgba(0,229,255,0.8)";
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(mx-cs, my); ctx.lineTo(mx+cs, my);
            ctx.moveTo(mx, my-cs); ctx.lineTo(mx, my+cs);
            ctx.stroke();
            ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI*2); ctx.stroke();
        }

        // Score tag
        ctx.font      = "6px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = isMe ? "rgba(0,229,255,0.85)" : "rgba(200,220,255,0.5)";
        ctx.fillText(`${p.score ?? 0}`, Math.round(p.x), Math.round(p.y - (isMe ? 42 : 30)));
    }
}

function drawEngineTrail(p) {
    const mx = -Math.sin(p.angle), my = Math.cos(p.angle);
    for (let i = 0; i < 8; i++) {
        const t  = i / 8;
        const ex = p.x + mx * (16 + i * 5) + (Math.random() - 0.5) * 5;
        const ey = p.y + my * (16 + i * 5) + (Math.random() - 0.5) * 5;
        ctx.globalAlpha = (1 - t) * 0.65;
        ctx.fillStyle   = i < 2 ? "#ffffff" : i < 5 ? "#ff9030" : "#ff4400";
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
    ctx.fillStyle   = "#00e5ff";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = 1;
    waveFlash--;
}

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════
let myId           = null;
let myWeapon       = "laser";
let myShield       = 3;
let gameOver       = false;
let score          = 0;
let currentWave    = 1;
let serverPlayers  = {};
let serverBullets  = {};
let serverEnemyBullets = {};
let serverEnemies  = {};

// ════════════════════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════════════════════
const keys = {};
window.addEventListener("keydown", e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup",   e => { keys[e.key.toLowerCase()] = false; });

// Q / Tab cycle weapon
window.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "q" || e.key === "Tab") {
        e.preventDefault();
        socket?.readyState === WebSocket.OPEN &&
            socket.send(JSON.stringify({ type: "switch_weapon" }));
    }
    // Space to shoot
    if (e.key === " ") {
        e.preventDefault();
        fireShot();
    }
});

let mx = WORLD_W / 2, my = WORLD_H / 2;
canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    mx = (e.clientX - r.left) * (canvas.width  / r.width);
    my = (e.clientY - r.top)  * (canvas.height / r.height);
});

let lastShot = 0;
const COOLDOWN_TABLE = { laser: 170, spread: 600, missile: 900 };
canvas.addEventListener("click", fireShot);

function fireShot() {
    const now = performance.now();
    const cd  = COOLDOWN_TABLE[myWeapon] ?? 200;
    if (now - lastShot < cd || gameOver) return;
    lastShot = now;
    socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "shoot" }));
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
    socket.addEventListener("open",    () => setStatus("connected"));
    socket.addEventListener("message", e  => handleMsg(JSON.parse(e.data)));
    socket.addEventListener("close",   () => { setStatus("disconnected"); setTimeout(connect, 2500); });
    socket.addEventListener("error",   () => setStatus("disconnected"));
}

function handleMsg(msg) {
    switch (msg.type) {
        case "init":
            myId = msg.playerId; WORLD_W = msg.worldW; WORLD_H = msg.worldH;
            serverPlayers = msg.state.players; serverBullets = msg.state.bullets;
            serverEnemyBullets = msg.state.enemyBullets ?? {};
            serverEnemies = msg.state.enemies; currentWave = msg.state.wave;
            resizeCanvas(); buildNebulas(); updateHUD();
            break;
        case "tick":
            serverPlayers = msg.players; serverBullets = msg.bullets;
            serverEnemyBullets = msg.enemyBullets ?? {};
            serverEnemies = msg.enemies; currentWave = msg.wave;
            const me = serverPlayers[myId];
            if (me) { score = me.score; myShield = me.shield ?? myShield; }
            updateHUD();
            break;
        case "weapon_changed":
            myWeapon = msg.weapon;
            drawWeaponHUD(myWeapon);
            break;
        case "explosion":
            if (msg.kind === "capital") {
                explode(msg.x, msg.y, ["#ffcc00","#ff6600","#ffffff","#4466ff"], 36, 6);
                explode(msg.x, msg.y, ["#ff4400","#ff9900"], 20, 3);
            } else if (msg.kind === "cruiser") {
                explode(msg.x, msg.y, ["#cc00ff","#ff80ff","#ffffff","#ff9030"], 24, 5);
            } else {
                explode(msg.x, msg.y, ["#ff2060","#ff9030","#ffffff"], 16, 4.5);
            }
            break;
        case "hit":
            explode(msg.x, msg.y, ["#ffffff","#ffdd88"], 6, 2);
            break;
        case "shield_hit":
            if (msg.playerId === myId) {
                myShield = Math.max(0, myShield - 1);
                drawShieldHUD(myShield);
                explode(serverPlayers[myId]?.x ?? 0, serverPlayers[myId]?.y ?? 0, ["#4488ff","#aaccff"], 8, 2);
            }
            break;
        case "player_dead":
            explode(msg.x, msg.y, ["#00e5ff","#ffffff","#0088ff"], 30, 6);
            if (msg.playerId === myId) { gameOver = true; showGameOver(); }
            break;
        case "new_wave":
            currentWave = msg.wave; waveFlash = 50;
            myShield = 3; updateHUD();
            break;
    }
}

// Input → Server
let lastInput = 0;
function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;
    let vx = 0, vy = 0;
    if (keys["w"] || keys["arrowup"])    vy -= 1;
    if (keys["s"] || keys["arrowdown"])  vy += 1;
    if (keys["a"] || keys["arrowleft"])  vx -= 1;
    if (keys["d"] || keys["arrowright"]) vx += 1;
    if (vx && vy) { vx *= 0.707; vy *= 0.707; }
    const p = serverPlayers[myId];
    const angle = p ? Math.atan2(my - p.y, mx - p.x) : 0;
    socket.send(JSON.stringify({ type: "move", vx, vy, angle }));
}

// ════════════════════════════════════════════════════════
//  HUD
// ════════════════════════════════════════════════════════
function updateHUD() {
    const sel = id => document.getElementById(id);
    const sc  = sel("score");  if (sc) sc.textContent = String(score).padStart(6, "0");
    const wn  = sel("wave-num"); if (wn) wn.textContent = String(currentWave);
    const pc  = sel("player-count"); if (pc) pc.textContent = String(Object.keys(serverPlayers).length);
    drawWeaponHUD(myWeapon);
    drawShieldHUD(myShield);
}

function setStatus(s) {
    const el = document.getElementById("connection-status");
    if (!el) return;
    const map = { connecting: ["status-connecting","◆ CONECTANDO..."], connected: ["status-connected","◆ CONECTADO"], disconnected: ["status-disconnected","◆ DESCONECTADO"] };
    [el.className, el.textContent] = map[s];
}

function showGameOver() {
    const ov = document.getElementById("screen-overlay");
    if (ov) ov.classList.remove("hidden");
    const se = document.getElementById("overlay-score");
    if (se) se.textContent = `PUNTOS: ${String(score).padStart(6,"0")}`;
}

document.getElementById("restart-btn")?.addEventListener("click", () => {
    document.getElementById("screen-overlay")?.classList.add("hidden");
    gameOver = false; socket?.close();
});

// ════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════
const INPUT_RATE = 33;
let lastInputTime = 0;

function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    if (now - lastInputTime >= INPUT_RATE) { sendInput(); lastInputTime = now; }
    tickParticles();
    drawBackground();
    drawWaveFlash();
    drawEnemyBullets(serverEnemyBullets);
    drawBullets(serverBullets);
    drawEnemies(serverEnemies);
    drawPlayers(serverPlayers, myId, mx, my, myShield);
    drawParticles();
}

connect();
requestAnimationFrame(gameLoop);
