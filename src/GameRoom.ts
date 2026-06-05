import { DurableObject } from "cloudflare:workers";

export class GameRoom extends DurableObject<Env> {
	sessions: WebSocket[];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sessions = [];
	}

	async fetch(request: Request): Promise<Response> {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);

		const url = new URL(request.url);
		server.serializeAttachment({
			id: crypto.randomUUID(),
			joinedAt: Date.now(),
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		// Broadcast the message to all other connected clients
		const activeSockets = this.ctx.getWebSockets();
		for (const socket of activeSockets) {
			if (socket !== ws) {
				try {
					socket.send(message);
				} catch (err) {
					// Handle failed sends
				}
			}
		}
	}

	webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		// Handle disconnection
		console.log(`WebSocket closed: ${code} ${reason}`);
	}
}
