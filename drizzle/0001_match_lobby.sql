ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "matchmaking" boolean DEFAULT false NOT NULL;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "player0_ready" boolean DEFAULT false NOT NULL;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "player1_ready" boolean DEFAULT false NOT NULL;
