import { GameRoom } from "./infrastructure/GameRoom";
import type { Env } from "./infrastructure/env";
import { isOriginAllowed } from "./infrastructure/network/auth";
export { GameRoom };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return new Response(JSON.stringify({
				status: "ok",
				version: "0.1.0",
				timestamp: Date.now(),
			}), {
				headers: { "Content-Type": "application/json" },
			});
		}

		if (url.pathname.startsWith('/room/')) {
			const roomId = url.pathname.split('/')[2];
			if (!roomId) {
				return new Response("Room ID required", { status: 400 });
			}

			if (request.headers.get("Upgrade") === "websocket") {
				const origin = request.headers.get("Origin") ?? "";
				if (!isOriginAllowed(origin, env.ALLOWED_ORIGINS)) {
					return new Response("Origin not allowed", { status: 403 });
				}
			}

			const id = env.GAME_ROOM.idFromName(roomId);
			const stub = env.GAME_ROOM.get(id);

			if (request.headers.get("Upgrade") === "websocket") {
				return stub.fetch(request);
			}

			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		return new Response("Speakerdust - connect to /room/<id> via WebSocket.");
	},
} satisfies ExportedHandler<Env>;
