# Plan: Seguridad y Arquitectura Cloudflare Industry Standard

## Archivos a crear (4)

### 1. `src/infrastructure/network/auth.ts`
Token validation + origin allowlist:
- `generateToken(name, secret)` → cliente genera token HMAC
- `validateToken(token, secret)` → servidor valida
- `isOriginAllowed(origin, allowedOrigins)` → protege contra conexiones de orígenes no autorizados

### 2. `src/infrastructure/network/rateLimit.ts`
Connection rate limiter:
- `checkConnectionRate(ip)` → sliding window, max 3 conexiones por minuto por IP
- `resetRateLimit(ip)` → cleanup

### 3. `src/infrastructure/network/validator.ts`
Message schema validation con type guards:
- `validateMessage(raw)` → valida estructura, tipos, tamaños máximos
- Reemplaza `validateMessage` en network.ts con validación estricta

### 4. `client/src/network/codec.ts`
Binary codec:
- `pack(data)` → encode
- `unpack(buffer)` → decode
- Usa TextEncoder/TextDecoder nativo (sin dependencias)

## Archivos a modificar (7)

### 5. `src/infrastructure/GameRoom.ts`
- Reemplazar `setInterval` por `this.ctx.storage.setAlarm(Date.now() + TICK_MS)`
- Implementar `async alarm()` handler con try/catch
- Usar `this.ctx.acceptWebSocket(server)` (Hibernation API)
- Agregar `webSocketMessage()` handler (automático con hibernación)
- Validar origin + token en `fetch()` antes de aceptar WS
- Remover `loopTimer`, `startLoop()`, `stopLoop()`
- El alarm loop: si hay players conectados, reschedule alarm
- Si no hay players, guardar estado y NO reschedule

### 6. `src/index.ts`
- Agregar `GET /health` endpoint con status, timestamp, version
- Agregar origin check a nivel Worker para /room/
- Pasar `AUTH_SECRET` a Durable Object stub como header

### 7. `src/infrastructure/env.ts`
Agregar:
- `AUTH_SECRET: string`
- `ALLOWED_ORIGINS: string` (opcional, con default)

### 8. `wrangler.json`
Agregar en `vars`:
- `ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:8787,https://speakerdust.pages.dev"`

### 9. `src/infrastructure/network/network.ts`
- Mejorar `validateMessage`: limitar tamaño máximo (10KB), validar tipos de campos
- Agregar constantes MAX_MESSAGE_BYTES

### 10. `client/src/game.ts`
- Generar token al conectar: `?token=${generateToken(playerName, secret)}`
- Usar codec para mensajes (binary mode flag)
- Enviar player name si no existe

### 11. `client/vite.config.ts`
- Agregar proxy para /room/ → localhost:8787 (para desarrollo single-port)

## Orden de implementación

1. auth.ts + rateLimit.ts + validator.ts (archivos nuevos, no rompen nada)
2. env.ts (solo agrega campos)
3. wrangler.json (vars no rompen)
4. index.ts (health endpoint no rompe)
5. GameRoom.ts (cambio crítico: reemplazar setInterval + Hibernation + auth)
6. network.ts (mejorar validación)
7. codec.ts (cliente nuevo)
8. game.ts (agregar token)
9. vite.config.ts (proxy)
