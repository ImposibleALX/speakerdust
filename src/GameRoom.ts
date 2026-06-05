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
}

interface Bullet {
  id: string;
  ownerId: string;
  x: number; y: number;
  vx: number; vy: number;
  life: number; // ticks remaining
}

interface Enemy {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  angle: number;
  wave: number;
}

interface GameState {
  players: Record<string, Player>;
  bullets: Record<string, Bullet>;
  enemies: Record<string, Enemy>;
  wave: number;
  tick: number;
}

// ─────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────
const WORLD_W      = 1200;
const WORLD_H      = 800;
const TICK_MS      = 33;       // ~30 fps
const BULLET_SPEED = 14;
const BULLET_LIFE  = 55;       // ticks
const PLAYER_SPEED = 4;
const ENEMY_SPEED  = 1.4;
const ENEMY_HP     = 2;
const ENEMIES_PER_WAVE = 5;
const ENEMY_SPAWN_MARGIN = 80;
const HITBOX_BULLET_ENEMY = 14;
const HITBOX_ENEMY_PLAYER = 20;

function uuid(): string { return crypto.randomUUID(); }
function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function dist(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }

function spawnEnemyPos(): Vec2 {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: rand(0, WORLD_W), y: -ENEMY_SPAWN_MARGIN };
  if (side === 1) return { x: WORLD_W + ENEMY_SPAWN_MARGIN, y: rand(0, WORLD_H) };
  if (side === 2) return { x: rand(0, WORLD_W), y: WORLD_H + ENEMY_SPAWN_MARGIN };
  return { x: -ENEMY_SPAWN_MARGIN, y: rand(0, WORLD_H) };
}

// ─────────────────────────────────────────────────────────
//  Durable Object: GameRoom
// ─────────────────────────────────────────────────────────
export class GameRoom extends DurableObject<Env> {
  private state: GameState = {
    players: {},
    bullets: {},
    enemies: {},
    wave: 1,
    tick: 0,
  };
  private loopTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.startLoop();
    this.spawnWave(1);
  }

  // ── WebSocket handshake ────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Connect via WebSocket to /room/<id>", { status: 200 });
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
      score: 0,
      alive: true,
    };

    // Send init packet to the new player
    server.send(JSON.stringify({
      type: "init",
      playerId,
      worldW: WORLD_W,
      worldH: WORLD_H,
      state: this.state,
    }));

    this.broadcast({ type: "player_join", player: this.state.players[playerId] });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Incoming messages from clients ────────────────────
  webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string) {
    const { playerId } = ws.deserializeAttachment() as { playerId: string };
    const player = this.state.players[playerId];
    if (!player || !player.alive) return;

    let msg: any;
    try { msg = JSON.parse(raw as string); } catch { return; }

    switch (msg.type) {
      case "move": {
        // Clients send desired velocity; server authoritative
        const spd = PLAYER_SPEED;
        const vx = Math.max(-1, Math.min(1, msg.vx ?? 0));
        const vy = Math.max(-1, Math.min(1, msg.vy ?? 0));
        player.x = Math.max(10, Math.min(WORLD_W - 10, player.x + vx * spd));
        player.y = Math.max(10, Math.min(WORLD_H - 10, player.y + vy * spd));
        player.angle = typeof msg.angle === "number" ? msg.angle : player.angle;
        break;
      }
      case "shoot": {
        const bId = uuid();
        const angle = player.angle;
        this.state.bullets[bId] = {
          id: bId,
          ownerId: playerId,
          x: player.x + Math.cos(angle) * 18,
          y: player.y + Math.sin(angle) * 18,
          vx: Math.cos(angle) * BULLET_SPEED,
          vy: Math.sin(angle) * BULLET_SPEED,
          life: BULLET_LIFE,
        };
        break;
      }
    }
  }

  webSocketClose(ws: WebSocket) {
    const { playerId } = ws.deserializeAttachment() as { playerId: string };
    delete this.state.players[playerId];
    this.broadcast({ type: "player_leave", playerId });
  }

  // ── Server-side game loop ──────────────────────────────
  private startLoop() {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const st = this.state;
    st.tick++;

    // Move enemies, aim at nearest player
    const playerList = Object.values(st.players).filter(p => p.alive);

    for (const e of Object.values(st.enemies)) {
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
        e.vx = (dx / len) * ENEMY_SPEED;
        e.vy = (dy / len) * ENEMY_SPEED;
        e.angle = Math.atan2(dy, dx);
      }
      e.x += e.vx;
      e.y += e.vy;
    }

    // Move bullets
    for (const [bid, b] of Object.entries(st.bullets)) {
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      if (b.life <= 0 || b.x < -50 || b.x > WORLD_W + 50 || b.y < -50 || b.y > WORLD_H + 50) {
        delete st.bullets[bid];
        continue;
      }

      // Bullet vs enemy collision
      for (const [eid, e] of Object.entries(st.enemies)) {
        if (dist(b, e) < HITBOX_BULLET_ENEMY) {
          e.hp--;
          delete st.bullets[bid];
          if (e.hp <= 0) {
            delete st.enemies[eid];
            const owner = st.players[b.ownerId];
            if (owner) owner.score += 100;
            this.broadcast({ type: "explosion", x: e.x, y: e.y });
          }
          break;
        }
      }
    }

    // Enemy vs player collision → player dies
    for (const e of Object.values(st.enemies)) {
      for (const p of playerList) {
        if (dist(e, p) < HITBOX_ENEMY_PLAYER) {
          p.alive = false;
          this.broadcast({ type: "player_dead", playerId: p.id, x: p.x, y: p.y });
        }
      }
    }

    // Check wave clear
    if (Object.keys(st.enemies).length === 0) {
      st.wave++;
      this.spawnWave(st.wave);
      this.broadcast({ type: "new_wave", wave: st.wave });
    }

    // Broadcast delta every tick
    this.broadcast({
      type: "tick",
      tick: st.tick,
      players: st.players,
      bullets: st.bullets,
      enemies: st.enemies,
      wave: st.wave,
    });
  }

  private spawnWave(wave: number) {
    const count = ENEMIES_PER_WAVE + (wave - 1) * 2;
    for (let i = 0; i < count; i++) {
      const id = uuid();
      const pos = spawnEnemyPos();
      this.state.enemies[id] = {
        id, ...pos, vx: 0, vy: 0,
        hp: ENEMY_HP + Math.floor(wave / 3),
        angle: 0, wave,
      };
    }
  }

  private broadcast(msg: object) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }
}
