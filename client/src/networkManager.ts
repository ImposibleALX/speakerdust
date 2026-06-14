import { IS_LOCAL, WORKER_WS, ROOM_ID } from "./constants";
import {
    setMyId, setMyTeam, setMyWeapon, setMyShield, setMyMaxShield,
    setMyHp, setMyMaxHp, setMyBoostEnergy, setMyHeat,
    setGameOver, setRespawnState, setRespawnTimer,
    setScore, setCurrentWave, setServerPlayers, setServerBullets,
    setServerEnemies, setServerZones, setWorld, setIsAdmin,
    setLastShot, setWaveFlash, resetPlayerResources,
    setCurrentServerTick, setLastTickTime,
    myId, myTeam, myShield, myMaxShield, myHp, myMaxHp, myBoostEnergy,
    myHeat, myWeapon, score, gameOver, respawnState, respawnTimer,
    serverPlayers, serverBullets, serverEnemies, serverZones,
    currentWave, lastShot, WORLD_W, WORLD_H, isAdmin,
} from "./gameState";
import {
    overlay, restartBtn, adminControls, adminAuthStatus,
    adminGodmodeBtn, overlayScore, canvas,
    setDiff, drawWeaponHUD, drawShieldHUD, drawObjectiveHUD,
    updateTeamBadge, updateHUD, setStatus, showGameOver, hideGameOver,
    flashDamageOverlay, triggerPlayerDamageFlash, refreshAdminPlayerList,
} from "./uiManager";
import { enqueueAudio } from "./audioManager";
import { SHIP_CLASSES } from "@speakerdust/shared";
import { explode, clearParticles } from "./particleSystem";
import { addScreenShake } from "./camera";
import { generateToken } from "./network/codec";
import { onWorldResize } from "./game";

export let socket: WebSocket | null = null;
let lastHitSoundTime = 0;

export function send(type: string, payload: Record<string, any> = {}): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type, ...payload }));
}

function syncPlayerState(me: any): void {
    setScore(me.score);
    setMyShield(me.shield ?? myShield);
    setMyMaxShield(me.shieldMax ?? 3);
    setMyHp(me.hp ?? myHp);
    setMyMaxHp(me.maxHp ?? myMaxHp);
    setMyBoostEnergy(me.boostEnergy ?? myBoostEnergy);
    setMyHeat(me.weaponHeat ?? myHeat);
    if (me.weapon && me.weapon !== myWeapon) {
        setMyWeapon(me.weapon);
        drawWeaponHUD(myWeapon);
    }
    if (gameOver && me.alive) {
        setGameOver(false);
        hideGameOver();
        setLastShot(0);
        clearParticles();
    }
    if (me.isAdmin && !isAdmin) {
        setIsAdmin(true);
        adminControls?.classList.remove("hidden");
        setDiff(adminAuthStatus, "◆ ADMIN ACTIVE");
        if (adminAuthStatus) adminAuthStatus.className = "ok";
    }
    if (!me.alive && !gameOver) {
        setGameOver(true);
        showGameOver(score, respawnState);
    }
}



function updateHUDAll(): void {
    updateHUD(
        score, currentWave, Object.keys(serverPlayers).length,
        myWeapon, myShield, myMaxShield, myHp, myMaxHp,
        myBoostEnergy, myHeat, serverZones, myTeam
    );
}

const msgHandlers: Record<string, (msg: any) => void> = {
    init(msg) {
        setMyId(msg.playerId);
        setMyTeam(msg.team || "red");
        updateTeamBadge(myTeam);
        if (WORLD_W !== msg.worldW || WORLD_H !== msg.worldH) {
            setWorld({ worldW: msg.worldW, worldH: msg.worldH });
            onWorldResize();
        }
        setServerPlayers(msg.players);
        setServerBullets(Object.assign({}, msg.bullets, msg.enemyBullets || {}));
        setServerEnemies(msg.enemies);
        setServerZones(msg.zones ?? {});
        setCurrentWave(msg.wave);
        const me = serverPlayers[myId!];
        if (me) syncPlayerState(me);
        updateHUDAll();
    },
    tick(msg) {
        setLastTickTime(performance.now());
        setCurrentServerTick(msg.tick);
        setServerPlayers(msg.players);
        setServerBullets(Object.assign({}, msg.bullets, msg.enemyBullets || {}));
        setServerEnemies(msg.enemies);
        if (msg.zones) setServerZones(msg.zones);
        setCurrentWave(msg.wave);
        const me = serverPlayers[myId!];
        if (me) syncPlayerState(me);
        updateHUDAll();
        if (isAdmin) refreshAdminPlayerList(serverPlayers, send);
    },
    admin_authed(msg) {
        if (msg.ok) {
            setIsAdmin(true);
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
            resetPlayerResources();
            updateHUDAll();
        }
    },
    admin_godmode(msg) {
        if (adminGodmodeBtn) setDiff(adminGodmodeBtn, msg.active ? "GODMODE ON" : "GODMODE OFF");
        if (adminGodmodeBtn) {
            adminGodmodeBtn.className = msg.active ? "admin-btn-danger" : "admin-btn-warn";
        }
    },
    weapon_changed(msg) {
        setMyWeapon(msg.weapon);
        setLastShot(0);
        drawWeaponHUD(myWeapon);
    },
    shockwave(msg) {
        if (msg.ownerId !== myId) return;
        enqueueAudio({ type: "weapon", weapon: msg.weapon });
    },
    explosion(msg) {
        enqueueAudio({ type: "explosion" });
        const def = SHIP_CLASSES[msg.kind || ""];
        if (def) {
            const ex = def.visual.explosion;
            explode(msg.x, msg.y, [...ex.primaryColors], ex.primaryCount, ex.primarySize, ex.scale);
            const me = serverPlayers[myId!];
            if (me && me.alive && Math.hypot(msg.x - me.x, msg.y - me.y) < ex.screenShakeRadius) {
                addScreenShake(ex.shakeIntensity, ex.shakeDuration);
            }
        }
        const me = serverPlayers[myId!];
        if (me && me.alive && Math.hypot(msg.x - me.x, msg.y - me.y) < 200) {
            enqueueAudio({ type: "impact", strong: true });
            enqueueAudio({ type: "haptic", duration: 100, intensity: 0.8 });
        }
    },
    hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) { enqueueAudio({ type: "impact", strong: false }); lastHitSoundTime = now; }
        explode(msg.x, msg.y, ["#ffffff", "#ffdd88"], 6, 2);
        const me = serverPlayers[myId!];
        if (me && Math.hypot(msg.x - me.x, msg.y - me.y) < 100) {
            if (msg.playerId === myId) {
                enqueueAudio({ type: "haptic", duration: 30, intensity: 0.3 });
                flashDamageOverlay();
                triggerPlayerDamageFlash();
            }
        }
    },
    shield_hit(msg) {
        const now = performance.now();
        if (now - lastHitSoundTime > 60) { enqueueAudio({ type: "impact", strong: msg.reason === "impact" }); lastHitSoundTime = now; }
        if (msg.playerId === myId) {
            addScreenShake(0.55, 140);
            enqueueAudio({ type: "haptic", duration: 40, intensity: 0.5 });
            setMyShield(Math.max(0, myShield - 1));
            drawShieldHUD(myShield, myMaxShield);
            flashDamageOverlay();
            triggerPlayerDamageFlash();
            const p = serverPlayers[myId!];
            if (p) explode(p.x, p.y, ["#4488ff", "#aaccff"], 8, 2);
        }
    },
    player_dead(msg) {
        enqueueAudio({ type: "explosion" });
        enqueueAudio({ type: "haptic", duration: 150, intensity: 1.0 });
        explode(msg.x, msg.y, ["#00e5ff", "#ffffff", "#0088ff"], 30, 6);
        if (msg.playerId === myId) { setGameOver(true); showGameOver(score, respawnState); }
    },
    respawned() {
        setRespawnState("idle");
        if (respawnTimer) { clearTimeout(respawnTimer); setRespawnTimer(null); }
        if (restartBtn) { restartBtn.disabled = false; setDiff(restartBtn, "↻ RESPECTAR"); }
        // BUGFIX: Clear gameOver BEFORE resetting lastShot so fireShot() can run
        setGameOver(false);
        hideGameOver();
        // BUGFIX: Reset lastShot to 0 so the player can fire immediately after respawn
        setLastShot(0);
        clearParticles();
    },
    player_team(msg) {
        const players = { ...serverPlayers };
        if (players[msg.playerId]) players[msg.playerId].team = msg.team;
        setServerPlayers(players);
        if (msg.playerId === myId) { setMyTeam(msg.team); updateTeamBadge(myTeam); }
    },
    new_wave(msg) {
        enqueueAudio({ type: "tone", freq: 520, duration: 0.08, oscType: "triangle", gain: 0.04, sweepTo: 820 });
        setCurrentWave(msg.wave);
        setWaveFlash(50);
        resetPlayerResources();
        if (gameOver) {
            setGameOver(false);
            hideGameOver();
            setLastShot(0);
            clearParticles();
        }
        updateHUDAll();
    },
    objective(msg) {
        const zones = { ...serverZones };
        const zone = zones[msg.zoneId] || {};
        zone.id = msg.zoneId;
        zone.owner = msg.owner;
        zone.label = msg.label || msg.zoneId;
        zone.x = msg.x ?? zone.x;
        zone.y = msg.y ?? zone.y;
        zone.radius = msg.radius ?? zone.radius;
        if (msg.owner === "red") zone.redProgress = msg.progress;
        else if (msg.owner === "blue") zone.blueProgress = msg.progress;
        else if (msg.owner === "enemies") zone.enemyProgress = msg.progress;
        zones[msg.zoneId] = zone;
        setServerZones(zones);
        enqueueAudio({ type: "objective" });
        drawObjectiveHUD(serverZones, myTeam);
    },
};

export function handleMsg(msg: any): void {
    const handler = msgHandlers[msg.type];
    if (handler) handler(msg);
}

export function connect(): void {
    setStatus("connecting");
    const token = generateToken("player");
    const wsUrl = IS_LOCAL
        ? `${WORKER_WS}/room/${ROOM_ID}?token=${token}`
        : `${WORKER_WS}/room/${ROOM_ID}?token=${token}`;
    try {
        socket = new WebSocket(wsUrl);
    } catch (e) {
        setStatus("disconnected");
        setTimeout(connect, 3000);
        return;
    }
    socket.addEventListener("open", () => setStatus("connected"));
    socket.addEventListener("message", (e: MessageEvent) => handleMsg(JSON.parse(e.data)));
    socket.addEventListener("close", () => {
        setStatus("disconnected");
        setTimeout(connect, 2500);
    });
    socket.addEventListener("error", () => setStatus("disconnected"));
}
