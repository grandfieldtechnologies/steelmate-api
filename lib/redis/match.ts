import { Redis } from "@upstash/redis";
import { MATCH_REDIS_TTL_SEC } from "@/lib/match/constants";
import type { GameState, PlayerId } from "@steelmate/engine";

export type MatchRedisPayload = {
  state: GameState;
  version: number;
  playerRoles: { 0: string; 1?: string };
  eventCursor: number;
  phaseDeadlineAt?: number;
  lastActionUserId?: string;
};

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("Upstash Redis env vars missing");
    redis = new Redis({ url, token });
  }
  return redis;
}

export function matchKey(matchId: string): string {
  return `match:${matchId}`;
}

export async function loadMatchPayload(
  matchId: string,
): Promise<MatchRedisPayload | null> {
  return getRedis().get<MatchRedisPayload>(matchKey(matchId));
}

export async function saveMatchPayload(
  matchId: string,
  payload: MatchRedisPayload,
  ttlSeconds = MATCH_REDIS_TTL_SEC,
): Promise<void> {
  await getRedis().set(matchKey(matchId), payload, { ex: ttlSeconds });
}

export function playerIdForUser(
  payload: MatchRedisPayload,
  userId: string,
): PlayerId | null {
  if (payload.playerRoles[0] === userId) return 0;
  if (payload.playerRoles[1] === userId) return 1;
  return null;
}
