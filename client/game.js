// ════════════════════════════════════════════════════════
//  SPEAKERDUST  –  Pixel Art Space Shooter Client Engine
// ════════════════════════════════════════════════════════

// ── Config ──────────────────────────────────────────────
const WORKER_URL = "ws://localhost:8787";
const ROOM_ID    = "sala-1";
const SHOOT_COOLDOWN_MS = 220;
const STAR_COUNT = 180;
const PARTICLE_LIFETIME = 28;
const SCROLL_SPD = 0.4;

// ── Canvas setup ─────────────────────────────────────────
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

// ── Pixel-art helpers ─────────────────────────────────────
/**
 * Draw a pixel-art ship using a bitmap matrix.
 * @param {number[][]} grid  2D array; 0=empty, 1=body, 2=cockpit, 3=engine, 4=weapon
 * @param {number} cx  centre x
 * @param {number} cy  centre y
 * @param {number} angle  rotation in radians
 * @param {string} color  base color
 * @param {number} ps  pixel size (default 4)
 */
function drawPixelShip(grid, cx, cy, angle, color, ps = 4) {
    const rows = grid.length;
    const cols = grid[0].length;
    const offX = -Math.floor(cols / 2);
    const offY = -Math.floor(rows / 2);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle + Math.PI / 2);

    // Parse base color to get variants
    const isHSL = color.startsWith("hsl");
    const cockpitColor = isHSL ? color.replace(/\d+%\)/, "90%)") : "#b0e8ff";
    const engineColor  = "#ff7b00";
    const weaponColor  = "#ff2a6d";

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const v = grid[r][c];
            if (!v) continue;
            const px = (offX + c) * ps;
            const py = (offY + r) * ps;
            if (v === 1) ctx.fillStyle = color;
            else if (v === 2) ctx.fillStyle = cockpitColor;
            else if (v === 3) ctx.fillStyle = engineColor;
            else if (v === 4) ctx.fillStyle = weaponColor;
            ctx.fillRect(px, py, ps, ps);
        }
    }
    ctx.restore();
}

// ── Ship bitmaps ──────────────────────────────────────────
// Player ship – sleek fighter (9×11)
const SHIP_PLAYER = [
    [0,0,0,0,1,0,0,0,0],
    [0,0,0,1,2,1,0,0,0],
    [0,0,1,1,2,1,1,0,0],
    [0,1,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1,1],
    [0,4,1,1,1,1,1,4,0],
    [0,0,1,1,1,1,1,0,0],
    [0,0,3,0,1,0,3,0,0],
    [0,0,3,0,0,0,3,0,0],
];

// Enemy ship – angular invader (9×9)
const SHIP_ENEMY = [
    [0,1,0,0,0,0,0,1,0],
    [0,1,1,0,1,0,1,1,0],
    [1,1,1,1,1,1,1,1,1],
    [1,4,1,1,2,1,1,4,1],
    [1,1,1,1,1,1,1,1,1],
    [0,1,1,0,1,0,1,1,0],
    [0,0,3,0,0,0,3,0,0],
];

// ── State ────────────────────────────────────────────────
let myId     = null;
let gameOver = false;
let score    = 0;

let serverPlayers = {};
let serverBullets = {};
let serverEnemies = {};
let currentWave   = 1;

// Local particles for effects (client-only)
let particles = [];

// Stars (parallax background)
const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * WORLD_W,
    y: Math.random() * WORLD_H,
    r: Math.random() * 1.5 + 0.5,
    speed: Math.random() * 0.6 + 0.2,
    alpha: Math.random() * 0.5 + 0.3,
}));

// ── Input ─────────────────────────────────────────────────
const keys = {};
window.addEventListener("keydown", e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup",   e => { keys[e.key.toLowerCase()] = false; });

let mouseX = WORLD_W / 2, mouseY = WORLD_H / 2;
canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width  / r.width;
    const sy = canvas.height / r.height;
    mouseX = (e.clientX - r.left) * sx;
    mouseY = (e.clientY - r.top)  * sy;
});

let lastShot = 0;
canvas.addEventListener("click", () => {
    const now = performance.now();
    if (now - lastShot < SHOOT_COOLDOWN_MS || gameOver) return;
    lastShot = now;
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "shoot" }));
    }
});

// ── WebSocket ─────────────────────────────────────────────
let socket;

function connect() {
    setStatus("connecting");
    socket = new WebSocket(`${WORKER_URL}/room/${ROOM_ID}`);

    socket.addEventListener("open", () => setStatus("connected"));

    socket.addEventListener("message", e => {
        const msg = JSON.parse(e.data);
        handleServerMsg(msg);
    });

    socket.addEventListener("close", () => {
        setStatus("disconnected");
        setTimeout(connect, 2500);
    });

    socket.addEventListener("error", () => {
        setStatus("disconnected");
    });
}

function handleServerMsg(msg) {
    switch (msg.type) {
        case "init":
            myId    = msg.playerId;
            WORLD_W = msg.worldW;
            WORLD_H = msg.worldH;
            resizeCanvas();
            serverPlayers = msg.state.players;
            serverBullets = msg.state.bullets;
            serverEnemies = msg.state.enemies;
            currentWave   = msg.state.wave;
            updateHUD();
            break;

        case "tick":
            serverPlayers = msg.players;
            serverBullets = msg.bullets;
            serverEnemies = msg.enemies;
            currentWave   = msg.wave;
            if (myId && serverPlayers[myId]) {
                score = serverPlayers[myId].score;
            }
            updateHUD();
            break;

        case "explosion":
            spawnExplosion(msg.x, msg.y, "#ff7b00", 18);
            spawnExplosion(msg.x, msg.y, "#ff2a6d", 10);
            break;

        case "player_dead":
            spawnExplosion(msg.x, msg.y, "#00f0ff", 24);
            if (msg.playerId === myId) {
                gameOver = true;
                showGameOver();
            }
            break;

        case "new_wave":
            currentWave = msg.wave;
            updateHUD();
            break;
    }
}

// ── Input → Server ────────────────────────────────────────
let lastSendTick = 0;

function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;

    let vx = 0, vy = 0;
    if (keys["w"] || keys["arrowup"])    vy -= 1;
    if (keys["s"] || keys["arrowdown"])  vy += 1;
    if (keys["a"] || keys["arrowleft"])  vx -= 1;
    if (keys["d"] || keys["arrowright"]) vx += 1;

    // Normalise diagonal
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    // Angle toward mouse
    const me = serverPlayers[myId];
    const angle = me ? Math.atan2(mouseY - me.y, mouseX - me.x) : 0;

    socket.send(JSON.stringify({ type: "move", vx, vy, angle }));
}

// ── Particles ─────────────────────────────────────────────
function spawnExplosion(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd   = Math.random() * 5 + 1;
        particles.push({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            size: Math.random() * 5 + 2,
            color,
            life: PARTICLE_LIFETIME,
            maxLife: PARTICLE_LIFETIME,
        });
    }
}

function updateParticles() {
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.life--;
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        const s = Math.ceil(p.size * (p.life / p.maxLife));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    ctx.globalAlpha = 1;
}

// ── Background ────────────────────────────────────────────
function drawBackground() {
    // Deep space
    ctx.fillStyle = "#04050f";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Subtle grid
    ctx.strokeStyle = "rgba(15,20,60,0.7)";
    ctx.lineWidth   = 1;
    const grid = 40;
    for (let x = 0; x < WORLD_W; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 0; y < WORLD_H; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }

    // Stars (scrolling down slowly for depth)
    for (const s of stars) {
        s.y = (s.y + s.speed) % WORLD_H;
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.ceil(s.r), Math.ceil(s.r));
    }
    ctx.globalAlpha = 1;
}

// ── Draw bullets ──────────────────────────────────────────
function drawBullets() {
    for (const b of Object.values(serverBullets)) {
        const isMyBullet = b.ownerId === myId;
        ctx.shadowBlur  = 8;
        ctx.shadowColor = isMyBullet ? "#00f0ff" : "#ff2a6d";
        ctx.fillStyle   = isMyBullet ? "#a0fffe" : "#ff8fa0";
        ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 4, 4, 8);
        ctx.shadowBlur  = 0;
    }
}

// ── Draw enemies ──────────────────────────────────────────
function drawEnemies() {
    for (const e of Object.values(serverEnemies)) {
        // Glow
        ctx.shadowBlur  = 14;
        ctx.shadowColor = "#ff2a6d";
        drawPixelShip(SHIP_ENEMY, Math.round(e.x), Math.round(e.y), e.angle, "#cc0044", 3);
        ctx.shadowBlur  = 0;

        // HP bar
        const barW = 24, barH = 3;
        const bx = Math.round(e.x - barW / 2);
        const by = Math.round(e.y - 24);
        const maxHp = 2 + Math.floor(e.wave / 3);
        ctx.fillStyle = "#3a0018";
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = "#ff2a6d";
        ctx.fillRect(bx, by, Math.round(barW * (e.hp / maxHp)), barH);
    }
}

// ── Draw players ──────────────────────────────────────────
function drawPlayers() {
    for (const [id, p] of Object.entries(serverPlayers)) {
        if (!p.alive) continue;
        const isMe = id === myId;

        // Glow for local player
        ctx.shadowBlur  = isMe ? 18 : 10;
        ctx.shadowColor = p.color;
        drawPixelShip(SHIP_PLAYER, Math.round(p.x), Math.round(p.y), p.angle, p.color, isMe ? 4 : 3);
        ctx.shadowBlur  = 0;

        // Crosshair / aim line for local player only
        if (isMe) {
            ctx.strokeStyle = "rgba(0,240,255,0.3)";
            ctx.lineWidth   = 1;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mouseX, mouseY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair at mouse
            ctx.strokeStyle = "rgba(0,240,255,0.7)";
            ctx.lineWidth = 1;
            const cs = 8;
            ctx.beginPath();
            ctx.moveTo(mouseX - cs, mouseY); ctx.lineTo(mouseX + cs, mouseY);
            ctx.moveTo(mouseX, mouseY - cs); ctx.lineTo(mouseX, mouseY + cs);
            ctx.stroke();
        }

        // Score tag
        if (isMe) {
            ctx.fillStyle   = "rgba(0,240,255,0.7)";
            ctx.font        = "6px 'Press Start 2P', monospace";
            ctx.textAlign   = "center";
            ctx.fillText(`${p.score}`, Math.round(p.x), Math.round(p.y - 30));
        }
    }
}

// ── HUD & UI helpers ──────────────────────────────────────
function updateHUD() {
    const scoreEl = document.getElementById("score");
    if (scoreEl) scoreEl.textContent = String(score).padStart(6, "0");

    const waveEl = document.getElementById("wave-num");
    if (waveEl) waveEl.textContent = String(currentWave);

    const pcEl = document.getElementById("player-count");
    if (pcEl) pcEl.textContent = String(Object.keys(serverPlayers).length);
}

function setStatus(s) {
    const el = document.getElementById("connection-status");
    if (!el) return;
    if (s === "connecting")    { el.className = "status-connecting"; el.textContent = "◆ CONECTANDO..."; }
    if (s === "connected")     { el.className = "status-connected";  el.textContent = "◆ CONECTADO"; }
    if (s === "disconnected")  { el.className = "status-disconnected"; el.textContent = "◆ DESCONECTADO"; }
}

function showGameOver() {
    const overlay = document.getElementById("screen-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    const scoreEl = document.getElementById("overlay-score");
    if (scoreEl) scoreEl.textContent = `PUNTOS: ${String(score).padStart(6, "0")}`;
}

document.getElementById("restart-btn")?.addEventListener("click", () => {
    document.getElementById("screen-overlay")?.classList.add("hidden");
    gameOver = false;
    // Server will keep the player; just reconnect
    socket?.close();
});

// ── Main game loop ────────────────────────────────────────
let lastInputTime = 0;
const INPUT_RATE  = 33; // ~30 fps input sends

function gameLoop(now) {
    requestAnimationFrame(gameLoop);

    // Throttle input sends
    if (now - lastInputTime >= INPUT_RATE) {
        sendInput();
        lastInputTime = now;
    }

    updateParticles();

    // Render
    drawBackground();
    drawBullets();
    drawEnemies();
    drawPlayers();
    drawParticles();
}

// ── Boot ──────────────────────────────────────────────────
connect();
requestAnimationFrame(gameLoop);
