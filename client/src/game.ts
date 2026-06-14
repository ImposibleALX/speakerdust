import { SHIP_CLASSES } from "@speakerdust/shared";
import type { ShipClass } from "../../src/core/ships/shipTypes";
import { createPixelShipRenderer } from "./renderer/renderer";
import { createMountRenderer, type MountRenderer, type MountContext } from "./mounts/index";
import { getProjectileRenderer } from "./projectiles/index";

const ALL_CLASSES: ShipClass[] = ["corvette", "destroyer", "missile_frigate", "cruiser", "battlecruiser", "battleship", "dreadnought"];
import {
    INPUT_RATE, SPECTATOR_CAM_SPEED, COOLDOWN_TABLE, QUICK_CHAT,
    PAL_FLASH_RED, FIXED_DT,
} from "./constants";
import {
    myId, myTeam, myWeapon, myShield, myMaxShield, myMaxHp,
    myBoostEnergy, myHeat, gameOver, respawnState, respawnTimer,
    setRespawnState, setRespawnTimer, setMyTeam,
    score, serverPlayers, serverBullets, serverEnemies, serverZones,
    currentWave, lastTickTime, waveFlash, setWaveFlash, WORLD_W, WORLD_H,
} from "./gameState";
import {
    canvas, adminPanel, adminClose, adminAuthForm, adminKeyInput,
    adminResetAllBtn, adminClearEnemiesBtn, adminWaveInput,
    adminSetWaveBtn, adminJoinRed, adminJoinBlue, adminGodmodeBtn,
    adminHealBtn, adminResetDataBtn, restartBtn,
    setDiff, updateTeamBadge, hideGameOver,
    playerDamageFlashUntil,
    drawWaveFlash, drawShieldRing, drawCrosshair, drawCooldownBar,
    drawPlayerLabel, drawEnemyHPBar, drawClassSelector,
} from "./uiManager";
import { cameraX, cameraY, shakeX, shakeY, setCameraPosition, offsetCamera, updateScreenShake } from "./camera";
import {
    renderPlayers, renderEnemies, renderBullets,
    syncShipPhysics, extrapolateBullets,
} from "./stateManager";
import { tickParticles, drawParticles, clearParticles } from "./particleSystem";
import { updateAudio } from "./audioManager";
import { connect, send, socket } from "./networkManager";

const ctx2d = canvas.getContext("2d", { alpha: false })!;
let viewW = 0, viewH = 0;

export function resizeCanvas(): void {
    const hudEl = document.getElementById("hud")!;
    const statusBarEl = document.getElementById("status-bar")!;
    const hudH = hudEl?.offsetHeight ?? 0;
    const statH = statusBarEl?.offsetHeight ?? 0;
    viewW = window.innerWidth;
    viewH = window.innerHeight - hudH - statH;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
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

const { drawPixelShip, drawHitboxOverlay } = createPixelShipRenderer(ctx2d);

interface Star {
    x: number; y: number; size: number; speed: number;
    alpha: number; tw: number; tws: number;
}
let stars: Star[] = [];
const nebOffscreen = document.createElement("canvas");
let nebBuilt = false;

export function generateStars(): void {
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

export function onWorldResize(): void {
    resizeCanvas();
    generateStars();
    nebBuilt = false;
}

function drawBackground(): void {
    ctx2d.fillStyle = "#02030e";
    ctx2d.fillRect(cameraX, cameraY, viewW, viewH);

    if (!nebBuilt) buildNebulas();

    ctx2d.strokeStyle = "rgba(8,15,48,0.5)";
    ctx2d.lineWidth = 1;
    const startX = Math.floor(cameraX / 48) * 48;
    const startY = Math.floor(cameraY / 48) * 48;
    const endX = cameraX + viewW + 48;
    const endY = cameraY + viewH + 48;
    for (let x = startX; x < endX; x += 48) {
        ctx2d.beginPath(); ctx2d.moveTo(x, cameraY); ctx2d.lineTo(x, endY); ctx2d.stroke();
    }
    for (let y = startY; y < endY; y += 48) {
        ctx2d.beginPath(); ctx2d.moveTo(cameraX, y); ctx2d.lineTo(endX, y); ctx2d.stroke();
    }

    const wrapS = 2000;
    for (const s of stars) {
        const px = ((s.x - cameraX * (s.speed * 1.5)) % wrapS + wrapS) % wrapS;
        const py = ((s.y - cameraY * (s.speed * 1.5)) % wrapS + wrapS) % wrapS;
        if (px < 0 || px > viewW || py < 0 || py > viewH) continue;
        ctx2d.globalAlpha = s.alpha * (0.6 + 0.4 * Math.sin(s.tw));
        ctx2d.fillStyle = "#ffffff";
        ctx2d.fillRect(px + cameraX, py + cameraY, s.size, s.size);
    }
    ctx2d.globalAlpha = 1;
}

function drawObjectives(zones: Record<string, any>): void {
    for (const id in zones) {
        const zone = zones[id];
        const ownerColor = zone.owner === "red" ? "#ff3355"
            : zone.owner === "blue" ? "#3399ff"
                : zone.owner === "enemies" ? "#ff4a88" : "#7f8aa8";
        const alpha = zone.owner === "neutral" ? 0.12 : 0.2;
        const fill = ctx2d.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radius);
        fill.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`);
        fill.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.45})`);
        fill.addColorStop(1, "transparent");

        ctx2d.save();
        ctx2d.fillStyle = fill;
        ctx2d.beginPath(); ctx2d.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2); ctx2d.fill();

        ctx2d.strokeStyle = ownerColor;
        ctx2d.lineWidth = 2;
        ctx2d.shadowBlur = 14; ctx2d.shadowColor = ownerColor;
        ctx2d.beginPath(); ctx2d.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2); ctx2d.stroke();
        ctx2d.shadowBlur = 0;

        ctx2d.strokeStyle = ownerColor;
        ctx2d.globalAlpha = 0.5;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath(); ctx2d.arc(zone.x, zone.y, zone.radius * 0.62, 0, Math.PI * 2); ctx2d.stroke();

        const prog = myTeam === "red" ? zone.redProgress : zone.blueProgress;
        if (prog > 0) {
            ctx2d.save();
            ctx2d.beginPath();
            ctx2d.arc(zone.x, zone.y, zone.radius + 6, -Math.PI / 2, -Math.PI / 2 + (prog / 100) * Math.PI * 2);
            ctx2d.strokeStyle = myTeam === "red" ? "#ff3355" : "#3399ff";
            ctx2d.lineWidth = 3;
            ctx2d.shadowBlur = 10;
            ctx2d.shadowColor = ctx2d.strokeStyle;
            ctx2d.stroke();
            ctx2d.restore();
        }

        ctx2d.globalAlpha = 0.9;
        ctx2d.fillStyle = ownerColor;
        ctx2d.font = "7px 'Press Start 2P', monospace";
        ctx2d.textAlign = "center";
        ctx2d.fillText(zone.label || "ZONA", zone.x, zone.y - zone.radius - 10);
        ctx2d.font = "6px 'Press Start 2P', monospace";
        const maxProgress = Math.max(zone.redProgress || 0, zone.blueProgress || 0, zone.enemyProgress || 0);
        ctx2d.fillText(`${Math.round(maxProgress)}%`, zone.x, zone.y + zone.radius + 12);
        ctx2d.restore();
    }
}

function drawBullets(bullets: Record<string, any>): void {
    const margin = 150;
    for (const id in bullets) {
        const b = bullets[id];
        if (!b || typeof b.kind !== "string") continue;
        const renderer = getProjectileRenderer(b.kind);
        renderer.render(ctx2d, b, cameraX, cameraY, viewW, viewH, margin);
    }
}

function parseHSL(hsl: string): number[] {
    const m = hsl.match(/[\d.]+/g);
    return m ? m.map(Number) : [180, 80, 60];
}

const _palCache = new Map<string, Record<number, string>>();

function makePlayerPalette(hsl: number[], team: string): Record<number, string> {
    const [h = 180, s = 80, l = 60] = hsl;
    const key = team + "|" + h + "|" + s + "|" + l;
    const cached = _palCache.get(key);
    if (cached) return cached;
    const tintH = team === "red" ? 0 : team === "blue" ? 210 : h;
    const useH = team ? tintH : h;
    const pal: Record<number, string> = {
        1: `hsl(${useH},${s}%,${l}%)`,
        2: `hsl(${useH},${s - 10}%,${Math.min(l + 20, 90)}%)`,
        3: `hsl(${(useH + 200) % 360},${Math.max(s - 30, 30)}%,${Math.max(l - 20, 30)}%)`,
        4: `hsl(${(useH + 40) % 360},${s}%,${Math.max(l - 15, 15)}%)`,
        5: `hsl(${useH},${Math.max(s - 20, 20)}%,${Math.min(l + 10, 80)}%)`,
        6: `hsl(${useH},${s}%,${Math.max(l - 35, 10)}%)`,
        7: `hsl(${(useH + 20) % 360},${Math.max(s - 5, 40)}%,${Math.min(l + 5, 85)}%)`,
        8: "#a0eeff",
    };
    _palCache.set(key, pal);
    return pal;
}

// SO: Renderizar TODAS las monturas de una nave (armas + motores) mediante MountRenderer
// R: https://stackoverflow.com/questions/2805591/oop-inheritance-patterns-for-game-entities
//    Cada attachment se resuelve a un MountRenderer via Factory (createMountRenderer).
//    No más funciones sueltas drawShipEngines() o renderWeaponAttachments().
//    Para debug: showHitboxOverlay=true dibuja hitboxes (tecla G).

const mountCache = new Map<string, MountRenderer[]>();

function getMountRenderers(shipClass: string, loadout: Record<string, any> | undefined, color: string): MountRenderer[] {
  const cacheKey = `${shipClass}_${color}`;
  const cached = mountCache.get(cacheKey);
  if (cached) return cached;

  const def = SHIP_CLASSES[shipClass];
  if (!def) return [];

  const renderers: MountRenderer[] = [];
  for (const att of def.visual.attachments) {
    const r = createMountRenderer(att, loadout, color);
    renderers.push(r);
  }
  mountCache.set(cacheKey, renderers);
  return renderers;
}

// SO: Scratch MountContext mutable — evita el spread operator {…} en hot path
// R: https://stackoverflow.com/questions/29902823/object-pooling-for-game-objects-in-javascript
//    https://stackoverflow.com/questions/48822/object-pool-pattern
//    Spread crea un objeto nuevo por llamada. Con 20 naves × 6 monturas × 60fps
//    son ~7200 objetos/segundo al GC. Mutar campos en-place: 0 allocaciones.
const _mc: MountContext = { shipX: 0, shipY: 0, shipAngle: 0, ps: 0, tick: 0 };

function renderShipMounts(
  x: number, y: number, angle: number, shipClass: string,
  loadout: Record<string, any> | undefined, turretAngles: Record<string, number> | undefined,
  ps: number, tick: number, color: string,
): void {
  const renderers = getMountRenderers(shipClass, loadout, color);
  _mc.shipX = x; _mc.shipY = y; _mc.shipAngle = angle; _mc.ps = ps; _mc.tick = tick;

  for (const r of renderers) {
    _mc.turretAngle = turretAngles?.[r.mount.id];
    r.render(ctx2d, _mc);
  }
}

function renderShipMountsDebug(
  x: number, y: number, angle: number, shipClass: string,
  loadout: Record<string, any> | undefined, turretAngles: Record<string, number> | undefined,
  ps: number, tick: number, color: string,
): void {
  const renderers = getMountRenderers(shipClass, loadout, color);
  _mc.shipX = x; _mc.shipY = y; _mc.shipAngle = angle; _mc.ps = ps; _mc.tick = tick;

  for (const r of renderers) {
    _mc.turretAngle = turretAngles?.[r.mount.id];
    r.debugDraw(ctx2d, _mc);
  }
}

function drawEnemies(enemies: Record<string, any>): void {
    for (const id in enemies) {
        const e = enemies[id];
        const ps = 3;
        const shipClass = e.shipClass || "corvette";
        const def = SHIP_CLASSES[shipClass];
        if (!def) continue;

        const glowC = def.visual.glowColor;
        const pal = def.visual.palette;
        const r2 = Math.hypot(def.visual.w, def.visual.h) * 1.5;
        const hpBarWidth = Math.round(r2 * 0.9);
        const hpBarYOffset = Math.round(def.visual.h / 2 + 8);
        const rx = e.x;
        const ry = e.y;
        const turretAngles: Record<string, number> = {};
        if (e.turrets) for (const t of e.turrets) turretAngles[t.id] = t.angle;
        renderShipMounts(rx, ry, e.heading ?? e.angle, shipClass, def.defaultLoadout, turretAngles, ps, Math.floor(performance.now() / 50), glowC);
        if (showHitboxOverlay) renderShipMountsDebug(rx, ry, e.heading ?? e.angle, shipClass, def.defaultLoadout, turretAngles, ps, Math.floor(performance.now() / 50), glowC);

        drawPixelShip(def.visual, rx, ry, e.heading ?? e.angle, pal, ps, glowC, 0);
        if (showHitboxOverlay) drawHitboxOverlay(def.visual, rx, ry, e.heading ?? e.angle, ps);

        const maxHpSafe = e.maxHp > 0 ? e.maxHp : 10;
        const pct = Math.max(0, Math.min(1, e.hp / maxHpSafe));
        drawEnemyHPBar(ctx2d, e.x, e.y - hpBarYOffset, pct, hpBarWidth, glowC);
    }
}

function drawPlayers(
    players: Record<string, any>, myId: string | null,
    mx: number, my: number, myShield: number,
    keys: Record<string, boolean>, myTeam: string, myWeapon: string,
    playerDamageFlashUntil: number, myBoostEnergy: number,
    serverPlayers: Record<string, any>, gameOver: boolean,
): void {
    for (const id in players) {
        const p = players[id];
        if (!p.alive) continue;
        const isMe = id === myId;
        const prx = p.x;
        const pry = p.y;

        const playerDef = SHIP_CLASSES[p.shipClass || "corvette"];
        let pal = playerDef?.visual.palette ?? makePlayerPalette([180, 80, 60], p.team);
        if (isMe && performance.now() < playerDamageFlashUntil) {
            pal = PAL_FLASH_RED;
        }

        const teamGlow = p.team === "red" ? "#ff3355" : p.team === "blue" ? "#3399ff" : (p.color ?? "#ffffff");

        const ps = 3;
        const trailColor = p.team === "red" ? "#ff5500" : (p.team === "blue" ? "#00aaff" : "#ffffff");

        if (playerDef) {
            const turretAngles: Record<string, number> = {};
            if (p.turrets) for (const t of p.turrets) turretAngles[t.id] = t.angle;
            renderShipMounts(prx, pry, p.heading ?? p.angle, p.shipClass || "corvette", playerDef.defaultLoadout, turretAngles, 3, Math.floor(performance.now() / 50), trailColor);
            if (showHitboxOverlay) renderShipMountsDebug(prx, pry, p.heading ?? p.angle, p.shipClass || "corvette", playerDef.defaultLoadout, turretAngles, 3, Math.floor(performance.now() / 50), trailColor);
            drawPixelShip(playerDef.visual, prx, pry, p.heading ?? p.angle, pal, 3, teamGlow, 0);
            if (showHitboxOverlay) drawHitboxOverlay(playerDef.visual, prx, pry, p.heading ?? p.angle, 3);
        }

        const isBoosting = isMe 
            ? (keys["shift"] || (serverPlayers[myId!]?.boostCooldown > 0)) && myBoostEnergy >= 28
            : (serverPlayers[id]?.boostCooldown > 0);

        if (isBoosting) {
            const mx_boost = -Math.cos(p.heading ?? p.angle);
            const my_boost = -Math.sin(p.heading ?? p.angle);
            ctx2d.globalAlpha = 0.7;
            ctx2d.fillStyle = "#00ccff";
            for (let i = 0; i < 6; i++) {
                const t = performance.now() * 0.01 + i * 1.3;
                const ex = p.x + mx_boost * (18 + i * 4) + Math.sin(t) * 2.5;
                const ey = p.y + my_boost * (18 + i * 4) + Math.cos(t + 0.7) * 2.5;
                ctx2d.fillRect(ex, ey, 3, 3);
            }
            ctx2d.globalAlpha = 1;
        }

        if (isMe) {
            if (myShield > 0) {
                drawShieldRing(ctx2d, prx, pry, myShield);
            }
        }

        if (isMe && !gameOver) {
            drawCrosshair(ctx2d, p.x, p.y, mx, my);

            const now = performance.now();
            const cd = (COOLDOWN_TABLE as Record<string, number>)[myWeapon] || 200;
            const elapsed = now - lastShot;
            const remaining = Math.max(0, cd - elapsed);
            if (remaining > 0) {
                drawCooldownBar(ctx2d, mx, my, remaining / cd);
            }
        }

        const tagY = p.y - (isMe ? 42 : 30);
        drawPlayerLabel(ctx2d, p.x, tagY, p.name ?? "", p.score ?? 0, isMe, p.team);
    }
}

const keys: Record<string, boolean> = {};
let isMouseShooting = false;

let showHitboxOverlay = false;

window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "g" && !keys["g"]) {
        showHitboxOverlay = !showHitboxOverlay;
    }
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
    if (e.key === "[" || e.key === "]") {
        const myClass = serverPlayers[myId!]?.shipClass || "corvette";
        const idx = ALL_CLASSES.indexOf(myClass);
        const dir = e.key === "]" ? 1 : -1;
        const next = ALL_CLASSES[(idx + dir + ALL_CLASSES.length) % ALL_CLASSES.length]!;
        if (next !== myClass) send("changeClass", { shipClass: next });
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        adminPanel?.classList.toggle("hidden");
        canvas.style.cursor = adminPanel?.classList.contains("hidden") ? "none" : "default";
    }
    if (e.key.toLowerCase() === "f10") {
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
let screenMx = window.innerWidth / 2, screenMy = window.innerHeight / 2;
let lastShot = 0;

window.addEventListener("mousemove", (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    screenMx = e.clientX - r.left;
    screenMy = e.clientY - r.top;
});
canvas.addEventListener("mousedown", (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const clickX = e.clientX - r.left;
    const clickY = e.clientY - r.top;
    // BUGFIX: Match the draw offset used in drawClassSelector (viewH - btnH - 50)
    const btnW = 95;
    const btnH = 26;
    const gap = 8;
    const totalW = ALL_CLASSES.length * (btnW + gap) - gap;
    const startX = (viewW - totalW) / 2;
    const selectorY = viewH - btnH - 50;

    if (e.button === 0 && clickY >= selectorY && clickY <= selectorY + btnH) {
        for (let i = 0; i < ALL_CLASSES.length; i++) {
            const x = startX + i * (btnW + gap);
            if (clickX >= x && clickX <= x + btnW) {
                const cls = ALL_CLASSES[i]!;
                if (cls !== (serverPlayers[myId!]?.shipClass || "corvette")) send("changeClass", { shipClass: cls });
                return;
            }
        }
    }

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

function fireShot(): void {
    const now = performance.now();
    const cd = (COOLDOWN_TABLE as Record<string, number>)[myWeapon] ?? 200;
    // BUGFIX: Only block if gameOver is truly set, not if we just respawned
    if (gameOver) return;
    if (now - lastShot < cd) return;
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
    setMyTeam("red");
    updateTeamBadge("red");
});
adminJoinBlue?.addEventListener("click", () => {
    send("set_team", { team: "blue" });
    setMyTeam("blue");
    updateTeamBadge("blue");
});
adminGodmodeBtn?.addEventListener("click", () => send("admin_godmode"));
adminHealBtn?.addEventListener("click", () => send("admin_heal_all"));
adminResetDataBtn?.addEventListener("click", () => {
    localStorage.clear();
    setDiff(adminResetDataBtn, "DATA CLEARED");
    setTimeout(() => { window.location.reload(); }, 500);
});

restartBtn?.addEventListener("click", () => {
    if (respawnState === "requesting") return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    setRespawnState("requesting");
    restartBtn.disabled = true;
    setDiff(restartBtn, "RESPAWNING...");
    send("respawn");
    if (respawnTimer) clearTimeout(respawnTimer);
    setRespawnTimer(setTimeout(() => {
        setRespawnState("idle");
        restartBtn.disabled = false;
        setDiff(restartBtn, "↻ RESPECTAR");
        setRespawnTimer(null);
    }, 5000));
});

let lastFrameTime = 0;
let lastInputTime = 0;
let accTime = 0;
let lastInputState = { throttle: 0, strafe: 0, turn: 0, aimAngle: 0 };

function sendInput(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || gameOver) return;
    let throttle = 0, strafe = 0, turn = 0;
    if (keys["w"] || keys["arrowup"]) throttle += 1;
    if (keys["s"] || keys["arrowdown"]) throttle -= 1;
    if (keys["q"]) strafe -= 1;
    if (keys["e"]) strafe += 1;
    if (keys["a"] || keys["arrowleft"]) turn -= 1;
    if (keys["d"] || keys["arrowright"]) turn += 1;
    const p = serverPlayers[myId!];
    let aimAngle = p ? Math.atan2(my - p.y, mx - p.x) : 0;
    aimAngle = Math.round(aimAngle * 100) / 100;
    let angleDiff = Math.abs(aimAngle - lastInputState.aimAngle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
    if (throttle !== lastInputState.throttle ||
        strafe !== lastInputState.strafe ||
        turn !== lastInputState.turn ||
        angleDiff > 0.03) {
        lastInputState.throttle = throttle;
        lastInputState.strafe = strafe;
        lastInputState.turn = turn;
        lastInputState.aimAngle = aimAngle;
        send("move", { throttle, strafe, turn, aimAngle });
    }
}

canvas.style.cursor = "none";
generateStars();

function gameLoop(now: number): void {
    requestAnimationFrame(gameLoop);

    updateStars();

    const dpr = window.devicePixelRatio || 1;
    const availW = Math.ceil(viewW);
    const availH = Math.ceil(viewH);
    const cameraCenterX = availW / 2;
    const cameraCenterY = availH / 2;

    const rawDt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    const smoothDt = rawDt * 60;
    syncShipPhysics(renderPlayers, serverPlayers, smoothDt);
    syncShipPhysics(renderEnemies, serverEnemies, smoothDt);
    if (lastTickTime > 0) {
        extrapolateBullets(serverBullets, lastTickTime);
    }

    const me = renderPlayers[myId!];
    if (me && !gameOver) {
        setCameraPosition(me.x - cameraCenterX, me.y - cameraCenterY);
    } else if (gameOver) {
        let panX = 0, panY = 0;
        if (keys["w"] || keys["arrowup"]) panY -= 1;
        if (keys["s"] || keys["arrowdown"]) panY += 1;
        if (keys["a"] || keys["arrowleft"]) panX -= 1;
        if (keys["d"] || keys["arrowright"]) panX += 1;
        offsetCamera(panX * SPECTATOR_CAM_SPEED, panY * SPECTATOR_CAM_SPEED);
    }

    mx = screenMx + cameraX;
    my = screenMy + cameraY;

    if (!gameOver && (isMouseShooting || keys[" "])) fireShot();
    if (now - lastInputTime >= INPUT_RATE) {
        sendInput();
        lastInputTime = now;
    }

    accTime += rawDt;
    while (accTime >= FIXED_DT) {
        tickParticles();
        accTime -= FIXED_DT;
    }

    const nearAudioEnemy = me && Object.values(renderEnemies).some(e => {
        const d = SHIP_CLASSES[e.shipClass || ""];
        return d && d.nearAudioDistance > 0 && Math.hypot(e.x - me.x, e.y - me.y) < d.nearAudioDistance;
    });
    updateAudio(nearAudioEnemy);

    updateScreenShake(now);

    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.fillStyle = "#000000";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    ctx2d.scale(dpr, dpr);
    ctx2d.translate(-cameraX - shakeX, -cameraY - shakeY);

    drawBackground();
    drawObjectives(serverZones);
    drawWaveFlash(ctx2d, (waveFlash / 50) * 0.3, WORLD_W, WORLD_H);
    drawBullets(renderBullets);
    drawEnemies(renderEnemies);
    drawPlayers(
        renderPlayers, myId, mx, my, myShield,
        keys, myTeam, myWeapon, playerDamageFlashUntil,
        myBoostEnergy, serverPlayers, gameOver,
    );
    drawParticles(ctx2d);

    ctx2d.setTransform(1, 0, 0, 1, 0, 0);

    if (waveFlash > 0) setWaveFlash(waveFlash - 1);

    drawClassSelector(ctx2d, ALL_CLASSES, serverPlayers[myId!]?.shipClass || "corvette", viewW, viewH);
}

connect();
requestAnimationFrame(gameLoop);
