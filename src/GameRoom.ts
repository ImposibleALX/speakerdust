import { DurableObject } from "cloudflare:workers";

// ─────────────────────────────────────────────────────────
//  Environment & Types
// ─────────────────────────────────────────────────────────
export interface Env { }

interface Vec2 { x: number; y: number; }

type Team = "red" | "blue" | "spectator";
type ZoneOwner = "neutral" | "red" | "blue" | "enemies";

interface Player {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  targetAngle: number;
  color: string;
  name: string;
  team: Team;
  score: number;
  alive: boolean;
  weapon: "laser" | "spread" | "missile";
  shootCooldown: number;
  weaponHeat: number;
  boostCooldown: number;
  boostEnergy: number;
  shield: number;
  shieldRegenDelay: number;
  hull: number;
  inputForward: number;
  inputStrafe: number;
  boostQueued: boolean;
  iFrames: number;
  isAdmin: boolean;
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  life: number;
  kind: "laser" | "spread" | "missile";
  targetId?: string;
  damage: number;
  splashRadius: number;
}

interface Enemy {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  maxHp: number;
  angle: number;
  targetAngle: number;
  wave: number;
  kind: "scout" | "cruiser" | "capital";
  shootCooldown: number;
  formationIndex: number;
}

interface EnemyBullet {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  damage: number;
  kind: "pulse" | "spread" | "shell" | "cannon";
}

interface ControlPoint {
  id: string;
  x: number;
  y: number;
  radius: number;
  owner: ZoneOwner;
  progress: number;
  label: string;
}

interface GameState {
  players: Record<string, Player>;
  bullets: Record<string, Bullet>;
  enemyBullets: Record<string, EnemyBullet>;
  enemies: Record<string, Enemy>;
  zones: Record<string, ControlPoint>;
  wave: number;
  tick: number;
}

// ─────────────────────────────────────────────────────────
//  Constants & Config
// ─────────────────────────────────────────────────────────
const WORLD_W = 1200;
const WORLD_H = 800;
const TICK_MS = 33; // ~30 fps

const ADMIN_KEY = "speakerdust-admin";

const PLAYER_MAX_SPEED = 7.2;
const PLAYER_THRUST = 0.90;
const PLAYER_STRAFE_THRUST = 0.80;
const PLAYER_DRAG = 0.94;
const PLAYER_TURN_RATE = 0.19;
const PLAYER_BOOST_IMPULSE = 4.8;
const PLAYER_BOOST_COST = 28;
const PLAYER_BOOST_REGEN = 0.7;
const PLAYER_BOOST_COOLDOWN = 80;
const PLAYER_HEAT_COOL = 0.95;
const PLAYER_HEAT_LIMIT = 100;
const PLAYER_SHIELD_MAX = 3;
const PLAYER_HULL_MAX = 3;
const PLAYER_SHIELD_REGEN_DELAY = 110;
const PLAYER_SHIELD_REGEN_INTERVAL = 165;
const PLAYER_COLLISION_RADIUS_SQ = 28 * 28;
const PLAYER_COLLISION_DAMAGE_SPEED = 12;

const BULLET_SPEED = 18.5;
const MISSILE_SPEED = 9.5;
const MISSILE_TURN_RATE = 0.10;
const SPREAD_SPEED = 15.2;
const ENEMY_BULLET_SPEED = 8.4;

const HITBOX_ENEMY_BULLET_SQ = 14 * 14;

const WEAPON_COOLDOWNS: Record<string, number> = {
  laser: 7,
  spread: 16,
  missile: 28,
};

const WEAPON_HEAT: Record<string, number> = {
  laser: 7,
  spread: 16,
  missile: 26,
};

const ENEMY_STATS: Record<string, { hp: number; speed: number; shootRate: number; score: number; idealRange: number }> = {
  scout:   { hp: 4,  speed: 2.3,  shootRate: 44, score: 120, idealRange: 260 },
  cruiser: { hp: 7,  speed: 1.45, shootRate: 68, score: 280, idealRange: 360 },
  capital: { hp: 16, speed: 0.92, shootRate: 88, score: 700, idealRange: 470 },
};

function uuid(): string { return crypto.randomUUID(); }
function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function distSq(a: Vec2, b: Vec2) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function shortestAngleDelta(from: number, to: number) {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function spawnPos(): Vec2 {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: rand(0, WORLD_W), y: -100 };
  if (side === 1) return { x: WORLD_W + 100, y: rand(0, WORLD_H) };
  if (side === 2) return { x: rand(0, WORLD_W), y: WORLD_H + 100 };
  return { x: -100, y: rand(0, WORLD_H) };
}

// ─────────────────────────────────────────────────────────
//  Durable Object: GameRoom
// ─────────────────────────────────────────────────────────
export class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    players: {}, bullets: {}, enemyBullets: {}, enemies: {}, zones: {}, wave: 1, tick: 0,
  };
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private hydrated = false;
  private saveQueued = false;
  private readonly SNAPSHOT_KEY = "speakerdust:state:v2";
  private readonly SAVE_EVERY_TICKS = 30;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initZones();
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<GameState>(this.SNAPSHOT_KEY);
      if (stored) {
        this.state = this.hydrateState(stored);
      } else {
        this.spawnWave(1);
      }
      this.hydrated = true;
      void this.persistState();
    });
    this.startLoop();
  }

  private spawnPlayer(playerId: string) {
    const player = this.state.players[playerId];
    if (!player) return;
    const hue = Math.floor(Math.random() * 360);
    player.x = rand(200, WORLD_W - 200);
    player.y = rand(200, WORLD_H - 200);
    player.vx = 0; player.vy = 0;
    player.angle = -Math.PI / 2;
    player.targetAngle = player.angle;
    player.color = `hsl(${hue}, 80%, 65%)`;
    player.score = 0;
    player.alive = true;
    player.weapon = "laser";
    player.shootCooldown = 0;
    player.weaponHeat = 0;
    player.boostCooldown = 0;
    player.boostEnergy = 100;
    player.shield = PLAYER_SHIELD_MAX;
    player.shieldRegenDelay = 0;
    player.hull = PLAYER_HULL_MAX;
    player.inputForward = 0;
    player.inputStrafe = 0;
    player.boostQueued = false;
    player.iFrames = 60;
  }

  private initZones() {
    this.state.zones = {
      core: { id: "core", x: WORLD_W * 0.5, y: WORLD_H * 0.5, radius: 150, owner: "neutral", progress: 0, label: "CORE" },
      flankA: { id: "flankA", x: WORLD_W * 0.26, y: WORLD_H * 0.28, radius: 132, owner: "neutral", progress: 0, label: "FLANK A" },
      flankB: { id: "flankB", x: WORLD_W * 0.74, y: WORLD_H * 0.72, radius: 132, owner: "neutral", progress: 0, label: "FLANK B" },
    };
  }

  private hydrateState(stored: GameState): GameState {
    const freshZones = this.state.zones;
    return {
      players: stored.players ?? {},
      bullets: stored.bullets ?? {},
      enemyBullets: stored.enemyBullets ?? {},
      enemies: stored.enemies ?? {},
      zones: stored.zones && Object.keys(stored.zones).length > 0 ? stored.zones : freshZones,
      wave: stored.wave ?? 1,
      tick: stored.tick ?? 0,
    };
  }

  private markDirty() { void this.persistState(); }

  private async persistState() {
    if (!this.hydrated || this.saveQueued) return;
    this.saveQueued = true;
    try {
      await this.ctx.storage.put(this.SNAPSHOT_KEY, this.state);
    } catch { } finally {
      this.saveQueued = false;
    }
  }

  // ── WebSocket upgrade ──────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Upgrade, Connection",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Speakerdust Game Server – connect via WebSocket", { status: 200, headers: { "Content-Type": "text/plain", ...corsHeaders } });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const playerId = uuid();
    const hue = Math.floor(Math.random() * 360);
    server.serializeAttachment({ playerId });

    // Auto-assign team based on current balance
    const players = Object.values(this.state.players);
    const redCount = players.filter(p => p.team === "red").length;
    const blueCount = players.filter(p => p.team === "blue").length;
    const team: Team = redCount <= blueCount ? "red" : "blue";

    this.state.players[playerId] = {
      id: playerId, x: rand(200, WORLD_W - 200), y: rand(200, WORLD_H - 200),
      vx: 0, vy: 0, angle: -Math.PI / 2, targetAngle: -Math.PI / 2,
      color: `hsl(${hue}, 80%, 65%)`, name: `PILOT-${playerId.slice(0, 4).toUpperCase()}`,
      team, score: 0, alive: true, weapon: "laser",
      shootCooldown: 0, weaponHeat: 0, boostCooldown: 0, boostEnergy: 100,
      shield: PLAYER_SHIELD_MAX, shieldRegenDelay: 0, hull: PLAYER_HULL_MAX,
      inputForward: 0, inputStrafe: 0, boostQueued: false, iFrames: 60, isAdmin: false,
    };

    server.send(JSON.stringify({ type: "init", playerId, team, worldW: WORLD_W, worldH: WORLD_H, state: this.state }));
    this.broadcast({ type: "player_join", player: this.state.players[playerId] });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Client messages ────────────────────────────────────
  webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string) {
    const { playerId } = ws.deserializeAttachment() as { playerId: string };
    const player = this.state.players[playerId];
    let msg: any;
    try { msg = JSON.parse(raw as string); } catch { return; }
    if (!player) return;

    switch (msg.type) {
      case "admin_auth": {
        if (msg.key === ADMIN_KEY) {
          player.isAdmin = true;
          try { ws.send(JSON.stringify({ type: "admin_authed", ok: true })); } catch { }
        } else {
          try { ws.send(JSON.stringify({ type: "admin_authed", ok: false })); } catch { }
        }
        break;
      }
      case "admin_reset_all": {
        if (!player.isAdmin) break;
        for (const p of Object.values(this.state.players)) {
          p.score = 0;
          p.shield = PLAYER_SHIELD_MAX;
          p.hull = PLAYER_HULL_MAX;
          p.boostEnergy = 100;
          p.weaponHeat = 0;
          p.alive = true;
          p.iFrames = 60;
        }
        this.broadcast({ type: "admin_event", action: "reset_all" });
        this.markDirty();
        break;
      }
      case "admin_kick": {
        if (!player.isAdmin) break;
        const targetId = msg.targetId as string;
        const targetWs = this.ctx.getWebSockets().find(sock => {
          try { const att = sock.deserializeAttachment() as any; return att?.playerId === targetId; } catch { return false; }
        });
        if (targetWs) { try { targetWs.close(1000, "Kicked by admin"); } catch { } }
        delete this.state.players[targetId];
        this.broadcast({ type: "player_leave", playerId: targetId });
        this.markDirty();
        break;
      }
      case "admin_set_wave": {
        if (!player.isAdmin) break;
        const newWave = Math.max(1, Math.floor(Number(msg.wave) || 1));
        this.state.wave = newWave;
        this.state.enemies = {};
        this.spawnWave(newWave);
        this.broadcast({ type: "new_wave", wave: newWave });
        this.markDirty();
        break;
      }
      case "admin_clear_enemies": {
        if (!player.isAdmin) break;
        this.state.enemies = {};
        this.broadcast({ type: "admin_event", action: "clear_enemies" });
        this.markDirty();
        break;
      }
      case "set_team": {
        const t = msg.team as Team;
        if (t === "red" || t === "blue" || t === "spectator") {
          player.team = t;
          this.broadcast({ type: "player_team", playerId, team: t });
        }
        break;
      }
      case "respawn": {
        this.spawnPlayer(playerId);
        this.markDirty();
        break;
      }
      case "boost": {
        if (!player.alive) return;
        if (player.boostCooldown <= 0 && player.boostEnergy >= PLAYER_BOOST_COST) {
          player.boostQueued = true;
          this.markDirty();
        }
        break;
      }
      case "move": {
        if (!player.alive) return;
        const hasLocalAxes = typeof msg.forward === "number" || typeof msg.strafe === "number";
        const hasWorldAxes = typeof msg.vx === "number" || typeof msg.vy === "number";
        if (hasLocalAxes) {
          player.inputForward = clamp(Number(msg.forward ?? 0), -1, 1);
          player.inputStrafe = clamp(Number(msg.strafe ?? 0), -1, 1);
        } else if (hasWorldAxes) {
          const rawX = clamp(Number(msg.vx ?? 0), -1, 1);
          const rawY = clamp(Number(msg.vy ?? 0), -1, 1);
          const cos = Math.cos(player.angle);
          const sin = Math.sin(player.angle);
          player.inputForward = clamp(rawX * cos + rawY * sin, -1, 1);
          player.inputStrafe = clamp(-rawX * sin + rawY * cos, -1, 1);
        } else {
          player.inputForward = 0;
          player.inputStrafe = 0;
        }
        if (typeof msg.angle === "number") player.targetAngle = msg.angle;
        break;
      }
      case "switch_weapon": {
        if (!player.alive) return;
        const weps: Player["weapon"][] = ["laser", "spread", "missile"];
        const cur = weps.indexOf(player.weapon);
        player.weapon = weps[(cur + 1) % weps.length];
        try { ws.send(JSON.stringify({ type: "weapon_changed", weapon: player.weapon })); } catch { }
        this.markDirty();
        break;
      }
      case "shoot": {
        if (!player.alive) return;
        if (player.shootCooldown > 0 || player.weaponHeat >= PLAYER_HEAT_LIMIT) break;
        const a = player.angle;
        const ox = player.x + Math.cos(a) * 20;
        const oy = player.y + Math.sin(a) * 20;

        if (player.weapon === "laser") {
          this.addBullet(playerId, ox, oy, Math.cos(a) * BULLET_SPEED, Math.sin(a) * BULLET_SPEED, a, "laser", 1, 65);
        } else if (player.weapon === "spread") {
          for (const da of [-0.22, -0.11, 0, 0.11, 0.22]) {
            const sa = a + da;
            this.addBullet(playerId, ox, oy, Math.cos(sa) * SPREAD_SPEED, Math.sin(sa) * SPREAD_SPEED, sa, "spread", 1, 48);
          }
        } else if (player.weapon === "missile") {
          let targetId: string | undefined;
          let bestScore = -Infinity;
          for (const [eid, e] of Object.entries(this.state.enemies)) {
            const dSq = distSq(player, e);
            if (dSq < 700 * 700) {
              const sc = e.hp * 2 - Math.sqrt(dSq) * 0.04;
              if (sc > bestScore) { bestScore = sc; targetId = eid; }
            }
          }
          this.addBullet(playerId, ox, oy, Math.cos(a) * MISSILE_SPEED, Math.sin(a) * MISSILE_SPEED, a, "missile", 3, 120, targetId, 48);
        }

        player.shootCooldown = WEAPON_COOLDOWNS[player.weapon];
        player.weaponHeat = Math.min(PLAYER_HEAT_LIMIT + 30, player.weaponHeat + WEAPON_HEAT[player.weapon]);
        this.markDirty();
        break;
      }
    }
  }

  private addBullet(ownerId: string, x: number, y: number, vx: number, vy: number, angle: number, kind: Bullet["kind"], damage: number, life: number, targetId?: string, splashRadius = 0) {
    const id = uuid();
    this.state.bullets[id] = { id, ownerId, x, y, vx, vy, angle, life, kind, damage, targetId, splashRadius };
  }

  private addEnemyBullet(x: number, y: number, vx: number, vy: number, life: number, damage: number, kind: EnemyBullet["kind"]) {
    const id = uuid();
    this.state.enemyBullets[id] = { id, x, y, vx, vy, life, damage, kind };
  }

  private applyPlayerDamage(player: Player, damage: number, fromImpact = false) {
    if (!player.alive) return;
    if (player.iFrames > 0 && !fromImpact) return;
    if (player.shield > 0) {
      player.shield = Math.max(0, player.shield - 1);
      player.shieldRegenDelay = PLAYER_SHIELD_REGEN_DELAY;
      player.iFrames = fromImpact ? 10 : 18;
      this.broadcast({ type: "shield_hit", playerId: player.id, reason: fromImpact ? "impact" : "weapon" });
      return;
    }
    player.hull = Math.max(0, player.hull - damage);
    player.iFrames = fromImpact ? 8 : 12;
    player.shieldRegenDelay = Math.max(player.shieldRegenDelay, PLAYER_SHIELD_REGEN_DELAY);
    if (player.hull <= 0) {
      player.alive = false;
      this.broadcast({ type: "player_dead", playerId: player.id, x: player.x, y: player.y });
      this.markDirty();
    }
  }

  private updatePlayerPhysics(player: Player, zoneBonus: number) {
    player.angle += shortestAngleDelta(player.angle, player.targetAngle) * PLAYER_TURN_RATE;
    const cos = Math.cos(player.angle);
    const sin = Math.sin(player.angle);
    const rightX = -sin;
    const rightY = cos;

    player.vx += cos * player.inputForward * PLAYER_THRUST;
    player.vy += sin * player.inputForward * PLAYER_THRUST;
    player.vx += rightX * player.inputStrafe * PLAYER_STRAFE_THRUST;
    player.vy += rightY * player.inputStrafe * PLAYER_STRAFE_THRUST;

    if (player.boostQueued) {
      if (player.boostCooldown <= 0 && player.boostEnergy >= PLAYER_BOOST_COST) {
        player.vx += cos * PLAYER_BOOST_IMPULSE;
        player.vy += sin * PLAYER_BOOST_IMPULSE;
        player.boostEnergy -= PLAYER_BOOST_COST;
        player.boostCooldown = PLAYER_BOOST_COOLDOWN;
      }
      player.boostQueued = false;
    }

    player.vx *= PLAYER_DRAG;
    player.vy *= PLAYER_DRAG;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > PLAYER_MAX_SPEED) { const scale = PLAYER_MAX_SPEED / speed; player.vx *= scale; player.vy *= scale; }

    player.x += player.vx;
    player.y += player.vy;
    if (player.x < 18) { player.x = 18; player.vx *= -0.35; }
    if (player.x > WORLD_W - 18) { player.x = WORLD_W - 18; player.vx *= -0.35; }
    if (player.y < 18) { player.y = 18; player.vy *= -0.35; }
    if (player.y > WORLD_H - 18) { player.y = WORLD_H - 18; player.vy *= -0.35; }

    player.weaponHeat = Math.max(0, player.weaponHeat - PLAYER_HEAT_COOL - zoneBonus * 0.15);
    player.boostEnergy = Math.min(100, player.boostEnergy + PLAYER_BOOST_REGEN + zoneBonus * 0.2);
    if (player.shootCooldown > 0) player.shootCooldown--;
    if (player.boostCooldown > 0) player.boostCooldown--;
    if (player.iFrames > 0) player.iFrames--;

    if (player.shield < PLAYER_SHIELD_MAX) {
      if (player.shieldRegenDelay > 0) { player.shieldRegenDelay -= zoneBonus > 0 ? 2 : 1; }
      else { player.shield++; player.shieldRegenDelay = PLAYER_SHIELD_REGEN_INTERVAL; }
    } else { player.shieldRegenDelay = 0; }
  }

  // ── Cooperative AI ──────────────────────────────────────
  private computeFormation(enemies: Enemy[]) {
    // Assign stable formation indices once per wave based on kind
    const scouts = enemies.filter(e => e.kind === "scout");
    const cruisers = enemies.filter(e => e.kind === "cruiser");
    const capitals = enemies.filter(e => e.kind === "capital");
    scouts.forEach((e, i) => { e.formationIndex = i; });
    cruisers.forEach((e, i) => { e.formationIndex = i; });
    capitals.forEach((e, i) => { e.formationIndex = i; });
  }

  private updateEnemyAI(enemy: Enemy, alivePlayers: Player[], allEnemies: Enemy[]) {
    const stats = ENEMY_STATS[enemy.kind];
    if (enemy.shootCooldown > 0) enemy.shootCooldown--;

    // Find closest player
    let target: Player | null = null;
    let minDSq = Infinity;
    for (const p of alivePlayers) {
      const dSq = distSq(enemy, p);
      if (dSq < minDSq) { minDSq = dSq; target = p; }
    }

    const nearestZone = this.findNearestZone(enemy.x, enemy.y);

    if (target && minDSq <= 760 * 760) {
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Lead shot prediction
      const leadX = target.x + target.vx * 16;
      const leadY = target.y + target.vy * 16;
      const leadAngle = Math.atan2(leadY - enemy.y, leadX - enemy.x);
      enemy.targetAngle = leadAngle;

      const dirX = dx / dist;
      const dirY = dy / dist;

      // Cooperative: each enemy uses a different orbit offset based on formationIndex
      const totalOfKind = allEnemies.filter(e => e.kind === enemy.kind).length;
      const orbitOffset = (enemy.formationIndex / Math.max(totalOfKind, 1)) * Math.PI * 2;
      const orbitX = Math.cos(leadAngle + Math.PI / 2 + orbitOffset);
      const orbitY = Math.sin(leadAngle + Math.PI / 2 + orbitOffset);

      const accel = stats.speed * 0.27;
      const seek = dist > stats.idealRange + 60;
      const retreat = dist < stats.idealRange - 60;

      if (enemy.kind === "scout") {
        if (seek) { enemy.vx += dirX * accel; enemy.vy += dirY * accel; }
        else if (retreat) { enemy.vx -= dirX * accel * 0.55; enemy.vy -= dirY * accel * 0.55; }
        // Orbit with spread — cooperate, don't cluster
        enemy.vx += orbitX * accel * 1.05;
        enemy.vy += orbitY * accel * 1.05;
      } else if (enemy.kind === "cruiser") {
        if (seek) { enemy.vx += dirX * accel; enemy.vy += dirY * accel; }
        else if (retreat) { enemy.vx -= dirX * accel * 0.8; enemy.vy -= dirY * accel * 0.8; }
        else { enemy.vx += orbitX * accel * 1.1; enemy.vy += orbitY * accel * 1.1; }
      } else {
        // Capitals hang back and support
        if (seek) { enemy.vx += dirX * accel * 0.5; enemy.vy += dirY * accel * 0.5; }
        else if (retreat) { enemy.vx -= dirX * accel * 0.5; enemy.vy -= dirY * accel * 0.5; }
        enemy.vx += orbitX * accel * 0.9;
        enemy.vy += orbitY * accel * 0.9;
      }

      if (enemy.shootCooldown <= 0 && dist < stats.idealRange + 140) {
        this.fireEnemyWeapon(enemy, target);
        enemy.shootCooldown = stats.shootRate;
      }
    } else if (nearestZone) {
      const dx = nearestZone.x - enemy.x;
      const dy = nearestZone.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      enemy.targetAngle = Math.atan2(dy, dx);
      const accel = stats.speed * 0.24;
      if (dist > nearestZone.radius * 0.55) { enemy.vx += (dx / dist) * accel; enemy.vy += (dy / dist) * accel; }
      else {
        const orbitX = -dy / dist;
        const orbitY = dx / dist;
        enemy.vx += orbitX * accel;
        enemy.vy += orbitY * accel;
      }
    } else {
      const dx = WORLD_W * 0.5 - enemy.x;
      const dy = WORLD_H * 0.5 - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      enemy.targetAngle = Math.atan2(dy, dx);
      enemy.vx += (dx / dist) * stats.speed * 0.18;
      enemy.vy += (dy / dist) * stats.speed * 0.18;
    }

    enemy.angle += shortestAngleDelta(enemy.angle, enemy.targetAngle) * 0.12;
    enemy.vx *= 0.988;
    enemy.vy *= 0.988;
    const maxSpeed = stats.speed * 1.9;
    const spd = Math.hypot(enemy.vx, enemy.vy);
    if (spd > maxSpeed) { const scale = maxSpeed / spd; enemy.vx *= scale; enemy.vy *= scale; }
    enemy.x += enemy.vx;
    enemy.y += enemy.vy;
    if (enemy.x < 16 || enemy.x > WORLD_W - 16) enemy.vx *= -0.45;
    if (enemy.y < 16 || enemy.y > WORLD_H - 16) enemy.vy *= -0.45;
    enemy.x = clamp(enemy.x, 16, WORLD_W - 16);
    enemy.y = clamp(enemy.y, 16, WORLD_H - 16);
  }

  private findNearestZone(x: number, y: number) {
    let chosen: ControlPoint | null = null;
    let minSq = Infinity;
    for (const zone of Object.values(this.state.zones)) {
      const dSq = (zone.x - x) ** 2 + (zone.y - y) ** 2;
      if (dSq < minSq) { minSq = dSq; chosen = zone; }
    }
    return chosen;
  }

  private fireEnemyWeapon(enemy: Enemy, target: Player) {
    const leadX = target.x + target.vx * 18;
    const leadY = target.y + target.vy * 18;
    const attackAngle = Math.atan2(leadY - enemy.y, leadX - enemy.x);

    if (enemy.kind === "scout") {
      // Fast single pulse
      this.addEnemyBullet(enemy.x, enemy.y, Math.cos(attackAngle) * ENEMY_BULLET_SPEED * 1.2, Math.sin(attackAngle) * ENEMY_BULLET_SPEED * 1.2, 85, 1, "pulse");
    } else if (enemy.kind === "cruiser") {
      // Wide spread
      for (const off of [-0.20, -0.10, 0, 0.10, 0.20]) {
        const sa = attackAngle + off;
        this.addEnemyBullet(enemy.x, enemy.y, Math.cos(sa) * ENEMY_BULLET_SPEED, Math.sin(sa) * ENEMY_BULLET_SPEED, 100, 1, "spread");
      }
    } else {
      // Capital: dual shells + heavy cannon
      for (const off of [-0.06, 0.06]) {
        const sa = attackAngle + off;
        this.addEnemyBullet(enemy.x, enemy.y, Math.cos(sa) * (ENEMY_BULLET_SPEED * 0.8), Math.sin(sa) * (ENEMY_BULLET_SPEED * 0.8), 120, 2, "shell");
      }
      // Slow, heavy cannon shot every 3rd fire
      if (Math.random() < 0.33) {
        this.addEnemyBullet(enemy.x, enemy.y, Math.cos(attackAngle) * (ENEMY_BULLET_SPEED * 0.5), Math.sin(attackAngle) * (ENEMY_BULLET_SPEED * 0.5), 150, 3, "cannon");
      }
    }
  }

  private applyBulletSplash(ownerId: string, x: number, y: number, damage: number, splashRadius: number, excludedEnemyId?: string) {
    if (splashRadius <= 0) return;
    for (const [eid, enemy] of Object.entries(this.state.enemies)) {
      if (eid === excludedEnemyId) continue;
      const dSq = distSq({ x, y }, enemy);
      if (dSq > splashRadius * splashRadius) continue;
      const falloff = 1 - Math.sqrt(dSq) / splashRadius;
      enemy.hp -= Math.max(1, Math.round(damage * falloff));
      if (enemy.hp <= 0) {
        const score = ENEMY_STATS[enemy.kind].score;
        delete this.state.enemies[eid];
        const owner = this.state.players[ownerId];
        if (owner) owner.score += score;
        this.broadcast({ type: "explosion", x: enemy.x, y: enemy.y, kind: enemy.kind });
        this.markDirty();
      } else {
        this.broadcast({ type: "hit", x: enemy.x, y: enemy.y });
      }
    }
  }

  private resolveShipCollision(player: Player, enemy: Enemy) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    let distance = Math.hypot(dx, dy);
    let nx = 0, ny = 0;
    if (distance < 0.001) { nx = Math.cos(player.angle); ny = Math.sin(player.angle); distance = 1; }
    else { nx = dx / distance; ny = dy / distance; }
    const overlap = 28 - distance;
    if (overlap <= 0) return;
    const relativeSpeed = Math.hypot(player.vx - enemy.vx, player.vy - enemy.vy);
    const push = Math.max(0.4, overlap * 0.18);
    player.x = clamp(player.x + nx * push * 0.65, 18, WORLD_W - 18);
    player.y = clamp(player.y + ny * push * 0.65, 18, WORLD_H - 18);
    enemy.x = clamp(enemy.x - nx * push * 0.45, 18, WORLD_W - 18);
    enemy.y = clamp(enemy.y - ny * push * 0.45, 18, WORLD_H - 18);
    player.vx += nx * push * 0.15; player.vy += ny * push * 0.15;
    enemy.vx -= nx * push * 0.08; enemy.vy -= ny * push * 0.08;
    if (relativeSpeed > PLAYER_COLLISION_DAMAGE_SPEED) this.applyPlayerDamage(player, 1, true);
  }

  private updateControlPoints(alivePlayers: Player[], aliveEnemies: Enemy[]) {
    for (const zone of Object.values(this.state.zones)) {
      let redPressure = 0, bluePressure = 0, enemyPressure = 0;
      for (const player of alivePlayers) {
        const d = Math.hypot(player.x - zone.x, player.y - zone.y);
        if (d < zone.radius) {
          const pressure = 1 - d / zone.radius;
          if (player.team === "red") redPressure += pressure;
          else if (player.team === "blue") bluePressure += pressure;
        }
      }
      for (const enemy of aliveEnemies) {
        const d = Math.hypot(enemy.x - zone.x, enemy.y - zone.y);
        if (d < zone.radius) enemyPressure += 1 - d / zone.radius;
      }

      const playerPressure = redPressure + bluePressure;
      const delta = (playerPressure - enemyPressure) * 0.9;
      if (delta !== 0) {
        zone.progress = clamp(zone.progress + delta, -100, 100);
      } else if (zone.progress !== 0) {
        zone.progress += zone.progress > 0 ? -0.35 : 0.35;
        if (Math.abs(zone.progress) < 0.5) zone.progress = 0;
      }

      const previousOwner = zone.owner;
      if (zone.progress > 55) zone.owner = "red";
      else if (zone.progress < -55) zone.owner = "enemies";
      else zone.owner = "neutral";

      if (previousOwner !== zone.owner) {
        this.broadcast({ type: "objective", zoneId: zone.id, owner: zone.owner, progress: zone.progress, label: zone.label });
      }
    }
  }

  webSocketClose(ws: WebSocket) {
    const attach = ws.deserializeAttachment() as { playerId?: string };
    if (attach?.playerId) {
      delete this.state.players[attach.playerId];
      this.broadcast({ type: "player_leave", playerId: attach.playerId });
      this.markDirty();
    }
    if (Object.keys(this.state.players).length === 0) {
      this.stopLoop();
      void this.persistState();
    }
  }

  // ── Game loop ──────────────────────────────────────────
  private startLoop() {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => this.gameTick(), TICK_MS);
  }

  private stopLoop() {
    if (!this.loopTimer) return;
    clearInterval(this.loopTimer);
    this.loopTimer = null;
  }

  private gameTick() {
    if (!this.hydrated) return;
    const st = this.state;
    st.tick++;

    const alivePlayers = Object.values(st.players).filter(p => p.alive);
    const allEnemies = Object.values(st.enemies);

    this.updateControlPoints(alivePlayers, allEnemies);

    for (const player of alivePlayers) {
      const zone = Object.values(st.zones).find(z => distSq(player, z) <= z.radius * z.radius) ?? null;
      const zoneBonus = zone?.owner === "red" || zone?.owner === "blue" ? 1 : 0;
      this.updatePlayerPhysics(player, zoneBonus);
      if (zone && (zone.owner === "red" || zone.owner === "blue") && st.tick % 18 === 0) {
        player.score += 1;
      }
    }

    // Cooperative: update formation indices once per wave cycle
    if (st.tick % 90 === 0) this.computeFormation(allEnemies);

    for (const enemy of allEnemies) {
      this.updateEnemyAI(enemy, alivePlayers, allEnemies);
    }

    // ── Bullet physics with guided missiles ───────────────
    for (const [bid, bullet] of Object.entries(st.bullets)) {
      if (bullet.kind === "missile" && bullet.targetId && st.enemies[bullet.targetId]) {
        const tgt = st.enemies[bullet.targetId];
        const desiredAngle = Math.atan2(tgt.y - bullet.y, tgt.x - bullet.x);
        bullet.angle += shortestAngleDelta(bullet.angle, desiredAngle) * MISSILE_TURN_RATE;
        bullet.vx = Math.cos(bullet.angle) * MISSILE_SPEED;
        bullet.vy = Math.sin(bullet.angle) * MISSILE_SPEED;
      }

      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life--;

      if (bullet.life <= 0 || bullet.x < -100 || bullet.x > WORLD_W + 100 || bullet.y < -100 || bullet.y > WORLD_H + 100) {
        delete st.bullets[bid]; continue;
      }

      const hitRangeSq = bullet.kind === "missile" ? 24 * 24 : 16 * 16;
      for (const [eid, enemy] of Object.entries(st.enemies)) {
        if (distSq(bullet, enemy) >= hitRangeSq) continue;
        const owner = st.players[bullet.ownerId];
        enemy.hp -= bullet.damage;
        if (bullet.splashRadius > 0) this.applyBulletSplash(bullet.ownerId, bullet.x, bullet.y, bullet.damage, bullet.splashRadius, eid);
        delete st.bullets[bid];
        if (enemy.hp <= 0) {
          delete st.enemies[eid];
          if (owner) owner.score += ENEMY_STATS[enemy.kind].score;
          this.broadcast({ type: "explosion", x: enemy.x, y: enemy.y, kind: enemy.kind });
          this.markDirty();
        } else {
          this.broadcast({ type: "hit", x: enemy.x, y: enemy.y });
        }
        break;
      }
    }

    for (const [bid, bullet] of Object.entries(st.enemyBullets)) {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life--;
      if (bullet.life <= 0 || bullet.x < -80 || bullet.x > WORLD_W + 80 || bullet.y < -80 || bullet.y > WORLD_H + 80) {
        delete st.enemyBullets[bid]; continue;
      }
      for (const player of alivePlayers) {
        if (!player.alive) continue;
        if (distSq(bullet, player) >= HITBOX_ENEMY_BULLET_SQ) continue;
        delete st.enemyBullets[bid];
        this.applyPlayerDamage(player, bullet.damage, false);
        break;
      }
    }

    for (const enemy of Object.values(st.enemies)) {
      for (const player of alivePlayers) {
        if (!player.alive) continue;
        if (distSq(enemy, player) < PLAYER_COLLISION_RADIUS_SQ) this.resolveShipCollision(player, enemy);
      }
    }

    // ── Wave completion — infinite, smooth curve ───────────
    if (Object.keys(st.enemies).length === 0 && alivePlayers.length > 0) {
      st.wave++;
      for (const player of alivePlayers) {
        player.shield = PLAYER_SHIELD_MAX;
        player.shieldRegenDelay = 0;
        player.hull = PLAYER_HULL_MAX;
        player.boostEnergy = 100;
        player.weaponHeat = Math.max(0, player.weaponHeat - 20);
        player.iFrames = 60;
      }
      this.spawnWave(st.wave);
      this.broadcast({ type: "new_wave", wave: st.wave });
      this.markDirty();
    }

    if (st.tick % this.SAVE_EVERY_TICKS === 0) this.markDirty();

    // ── Serialize tick payload ─────────────────────────────
    const optP: any = {};
    for (const [id, p] of Object.entries(st.players)) {
      optP[id] = {
        id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        angle: Math.round(p.angle * 100) / 100, color: p.color, name: p.name,
        team: p.team, score: p.score, alive: p.alive, weapon: p.weapon,
        shield: p.shield, hull: p.hull, boostEnergy: Math.round(p.boostEnergy),
        weaponHeat: Math.round(p.weaponHeat), isAdmin: p.isAdmin,
      };
    }
    const optE: any = {};
    for (const [id, e] of Object.entries(st.enemies)) {
      optE[id] = { id: e.id, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10, angle: Math.round(e.angle * 100) / 100, hp: Math.round(e.hp), maxHp: e.maxHp, kind: e.kind };
    }
    const optB: any = {};
    for (const [id, b] of Object.entries(st.bullets)) {
      optB[id] = { id: b.id, ownerId: b.ownerId, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: Math.round(b.vx * 10) / 10, vy: Math.round(b.vy * 10) / 10, angle: Math.round(b.angle * 100) / 100, kind: b.kind };
    }
    const optEB: any = {};
    for (const [id, b] of Object.entries(st.enemyBullets)) {
      optEB[id] = { id: b.id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: Math.round(b.vx * 10) / 10, vy: Math.round(b.vy * 10) / 10, kind: b.kind };
    }
    const optZ: any = {};
    for (const [id, z] of Object.entries(st.zones)) {
      optZ[id] = { id: z.id, owner: z.owner, progress: Math.round(z.progress) };
    }

    this.broadcast({ type: "tick", tick: st.tick, players: optP, bullets: optB, enemyBullets: optEB, enemies: optE, zones: optZ, wave: st.wave });
  }

  private spawnWave(wave: number) {
    // Smooth, infinite scaling — no hard caps
    const scouts = 3 + wave;
    const cruisers = Math.max(0, Math.floor(wave / 3));
    const capitals = Math.max(0, Math.floor(wave / 8));
    // Soft cap at very high waves to prevent spawning thousands
    const maxScouts = Math.min(scouts, 20);
    const maxCruisers = Math.min(cruisers, 10);
    const maxCapitals = Math.min(capitals, 4);

    const spawn = (kind: Enemy["kind"]) => {
      const id = uuid();
      const pos = spawnPos();
      const hpBonus = Math.floor((wave - 1) / 5);
      const hp = ENEMY_STATS[kind].hp + hpBonus;
      this.state.enemies[id] = {
        id, ...pos, vx: 0, vy: 0, hp, maxHp: hp,
        angle: 0, targetAngle: 0, wave, kind,
        shootCooldown: Math.floor(Math.random() * 50),
        formationIndex: 0,
      };
    };

    for (let i = 0; i < maxScouts; i++) spawn("scout");
    for (let i = 0; i < maxCruisers; i++) spawn("cruiser");
    for (let i = 0; i < maxCapitals; i++) spawn("capital");

    // Assign formation indices right after spawn
    this.computeFormation(Object.values(this.state.enemies));
  }

  private broadcast(msg: object) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch { }
    }
  }
}
