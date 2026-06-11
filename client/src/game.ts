import { SHIP_CLASSES } from "@speakerdust/shared";
import type { ShipClass } from "../../src/core/ships/shipTypes";
import { createPixelShipRenderer } from "./renderer/renderer";

const ALL_CLASSES: ShipClass[] = ["corvette", "destroyer", "missile_frigate", "cruiser", "battlecruiser", "battleship", "dreadnought"];
import {
    INPUT_RATE, SPECTATOR_CAM_SPEED, COOLDOWN_TABLE, QUICK_CHAT,
    PAL_SCOUT, PAL_CRUISER_ENEMY, PAL_CAPITAL, PAL_FLASH_RED, FIXED_DT,
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
} from "./uiManager";
import { cameraX, cameraY, shakeX, shakeY, setCameraPosition, offsetCamera, updateScreenShake } from "./camera";
import {
    renderPlayers, renderEnemies, renderBullets,
    syncRenderState, syncShipPhysics, extrapolateBullets,
} from "./stateManager";
import { tickParticles, drawParticles, clearParticles } from "./particleSystem";
import { updateAudio } from "./audioManager";
import { connect, send, socket } from "./networkManager";

const ctx2d = canvas.getContext("2d")!;
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

const { drawPixelShip } = createPixelShipRenderer(ctx2d);

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

function drawWaveFlash(): void {
    if (waveFlash <= 0) return;
    ctx2d.globalAlpha = (waveFlash / 50) * 0.3;
    ctx2d.fillStyle = "#00e5ff";
    ctx2d.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx2d.globalAlpha = 1;
}

function drawBullets(bullets: Record<string, any>): void {
    for (const id in bullets) {
        const b = bullets[id];
        const margin = 150;
        if (b.x < cameraX - margin || b.y < cameraY - margin ||
            b.x > cameraX + viewW + margin || b.y > cameraY + viewH + margin) continue;

        const a = b.angle !== undefined ? b.angle : Math.atan2(b.vy, b.vx);
        const bx = b.x;
        const by = b.y;

        ctx2d.save();
        ctx2d.translate(bx, by);
        ctx2d.rotate(a);

        const kind = b.kind;
        if (kind === "naval_cannon") {
            ctx2d.shadowBlur = 14; ctx2d.shadowColor = "#ffd36a";
            ctx2d.fillStyle = "#ffb35a"; ctx2d.fillRect(-4, -4, 8, 8);
            ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "#ffd36a"; ctx2d.fillRect(-7, -7, 14, 14);
        } else if (kind === "autocannon") {
            ctx2d.shadowBlur = 8; ctx2d.shadowColor = "#a8ff78";
            ctx2d.fillStyle = "#ccffaa"; ctx2d.fillRect(-5, -1, 10, 3);
            ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "#a8ff78"; ctx2d.fillRect(-7, -3, 14, 7);
        } else if (kind === "plasma_broadside") {
            ctx2d.shadowBlur = 10; ctx2d.shadowColor = "#cc00ff";
            ctx2d.fillStyle = "#dd66ff"; ctx2d.fillRect(-3, -3, 6, 6);
            ctx2d.globalAlpha = 0.4; ctx2d.fillStyle = "#aa00ff"; ctx2d.fillRect(-5, -5, 10, 10);
        } else if (kind === "railgun") {
            ctx2d.shadowBlur = 10; ctx2d.shadowColor = "#00e5ff";
            ctx2d.fillStyle = "#ffffff"; ctx2d.fillRect(-12, -1, 24, 3);
            ctx2d.globalAlpha = 0.35; ctx2d.fillStyle = "#00e5ff"; ctx2d.fillRect(-15, -3, 30, 7);
        } else if (kind === "torpedo") {
            ctx2d.shadowBlur = 8; ctx2d.shadowColor = "#ff9030";
            ctx2d.fillStyle = "#ffaa00"; ctx2d.fillRect(-16, -3, 4, 6);
            ctx2d.fillStyle = "#ffffff"; ctx2d.fillRect(-14, -2, 2, 4);
            ctx2d.fillStyle = "#333333"; ctx2d.fillRect(-12, -5, 6, 10);
            ctx2d.fillStyle = "#aaaaaa"; ctx2d.fillRect(-6, -4, 12, 8);
            ctx2d.fillStyle = "#ff4444"; ctx2d.fillRect(6, -3, 6, 6);
            ctx2d.fillRect(12, -2, 2, 4);
        } else if (kind === "guided_missile") {
            ctx2d.shadowBlur = 4; ctx2d.shadowColor = "#ff6a3d";
            ctx2d.fillStyle = "#ffaa00"; ctx2d.fillRect(-12, -2, 3, 4);
            ctx2d.fillStyle = "#ffffff"; ctx2d.fillRect(-10, -1, 1, 2);
            ctx2d.fillStyle = "#888888"; ctx2d.fillRect(-9, -3, 5, 6);
            ctx2d.fillStyle = "#cccccc"; ctx2d.fillRect(-4, -2, 8, 4);
            ctx2d.fillStyle = "#555555"; ctx2d.fillRect(-6, -4, 4, 2);
            ctx2d.fillStyle = "#555555"; ctx2d.fillRect(-6, 2, 4, 2);
            ctx2d.fillStyle = "#ff4444"; ctx2d.fillRect(4, -2, 4, 4);
            ctx2d.fillRect(8, -1, 2, 2);
        } else if (kind === "energy_bomb") {
            ctx2d.shadowBlur = 18; ctx2d.shadowColor = "#ffe66d";
            ctx2d.fillStyle = "#ffcc00"; ctx2d.fillRect(-6, -6, 12, 12);
            ctx2d.fillStyle = "#ffffff"; ctx2d.fillRect(-2, -2, 4, 4);
            ctx2d.globalAlpha = 0.3; ctx2d.fillStyle = "#ffff66"; ctx2d.fillRect(-10, -10, 20, 20);
        } else if (kind === "emp_launcher") {
            ctx2d.shadowBlur = 12; ctx2d.shadowColor = "#66ccff";
            ctx2d.fillStyle = "#ccffff"; ctx2d.fillRect(-4, -4, 8, 8);
            ctx2d.globalAlpha = 0.4; ctx2d.fillStyle = "#3399ff"; ctx2d.fillRect(-8, -8, 16, 16);
        } else {
            ctx2d.fillStyle = "#ffffff"; ctx2d.fillRect(-2, -2, 4, 4);
        }

        ctx2d.globalAlpha = 1;
        ctx2d.shadowBlur = 0;
        ctx2d.restore();
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

function drawShipEngines(
    x: number, y: number, angle: number, shipClass: string,
    color: string, ps: number, reverse: boolean = false
): void {
    const def = SHIP_CLASSES[shipClass];
    if (!def) return;

    ctx2d.save();
    ctx2d.globalCompositeOperation = "screen";

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dir = reverse ? -1 : 1;

    for (const engine of def.attachments) {
        if (engine.kind !== "engine") continue;
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

            ctx2d.globalAlpha = (1 - t) * 0.7;
            ctx2d.fillStyle = i < 2 ? "#ffffff" : color;
            const sz = Math.max(1, Math.floor((1 - t) * width * (ps / 2.5)));
            ctx2d.fillRect(px, py, sz, sz);
        }
    }
    ctx2d.restore();
}

function drawEnemies(enemies: Record<string, any>): void {
    for (const id in enemies) {
        const e = enemies[id];
        const ps = 3;
        const shipClass = e.shipClass || "corvette";
        const def = SHIP_CLASSES[shipClass];
        if (!def) continue;

        const glowC = def.glowColor;
        const pal = def.paletteKey === "capital" ? PAL_CAPITAL : def.paletteKey === "cruiser" ? PAL_CRUISER_ENEMY : PAL_SCOUT;
        const r2 = def.boundingRadius;
        const shadowBlur = Math.max(10, Math.round(r2 * 0.45));
        const hpBarWidth = Math.round(r2 * 0.9);
        const hpBarYOffset = Math.round(def.h / 2 + 8);

        const rx = e.x;
        const ry = e.y;
        drawShipEngines(rx, ry, e.heading ?? e.angle, shipClass, glowC, ps);

        ctx2d.shadowBlur = shadowBlur;
        ctx2d.shadowColor = glowC;
        drawPixelShip(def, rx, ry, e.heading ?? e.angle, pal, ps);
        ctx2d.shadowBlur = 0;

        const maxHpSafe = e.maxHp > 0 ? e.maxHp : 10;
        const pct = Math.max(0, Math.min(1, e.hp / maxHpSafe));
        const bh = 3;
        const bx = e.x - hpBarWidth / 2;
        const by = e.y - hpBarYOffset;
        ctx2d.fillStyle = "#220000";
        ctx2d.fillRect(bx, by, hpBarWidth, bh);
        ctx2d.fillStyle = pct > 0.6 ? glowC : pct > 0.3 ? "#ffaa00" : "#ff2020";
        ctx2d.fillRect(bx, by, Math.round(hpBarWidth * pct), bh);
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
        const hsl = parseHSL(p.color ?? "hsl(180,80%,60%)");
        const prx = p.x;
        const pry = p.y;

        let pal = makePlayerPalette(hsl, p.team);
        if (isMe && performance.now() < playerDamageFlashUntil) {
            pal = PAL_FLASH_RED;
        }

        const teamGlow = p.team === "red" ? "#ff3355" : p.team === "blue" ? "#3399ff" : (p.color ?? "#ffffff");

        ctx2d.shadowBlur = isMe ? 22 : 14;
        ctx2d.shadowColor = teamGlow;
        const playerDef = SHIP_CLASSES[p.shipClass || "corvette"];
        if (playerDef) {
            drawPixelShip(playerDef, prx, pry, p.heading ?? p.angle, pal, isMe ? 3 : 2, playerDef.defaultLoadout, Math.floor(performance.now() / 50));
        }
        ctx2d.shadowBlur = 0;

        if (isMe) {
            const ps = 3;
            const trailColor = myTeam === "red" ? "#ff5500" : (myTeam === "blue" ? "#00aaff" : "#ffffff");
            const reversing = keys["s"] || keys["arrowdown"];
            drawShipEngines(prx, pry, p.heading ?? p.angle, p.shipClass || "corvette", trailColor, ps, reversing);

            if ((keys["shift"] || (serverPlayers[myId!]?.boostCooldown > 0)) && myBoostEnergy >= 28) {
                const mx_boost = -Math.cos(p.heading ?? p.angle);
                const my_boost = -Math.sin(p.heading ?? p.angle);
                for (let i = 0; i < 6; i++) {
                    const t = performance.now() * 0.01 + i * 1.3;
                    const ex = p.x + mx_boost * (18 + i * 4) + Math.sin(t) * 2.5;
                    const ey = p.y + my_boost * (18 + i * 4) + Math.cos(t + 0.7) * 2.5;
                    ctx2d.globalAlpha = 0.7;
                    ctx2d.fillStyle = "#00ccff";
                    ctx2d.fillRect(ex, ey, 3, 3);
                }
                ctx2d.globalAlpha = 1;
            }
        }

        if (isMe && myShield > 0) {
            ctx2d.strokeStyle = `rgba(68,170,255,${0.15 + myShield * 0.12})`;
            ctx2d.lineWidth = 2;
            ctx2d.beginPath();
            ctx2d.arc(prx, pry, 28, 0, Math.PI * 2);
            ctx2d.stroke();
        }

        if (isMe && !gameOver) {
            ctx2d.strokeStyle = "rgba(0,229,255,0.22)";
            ctx2d.lineWidth = 1;
            ctx2d.setLineDash([5, 7]);
            ctx2d.beginPath(); ctx2d.moveTo(p.x, p.y); ctx2d.lineTo(mx, my); ctx2d.stroke();
            ctx2d.setLineDash([]);
            const cs = 9;
            ctx2d.strokeStyle = "rgba(0,229,255,0.8)";
            ctx2d.lineWidth = 1;
            ctx2d.beginPath();
            ctx2d.moveTo(mx - cs, my); ctx2d.lineTo(mx + cs, my);
            ctx2d.moveTo(mx, my - cs); ctx2d.lineTo(mx, my + cs);
            ctx2d.stroke();
            ctx2d.beginPath(); ctx2d.arc(mx, my, 4, 0, Math.PI * 2); ctx2d.stroke();

            const now = performance.now();
            const cd = (COOLDOWN_TABLE as Record<string, number>)[myWeapon] || 200;
            const elapsed = now - lastShot;
            const remaining = Math.max(0, cd - elapsed);
            if (remaining > 0) {
                const barLen = 20;
                const ratio = remaining / cd;
                ctx2d.fillStyle = "rgba(255,255,255,0.7)";
                ctx2d.fillRect(mx - barLen / 2, my + 15, barLen, 3);
                ctx2d.fillStyle = "#ffaa00";
                ctx2d.fillRect(mx - barLen / 2, my + 15, barLen * (1 - ratio), 3);
            }
        }

        ctx2d.font = "6px 'Press Start 2P', monospace";
        ctx2d.textAlign = "center";
        ctx2d.fillStyle = isMe ? "rgba(0,229,255,0.85)"
            : p.team === "red" ? "rgba(255,100,100,0.7)"
                : p.team === "blue" ? "rgba(100,180,255,0.7)" : "rgba(200,220,255,0.5)";
        const tagY = p.y - (isMe ? 42 : 30);
        if (p.name) ctx2d.fillText(p.name.slice(0, 8), p.x, tagY - 8);
        ctx2d.fillText(`${p.score ?? 0}`, p.x, tagY);
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

canvas.addEventListener("mousemove", (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    screenMx = e.clientX - r.left;
    screenMy = e.clientY - r.top;
});
canvas.addEventListener("mousedown", (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const clickX = e.clientX - r.left;
    const clickY = e.clientY - r.top;
    const btnW = 88;
    const btnH = 20;
    const gap = 3;
    const totalW = ALL_CLASSES.length * (btnW + gap) - gap;
    const startX = (viewW - totalW) / 2;
    const selectorY = viewH - btnH - 6;

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
    if (keys["a"] || keys["arrowleft"]) strafe -= 1;
    if (keys["d"] || keys["arrowright"]) strafe += 1;
    if (keys["q"] || keys["a"]) turn -= 1;
    if (keys["e"] || keys["d"]) turn += 1;
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
    drawWaveFlash();
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

    drawClassSelector();
}

function drawClassSelector(): void {
    const dpr = window.devicePixelRatio || 1;
    const myClass = serverPlayers[myId!]?.shipClass || "corvette";
    const btnW = 88;
    const btnH = 20;
    const gap = 3;
    const totalW = ALL_CLASSES.length * (btnW + gap) - gap;
    const startX = (viewW - totalW) / 2;
    const y = viewH - btnH - 6;

    ctx2d.save();
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.globalAlpha = 0.85;

    for (let i = 0; i < ALL_CLASSES.length; i++) {
        const cls = ALL_CLASSES[i]!;
        const def = SHIP_CLASSES[cls];
        if (!def) continue;
        const x = startX + i * (btnW + gap);
        const isSelected = cls === myClass;

        ctx2d.fillStyle = isSelected ? def.glowColor : "#222";
        ctx2d.fillRect(x, y, btnW, btnH);
        ctx2d.strokeStyle = def.glowColor;
        ctx2d.lineWidth = isSelected ? 2 : 1;
        ctx2d.strokeRect(x, y, btnW, btnH);

        ctx2d.fillStyle = "#fff";
        ctx2d.font = "10px monospace";
        ctx2d.textAlign = "center";
        ctx2d.fillText(def.stats.label, x + btnW / 2, y + btnH / 2 + 3);
    }

    ctx2d.restore();
}

connect();
requestAnimationFrame(gameLoop);
