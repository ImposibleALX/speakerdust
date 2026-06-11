# SPEAKERDUST — Game Design Document
**Language:** English (code-referenced)  
**Genre:** Cooperative Tactical Naval Space Combat  
**Stack:** Cloudflare Workers + Durable Objects + D1 SQL, HTML5 Canvas (Vanilla JS), Web Audio API  
**Render:** Pixel-art sprite system with convex-hull collision, data-driven ship classes

---

## 1. Core Architecture

### 1.1 Server (Cloudflare Durable Object: `GameRoom`)

Each multiplayer session runs in an isolated Durable Object instance at the edge. The server is authoritative — it runs physics, validates all inputs, and broadcasts state.

**Files:**
- `src/infrastructure/GameRoom.ts` — Durable Object class, message dispatch, game tick loop
- `src/infrastructure/network/validator.ts` — input sanitization (whitelist of allowed message types)
- `src/features/physics/playerSystem.ts` — player ship lifecycle, damage, collision
- `src/features/ai/enemySystem.ts` — AI fleet spawning, movement, targeting
- `src/features/combat/combatSystem.ts` — shot validation, projectile lifecycle
- `src/core/combat/projectiles.ts` — bullet/missile/beam/mine simulation, hit detection

**Tick Loop** (`gameTick` at `TICK_MS = 33ms`, ~30 Hz):
1. Process queued player inputs (movement, shooting, class change)
2. Run AI enemy decisions (target acquisition, movement, firing)
3. Update projectile positions and check ship collisions (two-phase: bounding circle → SAT polygon)
4. Update control zone capture progress
5. Apply zone bonuses (heat dissipation, shield regen, repair)
6. Check death / respawn conditions
7. Broadcast `tick` payload to all connected WebSocket clients

### 1.2 Client (Vanilla JS + HTML5 Canvas)

The client is a thin renderer with input prediction. It receives full state snapshots every tick and interpolates between them.

**Files:**
- `client/src/game.ts` — main loop (render, input, UI), ship drawing, class selector GUI
- `client/src/networkManager.ts` — WebSocket lifecycle, message dispatch, state sync
- `client/src/renderer/renderer.ts` — `createPixelShipRenderer` (sprite blitting with palette swapping)
- `client/src/particleSystem.ts` — particle explosions, muzzle flashes
- `client/src/audioManager.ts` — procedural Web Audio API synthesis (no audio files)
- `client/src/camera.ts` — screen shake, viewport tracking
- `client/src/uiManager.ts` — HUD elements, game-over overlay, admin panel

### 1.3 Shared Library (`@speakerdust/shared`)

Type definitions and pure functions used by both server and client.

**Files:**
- `shared/src/ships/ShipClassDef.ts` — `ShipClassDef` interface (physics, stats, AI, explosion, rendering)
- `shared/src/ships/shipClasses.ts` — data definitions for all 7 ship classes
- `shared/src/sprite/spriteCollision.ts` — `hullFromPixels` (convex hull via monotone chain), `satOverlap`, `circlePolyOverlap`, `pointInPoly`
- `shared/src/physics/shipPhysics.ts` — `ShipPhysics` engine class (acceleration, drag, turning)
- `shared/src/weapons/weaponDefs.ts` — weapon stat definitions

---

## 2. Ship Class System (Data-Driven)

All ship classes are defined entirely in data — zero hardcoded `if (shipClass === "...")` blocks.

### 2.1 `ShipClassDef` Interface (`ShipClassDef.ts`)

```typescript
interface ShipClassDef {
  physics: ShipConfig;      // mass, thrust, drag, turn rate
  stats: ShipGameplayStats; // HP, shield, armor, weapon slots, ideal range
  ai: ShipAI;               // aimJitter, leadMul, aimNoise, seek/retreat/orbit params
  explosion: ExplosionConfig; // colors, count, size, scale, shake intensity/radius
  nearAudioDistance: number;  // proximity audio trigger distance (0 = off)
  paletteKey: "scout" | "cruiser" | "capital";
  glowColor: string;          // engine/highlight color
  pixels: Uint8Array;         // sprite pixel data
  w: number; h: number;       // sprite dimensions
  attachments: Attachment[];  // engine/weapon mount points
  hull: Hull;                 // convex hull vertices + bounding radius
  defaultLoadout: Record<string, WeaponKind>;
}
```

### 2.2 Seven Ship Classes

| ID | Role | HP | Mass | Speed | AI Lead | Palette |
|----|------|----|------|-------|---------|---------|
| corvette | Fast scout | 5 | 1.0 | 30 | 14 | scout |
| destroyer | Line combatant | 8 | 1.6 | 25 | 14 | cruiser |
| missile_frigate | Standoff pressure | 7 | 1.45 | 23 | 14 | cruiser |
| cruiser | Area control | 11 | 2.3 | 20 | 14 | cruiser |
| battlecruiser | Heavy pursuit | 14 | 2.8 | 17 | 14 | capital |
| battleship | Dominant artillery | 18 | 3.4 | 14 | 22 | capital |
| dreadnought | Fleet anchor | 26 | 4.6 | 11 | 22 | capital |

### 2.3 Player Class Switching

- GUI at bottom of screen: 7 clickable buttons showing class labels with glow-color borders
- Keyboard: `[` / `]` to cycle forward/backward
- Client sends `{ type: "changeClass", shipClass: "..." }`
- Server validates class exists (`SHIP_CLASSES[cls]`), guards against same-class, calls `respawnPlayer(ship)`, sends `{ type: "respawned" }` + `{ type: "weapon_changed" }`

---

## 3. Physics & Movement

### 3.1 Ship Physics Engine (`ShipPhysics`)

The server runs a dedicated physics engine per ship:

```
acceleration = input * thrustForce / mass
velocity += acceleration - velocity * linearDrag
position += velocity
angularVelocity = approach(targetAngle, angle, turnRate)
```

- **Thrust** (`inputForward`): accelerates along ship heading
- **Strafe** (`inputStrafe`): accelerates perpendicular to heading
- **Turn** (`inputTurn` or auto-aim toward `targetAngle`): angular velocity with `turnAccel` and `angularDrag`
- **Boost** (`Shift` / right-click): impulse of `1.2 / mass` in current thrust direction, costs 34 energy, 120-tick cooldown
- **Drag**: determines stopping distance; heavy ships (dreadnought: 0.12) coast far, light ships (corvette: 1.2) stop quickly

### 3.2 Collision Detection (Two-Phase)

**Bullet / Missile → Ship** (`shipHitByCircle` in `projectiles.ts`):
1. **Broad phase**: distance between centers < `hull.radius + bullet.radius`? (bounding circle test — fast reject)
2. **Narrow phase**: `circlePolyOverlap(circle, bulletR, transformedHullVerts)` — SAT-based circle-vs-convex-polygon using the sprite's exact hull vertices

**Ship → Ship** (`resolveShipCollision` in `playerSystem.ts`):
- Full SAT (`satOverlap`) on both ships' transformed hull vertices
- Resolves penetration by mass-weighted positional push
- Applies collision damage if relative velocity > threshold (`5.8`)

### 3.3 Hitbox Generation (`hullFromPixels`)

At build time (`shipClasses.ts`), each sprite's non-zero pixels feed into a **Monotone Chain (Andrew's algorithm)** convex hull algorithm. The resulting polygon is stored as `hull.vertices`. A bounding radius (`hull.radius`) is computed as the max distance from center to any vertex (used only for broad-phase optimization).

---

## 4. Combat System

### 4.1 Damage Layers

1. **Shield**: absorbs 1 hit per charge; `shieldRegenDelay` ticks after last hit, then regenerates 1 charge every `shieldRegenInterval` ticks
2. **Armor**: absorbs `ceil(damage * 0.45)` points; armor-piercing weapons (railgun) bypass
3. **Hull HP**: structural integrity; 0 = dead

Weapons and their effects are defined in `weaponDefs.ts` with parameters: damage, cooldown, heat cost, velocity, lifetime, projectile radius, recoil, splash radius, charge ticks, fire arc, and special effects (EMP, piercing, homing).

### 4.2 Heat System

Each shot adds `weaponHeat`. Heat passively dissipates at `stats.heatCoolRate + zoneBonus` per tick. If heat exceeds `SHIP_HEAT_LIMIT = 100`, the weapon can still fire up to a safety buffer of 140; beyond that the weapon jams until heat dissipates.

### 4.3 Explosions (Data-Driven)

Explosion is a single particle burst per class (no multi-stage setTimeout). The client receives `{ type: "explosion", x, y, kind: shipClass }`, looks up `SHIP_CLASSES[kind].explosion`, and emits particles with class-specific colors, count, size, scale, and optional screen shake.

---

## 5. AI Enemy Fleet (`enemySystem.ts`)

All AI behavior is driven by `ShipClassDef.ai`:

```typescript
interface ShipAI {
  aimJitter: number;    // reaction time randomness (ticks)
  leadMul: number;      // target leading multiplier (ticks)
  aimNoise: number;     // angular spread on final aim
  maxAimError: number;  // firing tolerance
  seekSpeed: number;    // approach velocity (toward ideal range)
  retreatSpeed: number; // backpedal velocity
  orbitPower: number;   // lateral orbit intensity
}
```

**Decision Loop** (per AI ship, each tick):
1. **Target acquisition**: scan for nearest player within 860px; if none found, move toward nearest control zone
2. **Movement**: seek/retreat based on distance from `idealRange`; orbit around target using phase from wave index + formation index + maneuver timer
3. **Firing**: check distance, aim with prediction (leadMul), apply noise, check maxAimError vs actual aim delta
4. **Wave scaling**: enemy HP scales as `+1 HP per 4 waves`; spawn count follows a crescendo formula per class type

---

## 6. Objectives & Zone Control

Three fixed control points on the map. Each zone has a capture progress bar (0–100%). Progress increases when ships are inside the zone radius, weighted by proximity. If both teams occupy the same zone, their pressures cancel. Captured zones grant passive bonuses:

| Zone | Bonus |
|------|-------|
| Energy Refinery (center) | +0.22 heat dissipation, +0.24 boost regen, -1 shield delay tick |
| Comms Relay (top-left) | 1.25x capture pressure scale |
| Resource Platform (bottom-right) | +1 score every 14 ticks |

Zone progress and ownership are broadcast in every tick payload, rendered as colored rings in `drawObjectives()`.

---

## 7. Rendering Pipeline

### 7.1 Sprite System

Each ship has a pixel grid (2D array of palette indices) converted to a `Uint8Array` at build time. The client renderer (`createPixelShipRenderer`) maps palette indices to colors using per-class palette lookups:
- `PAL_SCOUT` — small ships (corvette)
- `PAL_CRUISER_ENEMY` — medium ships (destroyer, frigate, cruiser)
- `PAL_CAPITAL` — large ships (battlecruiser, battleship, dreadnought)

Player ships use a procedurally generated palette from their HSL color `(hue, 80%, 65%)`.

### 7.2 Drawing Order (per frame)

1. `drawBackground()` — starfield parallax
2. `drawObjectives()` — zone rings with ownership colors
3. `drawBullets()` — projectile sprites
4. `drawEnemies()` — AI ships with glow, shadow, HP bar (all data-driven from ShipClassDef)
5. `drawPlayers()` — player ships with team colors, weapon HUD
6. `drawParticles()` — explosion particles, engine trails
7. `drawClassSelector()` — ship class GUI buttons (bottom-center, DPR-aware)

### 7.3 Class Selector GUI

Rendered at bottom of canvas as 7 buttons (88x20px each) with class labels. Current class is highlighted with its `glowColor` fill. Click detection uses `getBoundingClientRect` in CSS pixel coordinates, matching the DPR-scaled canvas transform.

---

## 8. Network Protocol

### 8.1 Connection Flow

1. Client generates a session token via `generateToken("player")`
2. Connects via WebSocket: `/room/{ROOM_ID}?token={TOKEN}`
3. Server validates token, creates player ship, sends `init` payload
4. Server begins broadcasting `tick` payloads at ~30 Hz

### 8.2 Message Types

**Client → Server** (whitelist in `validator.ts`):
- `move` — throttle, strafe, turn, aimAngle
- `shoot` — fire current weapon
- `switch_weapon` — cycle to next weapon slot
- `boost` — trigger engine surge
- `respawn` — request respawn after death
- `changeClass` — switch ship class (triggers respawn)
- `set_team` — change team assignment
- `chat` — quick-chat messages
- `admin_*` — admin commands (auth required)

**Server → Client**:
- `init` — full state on connect
- `tick` — incremental state (ships, bullets, zones, wave)
- `player_dead` — ship destroyed
- `respawned` — ship revived
- `weapon_changed` — weapon slot cycled
- `explosion` — visual/audio trigger
- `hit` / `shield_hit` — damage feedback
- `new_wave` — wave transition
- `admin_authed` / `admin_godmode` / `admin_event` — admin responses

### 8.3 Rate Limiting

- **Move**: max 1 per 16ms
- **Shoot**: synced to server tick (30 Hz)
- **Boost**: max 1 per 100ms
- **Respawn**: no limit (server validates `ship.alive`)

---

## 9. Audio System (Procedural)

All sounds are synthesized at runtime via Web Audio API — no audio files.

| Sound | Technique |
|-------|-----------|
| Engine boost | Square wave, 180→90Hz sweep, 0.08s |
| Cannons/railgun | Square wave, 880→1360Hz sweep |
| Plasma/autocannon | Triangle wave triplets, 620–1040Hz |
| Missiles/torpedoes | Sawtooth low-frequency mix with decay |
| Explosions | Bandpass white noise at 520Hz center |
| Haptic (gamepad) | `vibrationActuator.playEffect("dual-rumble")`; `navigator.vibrate()` after user gesture only |

---

## 10. Persistence & State Recovery

- State serialized every 30 ticks (~1s) via `PersistenceQueue` to Durable Object storage
- On DO wake from hibernation, `hydrateState()` reconstructs ships, AI states, zones
- D1 database stores `users` (profiles) and `rooms` (active session metadata)
- Client reconnects automatically on WebSocket close (2.5s delay)

---

## 11. Admin Panel

- Trigger: `Ctrl+Shift+A` or `F10`
- Auth: send `admin_auth { key }` — server compares against `env.ADMIN_KEY`
- Commands (once authenticated): reset all players, clear enemies, set wave, kick player, toggle godmode, heal all, force team change
- Admin state persisted per-player (`ship.isAdmin`), broadcast to all clients for UI updates

---

## 12. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Data-driven ship classes** | Zero special-case `if/else` on class names; all behavior from `ShipClassDef` (AI, explosion, rendering, audio) |
| **Convex hull hitbox** | Generated from sprite pixels via monotone chain algorithm; SAT-based collision with circle pre-filter |
| **Authoritative server** | All physics and combat logic runs server-side; client is a thin renderer |
| **Procedural audio** | No asset downloads; sounds synthesized via Web Audio API |
| **Durable Objects** | Each game room is an isolated, persisting edge process with in-memory state |
| **Pixel-art with palette swapping** | Each sprite stores palette indices; player color is rendered by mapping indices to HSL-derived palette |
