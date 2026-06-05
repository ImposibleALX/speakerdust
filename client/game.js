// ════════════════════════════════════════════════════════
//  SPEAKERDUST  –  Pixel Art Space Ships Client Engine
// ════════════════════════════════════════════════════════

// ── Config ──────────────────────────────────────────────
const WORKER_URL      = "ws://localhost:8787";
const ROOM_ID         = "sala-1";
const SHOOT_COOLDOWN  = 180;   // ms between shots
const STAR_COUNT      = 220;
const NEBULA_COUNT    = 5;
const PARTICLE_LIFE   = 32;

// ── Canvas ───────────────────────────────────────────────
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gameCanvas"));
const ctx    = canvas.getContext("2d");

let WORLD_W = 1200, WORLD_H = 800;

function resizeCanvas() {
    const hudH  = document.getElementById("hud").offsetHeight;
    const statH = document.getElementById("status-bar").offsetHeight;
    const aw = window.innerWidth;
    const ah = window.innerHeight - hudH - statH;
    const scale = Math.min(aw / WORLD_W, ah / WORLD_H);
    canvas.width  = WORLD_W;
    canvas.height = WORLD_H;
    canvas.style.width  = Math.floor(WORLD_W * scale) + "px";
    canvas.style.height = Math.floor(WORLD_H * scale) + "px";
    canvas.style.marginTop = hudH + "px";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ════════════════════════════════════════════════════════
//  PIXEL-ART SHIP RENDERER
//  Each ship is a 2D grid. Pixel values:
//   0 = transparent
//   1 = hull (body)
//   2 = cockpit / bridge
//   3 = engine glow
//   4 = weapons / cannons
//   5 = shield / trim
//   6 = detail / panel lines
// ════════════════════════════════════════════════════════
function drawPixelShip(grid, cx, cy, angle, palette, ps) {
    const rows = grid.length;
    const cols = grid[0].length;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(angle + Math.PI / 2);
    const ox = -Math.floor(cols / 2) * ps;
    const oy = -Math.floor(rows / 2) * ps;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const v = grid[r][c];
            if (!v) continue;
            ctx.fillStyle = palette[v] || "#fff";
            ctx.fillRect(ox + c * ps, oy + r * ps, ps, ps);
        }
    }
    ctx.restore();
}

// ── Player ship: Heavy Cruiser (15×19) ───────────────────
// Top-down heavy cruiser with wide wings, dual cannons, large bridge
const SHIP_CRUISER = [
    [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,1,2,1,0,0,0,0,0,0],
    [0,0,0,0,0,1,1,2,1,1,0,0,0,0,0],
    [0,0,0,0,1,1,2,2,2,1,1,0,0,0,0],
    [0,0,4,0,1,1,2,6,2,1,1,0,4,0,0],
    [0,4,4,1,1,1,1,1,1,1,1,1,4,4,0],
    [4,4,1,1,5,1,1,1,1,1,5,1,1,4,4],
    [4,1,1,1,1,1,1,1,1,1,1,1,1,1,4],
    [1,1,5,1,1,1,1,1,1,1,1,1,5,1,1],
    [1,1,1,1,1,1,6,1,6,1,1,1,1,1,1],
    [1,1,5,1,1,1,1,1,1,1,1,1,5,1,1],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,1,1,5,1,1,1,1,1,5,1,1,0,0],
    [0,0,4,1,1,1,1,1,1,1,1,1,4,0,0],
    [0,0,4,4,1,1,1,1,1,1,1,4,4,0,0],
    [0,0,0,4,1,1,1,1,1,1,1,4,0,0,0],
    [0,0,0,0,3,3,1,1,1,3,3,0,0,0,0],
    [0,0,0,0,3,0,3,1,3,0,3,0,0,0,0],
    [0,0,0,0,0,0,3,3,3,0,0,0,0,0,0],
];

// ── Enemy ship: Dreadnought (13×16) ──────────────────────
// Menacing angular dreadnought with forward guns and jagged wings
const SHIP_DREAD = [
    [0,0,0,0,0,4,4,4,0,0,0,0,0],
    [0,0,0,0,4,4,6,4,4,0,0,0,0],
    [0,0,0,4,4,1,2,1,4,4,0,0,0],
    [0,0,4,1,1,1,2,1,1,1,4,0,0],
    [0,4,1,1,1,1,2,1,1,1,1,4,0],
    [4,1,1,5,1,1,1,1,1,5,1,1,4],
    [4,1,1,1,1,1,1,1,1,1,1,1,4],
    [4,1,5,1,1,6,1,6,1,1,5,1,4],
    [4,1,1,1,1,1,1,1,1,1,1,1,4],
    [0,4,1,1,1,1,1,1,1,1,1,4,0],
    [0,0,4,1,1,1,1,1,1,1,4,0,0],
    [0,0,0,3,3,1,1,1,3,3,0,0,0],
    [0,0,0,3,0,3,1,3,0,3,0,0,0],
    [0,0,0,0,0,3,3,3,0,0,0,0,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
    [0,0,0,0,0,0,3,0,0,0,0,0,0],
];

// ── Color palettes ────────────────────────────────────────
function makeCruiserPalette(hsl) {
    // hsl like "180,80%,60%" – base hull hue
    const [h, s, l] = hsl.split(/[,%]/).map(Number);
    return {
        1: `hsl(${h},${s}%,${l}%)`,          // hull
        2: `hsl(${h},${s-10}%,${Math.min(l+28,95)}%)`, // bridge – lighter
        3: `hsl(30,100%,70%)`,                // engine
        4: `hsl(${h+30},${s}%,${Math.max(l-18,10)}%)`, // weapons – darker accent
        5: `hsl(${h},${s-20}%,${l+15}%)`,    // shield trim – lighter
        6: `hsl(${h},${s}%,${Math.max(l-25,5)}%)`,     // panel lines – dark
    };
}

const DREAD_PALETTE = {
    1: "#8b0030",   // hull – deep crimson
    2: "#cc0040",   // bridge – brighter
    3: "#ff4400",   // engine – orange
    4: "#ff0060",   // weapons – hot pink-red
    5: "#ff6090",   // trim
    6: "#440010",   // dark panels
};

// ════════════════════════════════════════════════════════
//  PROJECTILES
//  Player fires blue plasma bolts, enemies fire red orbs
// ════════════════════════════════════════════════════════
function drawBullet(b, isPlayer) {
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    ctx.rotate(b.angle ?? 0);
    if (isPlayer) {
        // Plasma bolt – elongated glowing bar
        ctx.shadowBlur  = 12;
        ctx.shadowColor = "#00e5ff";
        // Core
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-2, -7, 4, 14);
        // Glow layer
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = "#00e5ff";
        ctx.fillRect(-4, -9, 8, 18);
        ctx.globalAlpha = 1;
    } else {
        // Enemy orb
        ctx.shadowBlur  = 10;
        ctx.shadowColor = "#ff2060";
        ctx.fillStyle = "#ff2060";
        ctx.fillRect(-4, -4, 8, 8);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#ff80a0";
        ctx.fillRect(-6, -6, 12, 12);
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

// ════════════════════════════════════════════════════════
//  BACKGROUND – Deep space with stars and nebulae
// ════════════════════════════════════════════════════════
const stars = Array.from({ length: STAR_COUNT }, () => ({
    x:     Math.random() * 1200,
    y:     Math.random() * 800,
    size:  Math.random() < 0.05 ? 2 : 1,
    speed: Math.random() * 0.5 + 0.1,
    alpha: Math.random() * 0.6 + 0.3,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: Math.random() * 0.06 + 0.02,
}));

// Pre-rendered nebula blobs (drawn once, used as offscreen canvas)
let nebulasReady = false;
const nebOffscreen = document.createElement("canvas");
nebOffscreen.width  = 1200;
nebOffscreen.height = 800;
function buildNebulas() {
    const nc = nebOffscreen.getContext("2d");
    const nebulas = [
        { x: 200,  y: 150, r: 220, h: 200, a: 0.07 },
        { x: 900,  y: 600, r: 260, h: 260, a: 0.06 },
        { x: 600,  y: 400, r: 180, h: 180, a: 0.04 },
        { x: 1050, y: 180, r: 160, h: 320, a: 0.06 },
        { x: 100,  y: 650, r: 200, h: 140, a: 0.05 },
    ];
    for (const n of nebulas) {
        const g = nc.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        g.addColorStop(0,   `hsla(${n.h},70%,40%,${n.a})`);
        g.addColorStop(0.5, `hsla(${n.h},60%,25%,${n.a * 0.5})`);
        g.addColorStop(1,   "transparent");
        nc.fillStyle = g;
        nc.fillRect(0, 0, 1200, 800);
    }
    nebulasReady = true;
}

function drawBackground(tick) {
    ctx.fillStyle = "#03040f";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Nebulas
    if (!nebulasReady) buildNebulas();
    ctx.drawImage(nebOffscreen, 0, 0);

    // Subtle grid
    ctx.strokeStyle = "rgba(10,18,55,0.55)";
    ctx.lineWidth   = 1;
    for (let x = 0; x < WORLD_W; x += 48) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y < WORLD_H; y += 48) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    // Stars with parallax scroll + twinkle
    for (const s of stars) {
        s.y = (s.y + s.speed) % WORLD_H;
        s.twinkle += s.twinkleSpeed;
        const alpha = s.alpha * (0.7 + 0.3 * Math.sin(s.twinkle));
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = "#ffffff";
        ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
    ctx.globalAlpha = 1;
}

// ════════════════════════════════════════════════════════
//  PARTICLES
// ════════════════════════════════════════════════════════
let particles = [];

function spawnExplosion(x, y, colors, count, speed = 4) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd   = Math.random() * speed + 0.8;
        const col   = colors[Math.floor(Math.random() * colors.length)];
        particles.push({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            size: Math.floor(Math.random() * 5 + 2),
            color: col,
            life: PARTICLE_LIFE + Math.floor(Math.random() * 10),
            maxLife: PARTICLE_LIFE + 10,
        });
    }
}

function updateParticles() {
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
        p.x  += p.vx; p.y  += p.vy;
        p.vx *= 0.91; p.vy *= 0.91;
        p.life--;
    }
}

function drawParticles() {
    for (const p of particles) {
        const a = p.life / p.maxLife;
        ctx.globalAlpha = a;
        ctx.fillStyle   = p.color;
        const s = Math.max(1, Math.ceil(p.size * a));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    ctx.globalAlpha = 1;
}

// ════════════════════════════════════════════════════════
//  DRAW ENEMIES
// ════════════════════════════════════════════════════════
function drawEnemies(enemies) {
    for (const e of Object.values(enemies)) {
        ctx.shadowBlur  = 16;
        ctx.shadowColor = "#ff2060";
        drawPixelShip(SHIP_DREAD, e.x, e.y, e.angle, DREAD_PALETTE, 3);
        ctx.shadowBlur  = 0;

        // HP bar
        const maxHp = 2 + Math.floor((e.wave || 1) / 3);
        const pct   = e.hp / maxHp;
        const bw = 28, bh = 3;
        const bx = Math.round(e.x - bw / 2), by = Math.round(e.y - 30);
        ctx.fillStyle = "#330011";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = pct > 0.5 ? "#ff2060" : "#ff8030";
        ctx.fillRect(bx, by, Math.round(bw * pct), bh);
    }
}

// ════════════════════════════════════════════════════════
//  DRAW PLAYERS
// ════════════════════════════════════════════════════════
function drawPlayers(players, myId, mouseX, mouseY) {
    for (const [id, p] of Object.entries(players)) {
        if (!p.alive) continue;
        const isMe = id === myId;
        const [h, s, l] = parseHSL(p.color);
        const palette = makeCruiserPalette(`${h},${s}%,${l}%`);

        ctx.shadowBlur  = isMe ? 20 : 12;
        ctx.shadowColor = p.color;
        drawPixelShip(SHIP_CRUISER, p.x, p.y, p.angle, palette, isMe ? 3 : 2);
        ctx.shadowBlur  = 0;

        // Engine trail
        if (isMe) drawEngineTrail(p);

        // Aim line + crosshair
        if (isMe) {
            ctx.strokeStyle = "rgba(0,229,255,0.25)";
            ctx.lineWidth   = 1;
            ctx.setLineDash([5, 7]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouseX, mouseY); ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair
            ctx.strokeStyle = "rgba(0,229,255,0.85)";
            ctx.lineWidth   = 1;
            const cs = 9;
            ctx.beginPath();
            ctx.moveTo(mouseX - cs, mouseY); ctx.lineTo(mouseX + cs, mouseY);
            ctx.moveTo(mouseX, mouseY - cs); ctx.lineTo(mouseX, mouseY + cs);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, 5, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Score tag above ship
        ctx.font      = "6px 'Press Start 2P', monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = isMe ? "rgba(0,229,255,0.8)" : "rgba(200,220,255,0.55)";
        ctx.fillText(`${p.score ?? 0}`, Math.round(p.x), Math.round(p.y - 36));
    }
}

// Engine trail – simple pixel exhaust
function drawEngineTrail(p) {
    const mx = -Math.sin(p.angle);
    const my =  Math.cos(p.angle);
    for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const x = p.x + mx * (14 + i * 5) + (Math.random() - 0.5) * 4;
        const y = p.y + my * (14 + i * 5) + (Math.random() - 0.5) * 4;
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.fillStyle   = i < 2 ? "#ffffff" : (i < 4 ? "#ff9030" : "#ff4400");
        const sz = Math.max(1, Math.floor((1 - t) * 5));
        ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
    ctx.globalAlpha = 1;
}

// ── Utility: parse hsl(...) string ───────────────────────
function parseHSL(hsl) {
    const m = hsl.match(/[\d.]+/g);
    return m ? m.map(Number) : [180, 80, 60];
}

// ════════════════════════════════════════════════════════
//  DRAW BULLETS
// ════════════════════════════════════════════════════════
function drawBullets(bullets, myId) {
    for (const b of Object.values(bullets)) {
        const angle = Math.atan2(b.vy, b.vx);
        // Inline draw, pass angle
        const isPlayer = !b.ownerId?.startsWith("bot");
        drawBulletAtAngle(b.x, b.y, angle, isPlayer);
    }
}

function drawBulletAtAngle(x, y, angle, isPlayer) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle + Math.PI / 2);
    if (isPlayer) {
        ctx.shadowBlur  = 14;
        ctx.shadowColor = "#00e5ff";
        ctx.fillStyle   = "#ffffff";
        ctx.fillRect(-2, -8, 4, 16);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle   = "#00e5ff";
        ctx.fillRect(-4, -10, 8, 20);
        ctx.globalAlpha = 1;
    } else {
        ctx.shadowBlur  = 10;
        ctx.shadowColor = "#ff2060";
        ctx.fillStyle   = "#ff2060";
        ctx.fillRect(-4, -4, 8, 8);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle   = "#ff80b0";
        ctx.fillRect(-7, -7, 14, 14);
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

// ════════════════════════════════════════════════════════
//  WAVE FLASH
// ════════════════════════════════════════════════════════
let waveFlash = 0;
function drawWaveFlash() {
    if (waveFlash <= 0) return;
    ctx.globalAlpha = waveFlash / 40;
    ctx.fillStyle   = "#00e5ff";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = 1;
    waveFlash--;
}

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════
let myId     = null;
let gameOver = false;
let score    = 0;
let serverPlayers = {};
let serverBullets = {};
let serverEnemies = {};
let currentWave   = 1;

// ════════════════════════════════════════════════════════
//  INPUT
// ════════════════════════════════════════════════════════
const keys = {};
window.addEventListener("keydown", e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup",   e => { keys[e.key.toLowerCase()] = false; });

let mouseX = WORLD_W / 2, mouseY = WORLD_H / 2;
canvas.addEventListener("mousemove", e => {
    const r  = canvas.getBoundingClientRect();
    const sx = canvas.width  / r.width;
    const sy = canvas.height / r.height;
    mouseX   = (e.clientX - r.left) * sx;
    mouseY   = (e.clientY - r.top)  * sy;
});

let lastShot = 0;
canvas.addEventListener("click", () => {
    const now = performance.now();
    if (now - lastShot < SHOOT_COOLDOWN || gameOver) return;
    lastShot = now;
    if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "shoot" }));
});

// ════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════
let socket;

function connect() {
    setStatus("connecting");
    socket = new WebSocket(`${WORKER_URL}/room/${ROOM_ID}`);
    socket.addEventListener("open",    () => setStatus("connected"));
    socket.addEventListener("message", e  => handleMsg(JSON.parse(e.data)));
    socket.addEventListener("close",   () => { setStatus("disconnected"); setTimeout(connect, 2500); });
    socket.addEventListener("error",   () => setStatus("disconnected"));
}

function handleMsg(msg) {
    switch (msg.type) {
        case "init":
            myId    = msg.playerId;
            WORLD_W = msg.worldW;
            WORLD_H = msg.worldH;
            serverPlayers = msg.state.players;
            serverBullets = msg.state.bullets;
            serverEnemies = msg.state.enemies;
            currentWave   = msg.state.wave;
            resizeCanvas();
            buildNebulas();
            updateHUD();
            break;
        case "tick":
            serverPlayers = msg.players;
            serverBullets = msg.bullets;
            serverEnemies = msg.enemies;
            currentWave   = msg.wave;
            score = serverPlayers[myId]?.score ?? score;
            updateHUD();
            break;
        case "explosion":
            spawnExplosion(msg.x, msg.y, ["#ff6030","#ff9030","#ffcc00","#ffffff"], 22, 5);
            spawnExplosion(msg.x, msg.y, ["#ff2060","#8b0030"], 12, 3);
            break;
        case "player_dead":
            spawnExplosion(msg.x, msg.y, ["#00e5ff","#0080ff","#ffffff"], 28, 6);
            if (msg.playerId === myId) { gameOver = true; showGameOver(); }
            break;
        case "new_wave":
            currentWave = msg.wave;
            waveFlash   = 40;
            updateHUD();
            break;
    }
}

// ── Input → Server ────────────────────────────────────────
let lastInput = 0;
const INPUT_RATE = 33;

function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;
    let vx = 0, vy = 0;
    if (keys["w"] || keys["arrowup"])    vy -= 1;
    if (keys["s"] || keys["arrowdown"])  vy += 1;
    if (keys["a"] || keys["arrowleft"])  vx -= 1;
    if (keys["d"] || keys["arrowright"]) vx += 1;
    if (vx && vy) { vx *= 0.707; vy *= 0.707; }
    const me    = serverPlayers[myId];
    const angle = me ? Math.atan2(mouseY - me.y, mouseX - me.x) : 0;
    socket.send(JSON.stringify({ type: "move", vx, vy, angle }));
}

// ════════════════════════════════════════════════════════
//  HUD
// ════════════════════════════════════════════════════════
function updateHUD() {
    const el = document.getElementById("score");
    if (el) el.textContent = String(score).padStart(6, "0");
    const wn = document.getElementById("wave-num");
    if (wn) wn.textContent = String(currentWave);
    const pc = document.getElementById("player-count");
    if (pc) pc.textContent = String(Object.keys(serverPlayers).length);
}

function setStatus(s) {
    const el = document.getElementById("connection-status");
    if (!el) return;
    const map = {
        connecting:   ["status-connecting", "◆ CONECTANDO..."],
        connected:    ["status-connected",  "◆ CONECTADO"],
        disconnected: ["status-disconnected","◆ DESCONECTADO"],
    };
    el.className   = map[s][0];
    el.textContent = map[s][1];
}

function showGameOver() {
    const ov = document.getElementById("screen-overlay");
    if (!ov) return;
    ov.classList.remove("hidden");
    const se = document.getElementById("overlay-score");
    if (se) se.textContent = `PUNTOS: ${String(score).padStart(6,"0")}`;
}

document.getElementById("restart-btn")?.addEventListener("click", () => {
    document.getElementById("screen-overlay")?.classList.add("hidden");
    gameOver = false;
    socket?.close();
});

// ════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════
let tick = 0;

function gameLoop(now) {
    requestAnimationFrame(gameLoop);
    tick++;

    if (now - lastInput >= INPUT_RATE) { sendInput(); lastInput = now; }

    updateParticles();

    drawBackground(tick);
    drawWaveFlash();
    drawBullets(serverBullets, myId);
    drawEnemies(serverEnemies);
    drawPlayers(serverPlayers, myId, mouseX, mouseY);
    drawParticles();
}

connect();
requestAnimationFrame(gameLoop);
