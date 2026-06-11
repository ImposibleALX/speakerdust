import { NAVAL_WEAPON_COLORS, NAVAL_WEAPON_ICONS } from "./constants";

const $ = (id: string) => document.getElementById(id);

function getCanvas(id: string): HTMLCanvasElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found in DOM`);
    if (!(el instanceof HTMLCanvasElement)) throw new Error(`Element #${id} is not a <canvas>`);
    return el;
}
export const canvas = getCanvas("gameCanvas");

export const hudEl = $("hud")!;
export const statusBarEl = $("status-bar")!;
export const weaponDisp = $("weapon-display")!;
export const shieldDisp = $("shield-display")!;
export const scoreDisp = $("score")!;
export const waveNumDisp = $("wave-num")!;
export const playerCountDisp = $("player-count")!;
export const connStatusEl = $("connection-status")!;
export const overlay = $("screen-overlay")!;
export const overlayScore = $("overlay-score")!;
export const restartBtn = $("restart-btn") as HTMLButtonElement;
export const hpDisp = $("hp-display")!;
export const energyDisp = $("energy-display")!;
export const heatDisp = $("heat-display")!;
export const objectiveDisp = $("objective-display")!;
export const teamBadge = $("team-badge")!;
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

export function renderMeter(value: number, max: number, width: number, filledChar: string, emptyChar: string): string {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeMax = max > 0 ? max : 1;
    const clamped = Math.max(0, Math.min(safeMax, safeValue));
    const filled = Math.round((clamped / safeMax) * width);
    return filledChar.repeat(filled) + emptyChar.repeat(Math.max(0, width - filled));
}

export function drawWeaponHUD(weapon: string): void {
    if (!weaponDisp) return;
    const color = NAVAL_WEAPON_COLORS[weapon] || "#fff";
    setDiff(weaponDisp, NAVAL_WEAPON_ICONS[weapon] || weapon || "");
    weaponDisp.style.color = color;
    weaponDisp.style.textShadow = `0 0 10px ${color}`;
}

export function drawShieldHUD(shield: number, shieldMax: number): void {
    if (!shieldDisp) return;
    const sMax = shieldMax || 3;
    setDiff(shieldDisp, "◈".repeat(Math.max(0, shield)) + "◇".repeat(Math.max(0, sMax - shield)));
    shieldDisp.style.color = shield > 1 ? "#4af" : shield === 1 ? "#fa0" : "#f44";
}

export function drawHpHUD(hp: number, maxHp: number): void {
    if (!hpDisp) return;
    const currentMax = maxHp > 0 ? maxHp : 5;
    setDiff(hpDisp, "◈".repeat(Math.max(0, hp)) + "◇".repeat(Math.max(0, currentMax - hp)));
    hpDisp.style.color = hp > (currentMax * 0.4) ? "#a8ff78" : hp > (currentMax * 0.2) ? "#ffd36a" : "#ff6a7a";
}

export function drawEnergyHUD(energy: number): void {
    if (energyDisp) setDiff(energyDisp, renderMeter(energy, 100, 10, "█", "░"));
}

export function drawHeatHUD(heat: number): void {
    if (!heatDisp) return;
    setDiff(heatDisp, renderMeter(heat, 100, 10, "█", "░"));
    heatDisp.style.color = heat > 75 ? "#ff6a7a" : heat > 45 ? "#ffb35a" : "#ffd36a";
}

export function drawObjectiveHUD(zones: Record<string, any>, myTeam: string): void {
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

export function updateTeamBadge(team: string): void {
    if (!teamBadge) return;
    setDiff(teamBadge, team === "red" ? "◆ RED TEAM" : team === "blue" ? "◆ BLUE TEAM" : "◇ SPECTATOR");
    teamBadge.className = team === "red" ? "team-badge-red" : "team-badge-blue";
}

export function updateHUD(
    score: number, currentWave: number, playerCount: number,
    myWeapon: string, myShield: number, myMaxShield: number,
    myHp: number, myMaxHp: number, myBoostEnergy: number,
    myHeat: number, serverZones: Record<string, any>, myTeam: string
): void {
    if (scoreDisp) setDiff(scoreDisp, String(score || 0).padStart(6, "0"));
    if (waveNumDisp) setDiff(waveNumDisp, String(currentWave || 1));
    if (playerCountDisp) setDiff(playerCountDisp, String(playerCount));
    drawWeaponHUD(myWeapon);
    drawShieldHUD(myShield, myMaxShield);
    drawHpHUD(myHp, myMaxHp);
    drawEnergyHUD(myBoostEnergy);
    drawHeatHUD(myHeat);
    drawObjectiveHUD(serverZones, myTeam);
}

export function setStatus(s: string): void {
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

export function showGameOver(score: number, respawnState: string): void {
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

export function hideGameOver(): void {
    if (overlay) {
        overlay.classList.add("hidden");
        overlay.style.pointerEvents = "auto";
    }
    document.body.style.cursor = "none";
    canvas.style.cursor = "crosshair";
}

export const dmgOverlay = document.createElement("div");
dmgOverlay.id = "damage-overlay";
dmgOverlay.style.cssText = "pointer-events:none;position:fixed;top:0;left:0;width:100%;height:100%;background:radial-gradient(transparent 60%, rgba(255,0,0,0.5));opacity:0;transition:opacity 0.1s;z-index:100;";
document.body.appendChild(dmgOverlay);

let lastDamageFlash = 0;
let dmgFlashTimeout: ReturnType<typeof setTimeout> | null = null;

export function flashDamageOverlay(): void {
    const now = performance.now();
    if (now - lastDamageFlash < 200) return;
    lastDamageFlash = now;
    if (dmgFlashTimeout) clearTimeout(dmgFlashTimeout);
    dmgOverlay.style.opacity = "1";
    dmgFlashTimeout = setTimeout(() => { dmgOverlay.style.opacity = "0"; }, 80);
}

export let playerDamageFlashUntil = 0;

export function triggerPlayerDamageFlash(): void {
    playerDamageFlashUntil = performance.now() + 120;
}

export function refreshAdminPlayerList(
    serverPlayers: Record<string, any>,
    sendFn: (type: string, payload?: Record<string, any>) => void
): void {
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
        kickBtn.addEventListener("click", () => sendFn("admin_kick", { targetId: id }));
        row.appendChild(nameSpan);
        row.appendChild(kickBtn);
        adminPlayerList.appendChild(row);
    }
}

export function initTutorial(): void {
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
    };
    tut.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss, { once: true });
}
