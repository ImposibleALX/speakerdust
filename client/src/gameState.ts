export let myId: string | null = null;
export let myTeam = "red";
export let myWeapon: string = "naval_cannon";
export let myShield = 3;
export let myHp = 5;
export let myMaxShield = 3;
export let myMaxHp = 5;
export let myBoostEnergy = 100;
export let myHeat = 0;
export let gameOver = false;
export let respawnState: "idle" | "requesting" = "idle";
export let respawnTimer: ReturnType<typeof setTimeout> | null = null;
export let score = 0;
export let currentWave = 1;

export let serverPlayers: Record<string, any> = {};
export let serverBullets: Record<string, any> = {};
export let serverEnemies: Record<string, any> = {};
export let serverZones: Record<string, any> = {};

export let WORLD_W = 1200;
export let WORLD_H = 800;

export let isAdmin = false;

export let lastShot = 0;
export let lastTickTime = 0;
export let currentServerTick = 0;
export let waveFlash = 0;

export function setMyId(v: string | null) { myId = v; }
export function setMyTeam(v: string) { myTeam = v; }
export function setMyWeapon(v: string) { myWeapon = v; }
export function setMyShield(v: number) { myShield = v; }
export function setMyHp(v: number) { myHp = v; }
export function setMyMaxShield(v: number) { myMaxShield = v; }
export function setMyMaxHp(v: number) { myMaxHp = v; }
export function setMyBoostEnergy(v: number) { myBoostEnergy = v; }
export function setMyHeat(v: number) { myHeat = v; }
export function setGameOver(v: boolean) { gameOver = v; }
export function setRespawnState(v: "idle" | "requesting") { respawnState = v; }
export function setRespawnTimer(v: ReturnType<typeof setTimeout> | null) { respawnTimer = v; }
export function setScore(v: number) { score = v; }
export function setCurrentWave(v: number) { currentWave = v; }
export function setServerPlayers(v: Record<string, any>) { serverPlayers = v; }
export function setServerBullets(v: Record<string, any>) { serverBullets = v; }
export function setServerEnemies(v: Record<string, any>) { serverEnemies = v; }
export function setServerZones(v: Record<string, any>) { serverZones = v; }
export function setWorld(v: { worldW: number; worldH: number }) { WORLD_W = v.worldW; WORLD_H = v.worldH; }
export function setIsAdmin(v: boolean) { isAdmin = v; }
export function setLastShot(v: number) { lastShot = v; }
export function setLastTickTime(v: number) { lastTickTime = v; }
export function setCurrentServerTick(v: number) { currentServerTick = v; }
export function setWaveFlash(v: number) { waveFlash = v; }
export function resetPlayerResources() {
    myShield = myMaxShield;
    myHp = myMaxHp;
    myBoostEnergy = 100;
    myHeat = 0;
}
