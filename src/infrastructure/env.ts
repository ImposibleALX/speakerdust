import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  ADMIN_KEY: string;
  AUTH_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  GAME_ROOM: DurableObjectNamespace;
  DB: D1Database;
}
