-- This is a basic schema for the multiplayer game database (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    coins INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    is_private BOOLEAN DEFAULT 0,
    created_by TEXT REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
