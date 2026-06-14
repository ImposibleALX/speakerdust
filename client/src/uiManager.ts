import { NAVAL_WEAPON_ICONS } from "./constants";
import { SHIP_CLASSES, WEAPON_STATS } from "@speakerdust/shared";

const $ = (id: string) => document.getElementById(id);

function getCanvas(id: string): HTMLCanvasElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found in DOM`);
    if (!(el instanceof HTMLCanvasElement)) throw new Error(`Element #${id} is not a <canvas>`);
    return el;
}
export const canvas = getCanvas("gameCanvas");

// UI Elements
export const hudEl = $("hud")!;
export const statusBarEl = $("status-bar")!;
export const weaponDisp = $("weapon-display")!;
export const shieldDisp = $("shield-display")!;
export const hpDisp = $("hp-display")!;
export const armorDisp = $("armor-display")!;
export const energyDisp = $("energy-display")!;
export const heatDisp = $("heat-display")!;
export const scoreDisp = $("score")!;
export const waveNumDisp = $("wave-num")!;
export const playerCountDisp = $("player-count")!;
export const connStatusEl = $("connection-status")!;
export const objectiveDisp = $("objective-display")!;
export const teamBadge = $("team-badge")!;

// Overlays & Modals
export const overlay = $("screen-overlay")!;
export const overlayScore = $("overlay-score")!;
export const restartBtn = $("restart-btn") as HTMLButtonElement;

// Admin Panel
export const adminPanel = $("admin-panel")!;
export const adminClose = $("admin-close")!;
export const adminAuthForm = $("admin-auth-form") as HTMLFormElement;
export const adminKeyInput = $("admin-key-input") as HTMLInputElement;
export const adminAuthStatus = $("admin-auth-status")!;
export const adminControls = $("admin-controls")!;
export const adminResetAllBtn = $("admin-reset-all-btn")!;
export const adminClearEnemiesBtn = $("admin-clear-enemies-btn")!;
export const adminWaveInput = $("admin-wave-input") as HTMLInputElement;
export const adminSetWaveBtn = $("admin-set-wave-btn")!;
export const adminJoinRed = $("admin-join-red")!;
export const adminJoinBlue = $("admin-join-blue")!;
export const adminGodmodeBtn = $("admin-godmode-btn")!;
export const adminHealBtn = $("admin-heal-btn")!;
export const adminResetDataBtn = $("admin-reset-data-btn")!;
export const adminPlayerList = $("admin-player-list")!;

export function setDiff(el: HTMLElement | null, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
}

export function setStyle(el: HTMLElement | null, prop: string, value: string): void {
    if (el && (el.style as any)[prop] !== value) {
        (el.style as any)[prop] = value;
    }
}

export function renderMeter(value: number, max: number, width: number, filledChar: string, emptyChar: string): string {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeMax = max > 0 ? max : 1;
    const clamped = Math.max(0, Math.min(safeMax, safeValue));
    const filled = Math.round((clamped / safeMax) * width);
    return `${filledChar.repeat(filled)}${emptyChar.repeat(Math.max(0, width - filled))}`;
}

export function drawWeaponHUD(weapon: string): void {
    if (!weaponDisp) return;
    const stats = weapon ? WEAPON_STATS[weapon as keyof typeof WEAPON_STATS] : undefined;
    const color = stats?.telegraphColor ?? "var(--col-accent)";

    // Convertir el nombre crudo a un formato limpio si no hay icono visual
    const formattedName = weapon ? weapon.replace(/_/g, " ").toUpperCase() : "OFFLINE";
    const icon = NAVAL_WEAPON_ICONS[weapon] || formattedName;

    // Ya no concatenamos "WPN //". La etiqueta la pone el HTML
    setDiff(weaponDisp, icon);
    setStyle(weaponDisp, "color", color);
    setStyle(weaponDisp, "textShadow", `0 0 10px ${color}`);
}

export function drawShieldHUD(shield: number, shieldMax: number): void {
    if (!shieldDisp) return;
    const sMax = shieldMax || 3;
    setDiff(shieldDisp, `${"▰".repeat(Math.max(0, shield))}${"▱".repeat(Math.max(0, sMax - shield))}`);

    // Teoría del Color: Azul/Cian (Seguro) -> Ámbar (Alerta) -> Rojo (Peligro) usando Vars CSS
    const baseColor = shield > 1 ? "var(--col-accent)" : shield === 1 ? "var(--col-warning)" : "var(--col-danger)";
    setStyle(shieldDisp, "color", baseColor);
    setStyle(shieldDisp, "textShadow", `0 0 10px ${baseColor}`);
}

export function drawHpHUD(hp: number, maxHp: number): void {
    if (!hpDisp) return;
    const currentMax = maxHp > 0 ? maxHp : 5;
    setDiff(hpDisp, `${"▰".repeat(Math.max(0, hp))}${"▱".repeat(Math.max(0, currentMax - hp))}`);

    // Teoría del Color: Esmeralda (Óptimo) -> Ámbar (Daños) -> Rojo (Crítico)
    const baseColor = hp > (currentMax * 0.4) ? "var(--col-success)" : hp > (currentMax * 0.2) ? "var(--col-warning)" : "var(--col-danger)";
    setStyle(hpDisp, "color", baseColor);
    setStyle(hpDisp, "textShadow", `0 0 10px ${baseColor}`);
}

export function drawEnergyHUD(energy: number): void {
    if (!energyDisp) return;
    setDiff(energyDisp, renderMeter(energy, 100, 10, "▰", "▱"));
    setStyle(energyDisp, "color", "var(--col-warning)");
    setStyle(energyDisp, "textShadow", "0 0 10px var(--col-warning)");
}

export function drawHeatHUD(heat: number): void {
    if (!heatDisp) return;
    setDiff(heatDisp, renderMeter(heat, 100, 10, "▰", "▱"));

    // El calor funciona al revés: Cian (Frío) -> Naranja -> Rojo (Sobrecalentado)
    const baseColor = heat > 75 ? "var(--col-danger)" : heat > 45 ? "var(--col-warning)" : "var(--col-accent)";
    setStyle(heatDisp, "color", baseColor);
    setStyle(heatDisp, "textShadow", `0 0 10px ${baseColor}`);
}

export function drawObjectiveHUD(zones: Record<string, any>, myTeam: string): void {
    if (!objectiveDisp) return;
    const list = Object.values(zones || {});
    if (!list.length) {
        setDiff(objectiveDisp, "NO NODES FOUND");
        return;
    }
    const playersOwned = list.filter((z: any) => z.owner === "red" || z.owner === "blue").length;
    const maxProg = (z: any) => Math.max(z.redProgress || 0, z.blueProgress || 0, z.enemyProgress || 0);
    const focus = list.reduce((best: any, z: any) => maxProg(z) > maxProg(best) ? z : best, list[0]);
    const pct = String(Math.round(maxProg(focus))).padStart(3, "0");

    let ownerText = "UNLINKED";
    let color = "var(--col-dim)";

    if (focus.owner === myTeam) {
        ownerText = "SECURED";
        color = "var(--col-success)";
    } else if (focus.owner === "red" || focus.owner === "blue") {
        ownerText = "HOSTILE";
        color = "var(--col-danger)";
    } else if (focus.owner === "enemies") {
        ownerText = "INFECTED";
        color = "var(--col-warning)";
    }

    setDiff(objectiveDisp, `${String(playersOwned).padStart(2, "0")}/${String(list.length).padStart(2, "0")} | TGT: ${focus.label || "NULL"} [${pct}%] ${ownerText}`);
    setStyle(objectiveDisp, "color", color);
    setStyle(objectiveDisp, "borderLeftColor", color);
}

export function updateTeamBadge(team: string): void {
    if (!teamBadge) return;
    setDiff(teamBadge, team === "red" ? "RED" : team === "blue" ? "BLUE" : "SPECTATOR");
    teamBadge.className = team === "red" ? "team-badge-red" : "team-badge-blue";
}

export function updateHUD(
    score: number, currentWave: number, playerCount: number,
    myWeapon: string, myShield: number, myMaxShield: number,
    myHp: number, myMaxHp: number, myBoostEnergy: number,
    myHeat: number, serverZones: Record<string, any>, myTeam: string
): void {
    // Ya no concatenamos "DATA //". Los números van limpios.
    if (scoreDisp) setDiff(scoreDisp, String(score || 0).padStart(6, "0"));
    if (waveNumDisp) setDiff(waveNumDisp, String(currentWave || 1));
    if (playerCountDisp) setDiff(playerCountDisp, String(playerCount).padStart(2, "0"));

    drawWeaponHUD(myWeapon);
    drawShieldHUD(myShield, myMaxShield);
    drawHpHUD(myHp, myMaxHp);
    drawEnergyHUD(myBoostEnergy);
    drawHeatHUD(myHeat);
    drawObjectiveHUD(serverZones, myTeam);
    updateTeamBadge(myTeam);
}

export function setStatus(s: string): void {
    if (!connStatusEl) return;
    const map: Record<string, [string, string]> = {
        connecting: ["status-connecting", "HANDSHAKE_INIT..."],
        connected: ["status-connected", "UPLINK_ESTABLISHED"],
        disconnected: ["status-disconnected", "CRITICAL: SIGNAL_LOST"],
    };
    const entry: [string, string] = (map[s] ?? map["disconnected"])!;
    const [cls, text] = entry;

    if (connStatusEl.className !== cls) {
        connStatusEl.className = cls;
        connStatusEl.style.color = s === "connected" ? "var(--col-success)" : s === "connecting" ? "var(--col-warning)" : "var(--col-danger)";
    }
    setDiff(connStatusEl, text);
}

export function showGameOver(score: number, respawnState: string): void {
    if (overlay) {
        overlay.classList.remove("hidden");
        overlay.style.pointerEvents = "auto";
    }
    document.body.style.cursor = "default";
    canvas.style.cursor = "default";

    if (restartBtn) {
        restartBtn.disabled = respawnState === "requesting";
        setDiff(restartBtn, respawnState === "requesting" ? "[ REBOOTING... ]" : "[ REDEPLOY SHIP ]");
    }

    if (overlayScore) {
        setDiff(overlayScore, `FINAL SCORE: ${String(score || 0).padStart(6, "0")}`);
    }
}

export function hideGameOver(): void {
    if (overlay) {
        overlay.classList.add("hidden");
        // BUGFIX: Clear inline pointer-events style so the CSS .hidden rule takes effect.
        // Without this, the overlay remains clickable even when visually invisible.
        overlay.style.pointerEvents = "";
    }
    // Restore game cursor to hidden (crosshair is for game canvas, body is none)
    document.body.style.cursor = "none";
    canvas.style.cursor = "none";
}

// ---- DAMAGE OVERLAY ----
export const dmgOverlay = document.createElement("div");
dmgOverlay.id = "damage-overlay";
// IMPORTANTE: z-index 5 lo sitúa POR ENCIMA del juego pero POR DEBAJO de la UI (z-index 10)
// pointer-events: none garantiza que nunca bloquee los clics al Admin Panel o a los botones del canvas.
dmgOverlay.style.cssText = "pointer-events:none; position:fixed; inset:0; background:radial-gradient(circle, transparent 40%, rgba(255, 59, 59, 0.15) 100%); box-shadow: inset 0 0 100px rgba(255, 59, 59, 0.3); opacity:0; transition:opacity 0.1s ease-out; z-index:5; mix-blend-mode: screen;";
document.body.appendChild(dmgOverlay);

let lastDamageFlash = 0;
let dmgFlashTimeout: ReturnType<typeof setTimeout> | null = null;

export function flashDamageOverlay(): void {
    const now = performance.now();
    if (now - lastDamageFlash < 200) return;
    lastDamageFlash = now;
    if (dmgFlashTimeout) clearTimeout(dmgFlashTimeout);

    dmgOverlay.style.opacity = "1";
    document.body.style.transform = `translate(${Math.random() * 6 - 3}px, ${Math.random() * 6 - 3}px)`;

    dmgFlashTimeout = setTimeout(() => {
        dmgOverlay.style.opacity = "0";
        document.body.style.transform = "none";
    }, 100);
}

export let playerDamageFlashUntil = 0;
export function triggerPlayerDamageFlash(): void { playerDamageFlashUntil = performance.now() + 120; }

export function refreshAdminPlayerList(
    serverPlayers: Record<string, any>, sendFn: (type: string, payload?: Record<string, any>) => void
): void {
    if (!adminPlayerList) return;
    adminPlayerList.innerHTML = "";

    for (const [id, p] of Object.entries(serverPlayers)) {
        const row = document.createElement("div");
        row.className = "admin-player-row";

        const nameSpan = document.createElement("span");
        // Color por facción usando clases CSS dinámicas
        nameSpan.className = `admin-player-name text-${p.team === 'red' ? 'danger' : p.team === 'blue' ? 'accent' : 'dim'}`;
        nameSpan.textContent = `[${(p.team || "???").toUpperCase()}] 0x${id.slice(0, 4).toUpperCase()} :: ${p.name || "ANON"}`;

        const kickBtn = document.createElement("button");
        kickBtn.className = "admin-kick-btn";
        kickBtn.textContent = "KICK";
        kickBtn.addEventListener("click", () => sendFn("admin_kick", { targetId: id }));

        row.appendChild(nameSpan);
        row.appendChild(kickBtn);
        adminPlayerList.appendChild(row);
    }
}

export function drawWaveFlash(ctx: CanvasRenderingContext2D, alpha: number, worldW: number, worldH: number): void {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#00e5ff"; // Usa el color acento en HEX directamente para el Canvas
    ctx.fillRect(0, 0, worldW, worldH);
    ctx.globalAlpha = 1;
}

export function drawShieldRing(ctx: CanvasRenderingContext2D, x: number, y: number, shield: number): void {
    if (shield <= 0) return;
    ctx.strokeStyle = `rgba(0, 229, 255, ${0.15 + shield * 0.15})`; // Efecto más notorio según carga
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 32, 0, Math.PI * 2);
    ctx.stroke();
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, px: number, py: number, mx: number, my: number): void {
    ctx.strokeStyle = "rgba(0, 229, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(mx, my); ctx.stroke();
    ctx.setLineDash([]);

    const cs = 8;
    ctx.strokeStyle = "rgba(0, 229, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx - cs, my); ctx.lineTo(mx + cs, my);
    ctx.moveTo(mx, my - cs); ctx.lineTo(mx, my + cs);
    ctx.stroke();

    ctx.fillStyle = "rgba(0, 229, 255, 0.6)";
    ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.fill();
}

export function drawCooldownBar(ctx: CanvasRenderingContext2D, mx: number, my: number, ratio: number): void {
    const barLen = 24;
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(mx - barLen / 2, my + 15, barLen, 2);
    ctx.fillStyle = "#00e5ff";
    ctx.fillRect(mx - barLen / 2, my + 15, barLen * (1 - ratio), 2);
}

export function drawPlayerLabel(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    name: string, score: number, isMe: boolean, team: string,
): void {
    ctx.font = "10px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = isMe ? "#00e5ff" : team === "red" ? "#ff4d4d" : team === "blue" ? "#4da6ff" : "#64748b";
    if (name) ctx.fillText(name.slice(0, 8), x, y - 10);
    ctx.font = "8px 'Share Tech Mono', monospace";
    ctx.fillText(`${score}`, x, y);
}

export function drawEnemyHPBar(
    ctx: CanvasRenderingContext2D, x: number, y: number,
    hpRatio: number, barWidth: number, glowColor: string,
): void {
    const bh = 2;
    const bx = x - barWidth / 2;
    ctx.fillStyle = "rgba(10, 14, 22, 0.8)";
    ctx.fillRect(bx, y, barWidth, bh);

    ctx.fillStyle = hpRatio > 0.6 ? glowColor : hpRatio > 0.3 ? "#ffb300" : "#ff3b3b";
    ctx.fillRect(bx, y, Math.round(barWidth * hpRatio), bh);
}

export function drawClassSelector(
    ctx: CanvasRenderingContext2D, allClasses: readonly string[],
    myClass: string, viewW: number, viewH: number,
): void {
    const dpr = window.devicePixelRatio || 1;
    const btnW = 95;
    const btnH = 26;
    const gap = 8;
    const totalW = allClasses.length * (btnW + gap) - gap;
    const startX = (viewW - totalW) / 2;

    // IMPORTANTE: Elevado a 50px para evitar chocar con la barra de controles HTML inferior
    // Si la selección de nave deja de responder al clic, asegúrate de actualizar esta misma resta ("viewH - btnH - 50")
    // en tu archivo de captura de eventos del mouse (input.ts o main.ts).
    const y = viewH - btnH - 50;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (let i = 0; i < allClasses.length; i++) {
        const cls = allClasses[i]!;
        const def = SHIP_CLASSES[cls];
        if (!def) continue;
        const x = startX + i * (btnW + gap);
        const isSelected = cls === myClass;

        // Estilo Glassmorphism Sci-Fi dibujado directo en el Canvas
        ctx.fillStyle = isSelected ? `${def.visual.glowColor}40` : "rgba(10, 14, 22, 0.85)";
        ctx.fillRect(x, y, btnW, btnH);

        ctx.strokeStyle = isSelected ? def.visual.glowColor : "rgba(0, 229, 255, 0.2)";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(x, y, btnW, btnH);

        ctx.fillStyle = isSelected ? "#ffffff" : "#64748b";
        ctx.font = "11px 'Rajdhani', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(def.stats.label.toUpperCase(), x + btnW / 2, y + btnH / 2 + 4);
    }

    ctx.restore();
}

export function initTutorial(): void {
    if (localStorage.getItem("speakerdust_tutorial_seen")) return;
    const tut = document.createElement("div");
    tut.id = "tutorial-overlay";

    tut.innerHTML = `
        <style>
            @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 15px rgba(0, 229, 255, 0.15); } 50% { box-shadow: 0 0 25px rgba(0, 229, 255, 0.3); } }
            @keyframes fadeIn { from { opacity: 0; transform: scale(0.98) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            .kbd-key {
                background: rgba(0, 229, 255, 0.1); border: 1px solid var(--col-border);
                border-bottom: 2px solid rgba(0, 229, 255, 0.4); border-radius: 4px;
                padding: 4px 10px; color: var(--col-accent); font-family: var(--font-data);
                font-size: 0.9em; margin: 0 4px; display: inline-block;
            }
            .tut-row { margin: 16px 0; color: var(--col-text); display: flex; align-items: center; justify-content: space-between; }
            .tut-label { font-weight: 600; letter-spacing: 2px; color: var(--col-dim); font-family: var(--font-ui); font-size: 0.9rem;}
        </style>
        
        <div style="background: var(--col-hud-bg); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--col-border); border-left: 4px solid var(--col-accent); border-radius: 4px; padding: 40px; max-width: 480px; width: 100%; text-align: left; animation: fadeIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), pulseGlow 3s infinite; box-shadow: 0 20px 50px rgba(0,0,0,0.8);">
            
            <h3 style="color: var(--col-accent); font-family: var(--font-ui); text-align: left; font-weight: bold; font-size: 1.5rem; border-bottom: 1px solid var(--col-border); padding-bottom: 15px; margin-top: 0; letter-spacing: 3px;">
                SYS.OVERRIDE_INIT //
            </h3>
            
            <div style="margin-top: 30px; font-family: var(--font-data); font-size: 14px;">
                <div class="tut-row">
                    <span><span class="kbd-key">W A S D</span></span>
                    <span class="tut-label">HELM / NAV VECTOR</span>
                </div>
                <div class="tut-row">
                    <span><span class="kbd-key">MOUSE</span></span>
                    <span class="tut-label">TARGET & FIRE</span>
                </div>
                <div class="tut-row">
                    <span><span class="kbd-key">Q</span> o <span class="kbd-key">TAB</span></span>
                    <span class="tut-label">CYCLE WEAPONRY</span>
                </div>
                <div class="tut-row">
                    <span><span class="kbd-key">SHIFT</span> o <span class="kbd-key">R_CLICK</span></span>
                    <span class="tut-label">ENGAGE THRUSTERS</span>
                </div>
                <div class="tut-row">
                    <span><span class="kbd-key">1</span> - <span class="kbd-key">9</span></span>
                    <span class="tut-label">TACTICAL COMMS</span>
                </div>
            </div>
            
            <div style="text-align: right; margin-top: 40px;">
                <span style="color: #000; font-family: var(--font-ui); font-size: 0.9rem; font-weight: bold; padding: 10px 24px; background: var(--col-accent); border-radius: 2px; letter-spacing: 2px; cursor: pointer; transition: all 0.2s;">
                    [ CLICK TO EXECUTE ]
                </span>
            </div>
        </div>`;

    tut.style.cssText = "position:fixed; inset:0; display:flex; align-items:center; justify-content:center; z-index:200; background:rgba(5, 8, 15, 0.8); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); cursor: pointer;";
    document.body.appendChild(tut);

    const dismiss = () => {
        tut.style.opacity = "0";
        tut.style.transition = "opacity 0.3s ease";
        setTimeout(() => tut.remove(), 300);
        localStorage.setItem("speakerdust_tutorial_seen", "1");
    };

    tut.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss, { once: true });
}