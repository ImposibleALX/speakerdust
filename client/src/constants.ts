import { WEAPON_STATS } from "@speakerdust/shared";
import type { WeaponKind } from "@speakerdust/shared";

export const IS_LOCAL = location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "" ||
    location.protocol === "file:";

export const WORKER_WS = IS_LOCAL
    ? "ws://localhost:8787"
    : "wss://speakerdust.soyimposibleyt.workers.dev";
export const ROOM_ID = "sala-1";

export const SHIELD_RADIUS = 28;
export const PLAYER_TAG_OFFSET = 30;
export const INPUT_RATE = 33;
export const MAX_PARTICLES = 420;
export const SPECTATOR_CAM_SPEED = 8;

export const COOLDOWN_TABLE: Record<WeaponKind, number> = {} as Record<WeaponKind, number>;
for (const [kind, stats] of Object.entries(WEAPON_STATS)) {
    COOLDOWN_TABLE[kind as WeaponKind] = stats.cooldown * 33;
}

export const QUICK_CHAT = [
    "¡Atacad!", "Defended la base", "Necesito apoyo", "Retirada",
    "¡Bien hecho!", "Cuidado con el flanco", "Esperad mi señal",
    "Voy a por el objetivo", "¡Gran trabajo!",
];

export const ENTITY_SMOOTH = 0.2;
export const LOCAL_SMOOTH = 0.50;
export const ANGLE_SMOOTH = 0.4;

export const FIXED_DT = 1 / 60;

export const NAVAL_WEAPON_COLORS: Record<string, string> = {
    naval_cannon: "#ffd36a", autocannon: "#a8ff78", plasma_broadside: "#d86bff",
    railgun: "#7df9ff", torpedo: "#ff9030", guided_missile: "#ff6a3d",
    energy_bomb: "#ffe66d", emp_launcher: "#66ccff",
};

export const NAVAL_WEAPON_ICONS: Record<string, string> = {
    naval_cannon: "NAVAL CANNON", autocannon: "AUTOCANNON", plasma_broadside: "PLASMA BROADSIDE",
    railgun: "RAILGUN", torpedo: "TORPEDO", guided_missile: "GUIDED MISSILE",
    energy_bomb: "ENERGY BOMB", emp_launcher: "EMP LAUNCHER",
};

export const PAL_SCOUT: Record<number, string> = Object.freeze({
    1: "#b50035", 2: "#ff1c51", 3: "#ffaa00", 4: "#e6004b",
    5: "#ff7093", 6: "#4a0016", 7: "#ff2a5f", 8: "#a0eeff",
});
export const PAL_CRUISER_ENEMY: Record<number, string> = Object.freeze({
    1: "#4a0080", 2: "#8a00cc", 3: "#ffaa00", 4: "#aa00ff",
    5: "#ba66ff", 6: "#1a002b", 7: "#d488ff", 8: "#a0eeff",
});
export const PAL_CAPITAL: Record<number, string> = Object.freeze({
    1: "#12204a", 2: "#2d4bb5", 3: "#ffaa00", 4: "#e62a4a",
    5: "#4272f5", 6: "#070c21", 7: "#5788fa", 8: "#a0eeff",
});
export const PAL_FLASH_RED: Record<number, string> = Object.freeze({
    1: "#ff0000", 2: "#ff5555", 3: "#ffaa00", 4: "#ff0000",
    5: "#aa0000", 6: "#550000", 7: "#ff0000", 8: "#ffffff",
});
