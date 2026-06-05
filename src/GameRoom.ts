import { DurableObject } from "cloudflare:workers";

// ─────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────
interface Vec2 { x: number; y: number; }

interface Player {
  id: string;
  x: number; y: number;
  angle: number;
  color: string;
  score: number;
  alive: boolean;
  weapon: "laser" | "spread" | "missile";
  shootCooldown: number;  // ticks until can shoot again
  shield: number;         // 0-3 shield energy
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  kind: "laser" | "spread" | "missile";
  targetId?: string;      // for missile homing
  damage: number;
}

interface Enemy {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  maxHp: number;
  angle: number;
  wave: number;
  kind: "scout" | "cruiser" | "capital"; // 3 distinct enemy types
  shootCooldown: number;
}

interface EnemyBullet {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
}

interface GameState {
  players:      Record<string, Player>;
  bullets:      Record<string, Bullet>;
  enemyBullets: Record<string, EnemyBullet>;
  enemies:      Record<string, Enemy>;
  wave:         number;
  tick:         number;
}

// ─────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────
const WORLD_W = 1200;
const WORLD_H = 800;
const TICK_MS = 33;         // ~30 fps

const PLAYER_SPEED   = 4.2;
const BULLET_SPEED   = 15;
const MISSILE_SPEED  = 7;
const SPREAD_SPEED   = 13;
const ENEMY_BULLET_SPEED = 8;

const HITBOX_PLAYER  = 16;
const HITBOX_ENEMY_BULLET = 12;

const WEAPON_COOLDOWNS: Record<string, number> = {
  laser:   5,    // ticks (very fast)
  spread:  18,   // ticks (medium)
  missile: 28,   // ticks (slow but powerful)
};

const ENEMY_STATS: Record<string, { hp: number; speed: number; shootRate: number; score: number }> = {
  scout:   { hp: 2, speed: 2.2, shootRate: 90,  score: 100 },
  cruiser: { hp: 5, speed: 1.4, shootRate: 55,  score: 250 },
  capital: { hp: 12,speed: 0.7, shootRate: 35,  score: 600 },
};

function uuid(): string { return crypto.randomUUID(); }
function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function dist(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }

function spawnPos(): Vec2 {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: rand(0, WORLD_W), y: -90 };
  if (side === 1) return { x: WORLD_W + 90,     y: rand(0, WORLD_H) };
  if (side === 2) return { x: rand(0, WORLD_W), y: WORLD_H + 90 };
  return              { x: -90,                 y: rand(0, WORLD_H) };
}

// ─────────────────────────────────────────────────────────
//  Durable Object: GameRoom
// ─────────────────────────────────────────────────────────
export class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    players: {}, bullets: {}, enemyBullets: {}, enemies: {}, wave: 1, tick: 0,
  };
  private loopTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.startLoop();
    this.spawnWave(1);
  }

  // ── WebSocket upgrade ──────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    // CORS for browser access
    const origin = request.headers.get("Origin") ?? "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Upgrade, Connection",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Speakerdust Game Server – connect via WebSocket to /room/<id>", {
        status: 200, headers: { "Content-Type": "text/plain", ...corsHeaders },
      });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const playerId = uuid();
    const hue = Math.floor(Math.random() * 360);
    server.serializeAttachment({ playerId });

    this.state.players[playerId] = {
      id: playerId,
      x: rand(200, WORLD_W - 200),
      y: rand(200, WORLD_H - 200),
      angle: -Math.PI / 2,
      color: `hsl(${hue}, 80%, 65%)`,
      score: 0, alive: true,
      weapon: "laser",
      shootCooldown: 0,
      shield: 3,
    };

    server.send(JSON.stringify({
      type: "init", playerId,
      worldW: WORLD_W, worldH: WORLD_H,
      state: this.state,
    }));

    this.broadcast({ type: "player_join", player: this.state.players[playerId] });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Client messages ────────────────────────────────────
  webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string) {
    const { playerId } = ws.deserializeAttachment() as { playerId: string };
    const player = this.state.players[playerId];
    if (!player || !player.alive) return;

    let msg: any;
    try { msg = JSON.parse(raw as string); } catch { return; }

    switch (msg.type) {
      case "move": {
        const vx = Math.max(-1, Math.min(1, msg.vx ?? 0));
        const vy = Math.max(-1, Math.min(1, msg.vy ?? 0));
        player.x = Math.max(12, Math.min(WORLD_W - 12, player.x + vx * PLAYER_SPEED));
        player.y = Math.max(12, Math.min(WORLD_H - 12, player.y + vy * PLAYER_SPEED));
        player.angle = typeof msg.angle === "number" ? msg.angle : player.angle;
        break;
      }
      case "switch_weapon": {
        const weps: Player["weapon"][] = ["laser", "spread", "missile"];
        const cur = weps.indexOf(player.weapon);
        player.weapon = weps[(cur + 1) % weps.length];
        // Tell only this player their new weapon
        try { ws.send(JSON.stringify({ type: "weapon_changed", weapon: player.weapon })); } catch {}
        break;
      }
      case "shoot": {
        if (player.shootCooldown > 0) break;
        const a = player.angle;
        const ox = player.x + Math.cos(a) * 20;
        const oy = player.y + Math.sin(a) * 20;

        if (player.weapon === "laser") {
          this.addBullet(playerId, ox, oy, Math.cos(a) * BULLET_SPEED, Math.sin(a) * BULLET_SPEED, "laser", 1, 55);
        } else if (player.weapon === "spread") {
          for (const da of [-0.22, 0, 0.22]) {
            const sa = a + da;
            this.addBullet(playerId, ox, oy, Math.cos(sa) * SPREAD_SPEED, Math.sin(sa) * SPREAD_SPEED, "spread", 1, 48);
          }
        } else if (player.weapon === "missile") {
          // Find nearest enemy as target
          let targetId: string | undefined;
          let minD = 400; // max lock range
          for (const [eid, e] of Object.entries(this.state.enemies)) {
            const d = dist(player, e);
            if (d < minD) { minD = d; targetId = eid; }
          }
          // Fire 2 missiles slightly offset
          for (const off of [-8, 8]) {
            const px = player.x + Math.cos(a + Math.PI / 2) * off;
            const py = player.y + Math.sin(a + Math.PI / 2) * off;
            this.addBullet(playerId, px, py, Math.cos(a) * MISSILE_SPEED, Math.sin(a) * MISSILE_SPEED, "missile", 3, 90, targetId);
          }
        }

        player.shootCooldown = WEAPON_COOLDOWNS[player.weapon];
        break;
      }
    }
  }

  private addBullet(ownerId: string, x: number, y: number, vx: number, vy: number,
    kind: Bullet["kind"], damage: number, life: number, targetId?: string) {
    const id = uuid();
    this.state.bullets[id] = { id, ownerId, x, y, vx, vy, life, kind, damage, targetId };
  }

  webSocketClose(ws: WebSocket) {
    const { playerId } = ws.deserializeAttachment() as { playerId: string };
    delete this.state.players[playerId];
    this.broadcast({ type: "player_leave", playerId });
  }

  // ── Game loop ──────────────────────────────────────────
  private startLoop() {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => this.gameTick(), TICK_MS);
  }

  private gameTick() {
    const st = this.state;
    st.tick++;

    const playerList = Object.values(st.players).filter(p => p.alive);

    // Cooldown ticks
    for (const p of playerList) {
      if (p.shootCooldown > 0) p.shootCooldown--;
    }

    // ── Enemy AI ───────────────────────────────────────
    for (const e of Object.values(st.enemies)) {
      // Find nearest player
      let target: Player | null = null;
      let minD = Infinity;
      for (const p of playerList) {
        const d = dist(e, p);
        if (d < minD) { minD = d; target = p; }
      }

      if (target) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        const spd = ENEMY_STATS[e.kind].speed;

        // Capital ships orbit at range; scouts/cruisers charge
        if (e.kind === "capital" && minD < 280) {
          // Orbit – add perpendicular velocity
          e.vx = (-dy / len) * spd;
          e.vy = ( dx / len) * spd;
        } else {
          e.vx = (dx / len) * spd;
          e.vy = (dy / len) * spd;
        }
        e.angle = Math.atan2(dy, dx);

        // Enemy shooting
        if (e.shootCooldown > 0) {
          e.shootCooldown--;
        } else {
          e.shootCooldown = ENEMY_STATS[e.kind].shootRate;
          const ba = e.angle;
          if (e.kind === "scout") {
            // Single shot
            const eid = uuid();
            st.enemyBullets[eid] = { id: eid, x: e.x, y: e.y,
              vx: Math.cos(ba) * ENEMY_BULLET_SPEED, vy: Math.sin(ba) * ENEMY_BULLET_SPEED, life: 60 };
          } else if (e.kind === "cruiser") {
            // Double shot
            for (const off of [-0.15, 0.15]) {
              const eid = uuid();
              st.enemyBullets[eid] = { id: eid, x: e.x, y: e.y,
                vx: Math.cos(ba + off) * ENEMY_BULLET_SPEED, vy: Math.sin(ba + off) * ENEMY_BULLET_SPEED, life: 65 };
            }
          } else {
            // Capital: triple spread
            for (const off of [-0.25, 0, 0.25]) {
              const eid = uuid();
              st.enemyBullets[eid] = { id: eid, x: e.x, y: e.y,
                vx: Math.cos(ba + off) * ENEMY_BULLET_SPEED * 1.2, vy: Math.sin(ba + off) * ENEMY_BULLET_SPEED * 1.2, life: 75 };
            }
          }
        }
      }
      e.x += e.vx;
      e.y += e.vy;
    }

    // ── Player bullets ────────────────────────────────
    for (const [bid, b] of Object.entries(st.bullets)) {
      // Missile homing
      if (b.kind === "missile" && b.targetId && st.enemies[b.targetId]) {
        const t = st.enemies[b.targetId];
        const dx = t.x - b.x, dy = t.y - b.y;
        const len = Math.hypot(dx, dy) || 1;
        const turnRate = 0.15;
        const desired = { x: (dx / len) * MISSILE_SPEED, y: (dy / len) * MISSILE_SPEED };
        b.vx += (desired.x - b.vx) * turnRate;
        b.vy += (desired.y - b.vy) * turnRate;
        const spd = Math.hypot(b.vx, b.vy);
        if (spd > MISSILE_SPEED) { b.vx = (b.vx / spd) * MISSILE_SPEED; b.vy = (b.vy / spd) * MISSILE_SPEED; }
      }

      b.x += b.vx; b.y += b.vy; b.life--;

      if (b.life <= 0 || b.x < -80 || b.x > WORLD_W + 80 || b.y < -80 || b.y > WORLD_H + 80) {
        delete st.bullets[bid]; continue;
      }

      // Hit enemy
      const hitRange = b.kind === "missile" ? 20 : 14;
      let hit = false;
      for (const [eid, e] of Object.entries(st.enemies)) {
        if (dist(b, e) < hitRange) {
          e.hp -= b.damage;
          delete st.bullets[bid];
          hit = true;
          if (e.hp <= 0) {
            const score = ENEMY_STATS[e.kind].score;
            delete st.enemies[eid];
            const owner = st.players[b.ownerId];
            if (owner) owner.score += score;
            this.broadcast({ type: "explosion", x: e.x, y: e.y, kind: e.kind });
          } else {
            this.broadcast({ type: "hit", x: e.x, y: e.y });
          }
          break;
        }
      }
      if (hit) continue;
    }

    // ── Enemy bullets vs players ──────────────────────
    for (const [bid, b] of Object.entries(st.enemyBullets)) {
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life <= 0 || b.x < -80 || b.x > WORLD_W + 80 || b.y < -80 || b.y > WORLD_H + 80) {
        delete st.enemyBullets[bid]; continue;
      }
      for (const p of playerList) {
        if (dist(b, p) < HITBOX_PLAYER) {
          delete st.enemyBullets[bid];
          if (p.shield > 0) {
            p.shield--;
            this.broadcast({ type: "shield_hit", playerId: p.id });
          } else {
            p.alive = false;
            this.broadcast({ type: "player_dead", playerId: p.id, x: p.x, y: p.y });
          }
          break;
        }
      }
    }

    // ── Enemy ram vs player ───────────────────────────
    for (const e of Object.values(st.enemies)) {
      for (const p of playerList) {
        if (dist(e, p) < 22) {
          if (p.shield > 0) { p.shield--; } else { p.alive = false; }
          this.broadcast({ type: "player_dead", playerId: p.id, x: p.x, y: p.y });
        }
      }
    }

    // ── Wave clear ────────────────────────────────────
    if (Object.keys(st.enemies).length === 0) {
      st.wave++;
      // Restore shields on new wave
      for (const p of Object.values(st.players)) if (p.alive) p.shield = 3;
      this.spawnWave(st.wave);
      this.broadcast({ type: "new_wave", wave: st.wave });
    }

    // ── Broadcast state ───────────────────────────────
    this.broadcast({
      type: "tick", tick: st.tick,
      players: st.players, bullets: st.bullets,
      enemyBullets: st.enemyBullets, enemies: st.enemies, wave: st.wave,
    });
  }

  private spawnWave(wave: number) {
    // Wave composition: more capital ships in later waves
    const scouts  = Math.max(0, 4 + (wave - 1) * 1 - Math.floor(wave / 3));
    const cruisers = Math.min(wave - 1, 4);
    const capitals = wave >= 3 ? Math.floor((wave - 2) / 2) : 0;

    const spawn = (kind: Enemy["kind"]) => {
      const id  = uuid();
      const pos = spawnPos();
      const hp  = ENEMY_STATS[kind].hp + Math.floor(wave / 4);
      this.state.enemies[id] = {
        id, ...pos, vx: 0, vy: 0, hp, maxHp: hp,
        angle: 0, wave, kind, shootCooldown: Math.floor(Math.random() * 60),
      };
    };

    for (let i = 0; i < scouts;   i++) spawn("scout");
    for (let i = 0; i < cruisers; i++) spawn("cruiser");
    for (let i = 0; i < capitals; i++) spawn("capital");
  }

  private broadcast(msg: object) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }
}
