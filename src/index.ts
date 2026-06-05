import { GameRoom } from "./GameRoom";
export { GameRoom };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Expected format: /room/room_id
		if (url.pathname.startsWith('/room/')) {
			const roomId = url.pathname.split('/')[2];
			if (!roomId) {
				return new Response("Room ID required", { status: 400 });
			}

			// Forward the request to the GameRoom Durable Object
			const id = env.GAME_ROOM.idFromName(roomId);
			const stub = env.GAME_ROOM.get(id);

			// Support standard WebSocket upgrade request
			if (request.headers.get("Upgrade") === "websocket") {
				return stub.fetch(request);
			}

			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		return new Response("Hello from Cloudflare Workers! Connect to /room/<id> via WebSocket.");
	},
} satisfies ExportedHandler<Env>;
