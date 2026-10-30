import { getRedis } from "@/lib/redis/match";

function userActiveMatchKey(userId: string): string {
  return `user:${userId}:activeMatch`;
}

const CLEAR_IF_MATCH_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function getUserActiveMatchId(
  userId: string,
): Promise<string | null> {
  const value = await getRedis().get<string>(userActiveMatchKey(userId));
  return value ?? null;
}

export async function setUserActiveMatch(
  userId: string,
  matchId: string,
): Promise<void> {
  await getRedis().set(userActiveMatchKey(userId), matchId, {
    ex: 60 * 60 * 24,
  });
}

export async function clearUserActiveMatchIf(
  userId: string,
  matchId: string,
): Promise<void> {
  await getRedis().eval(CLEAR_IF_MATCH_SCRIPT, [userActiveMatchKey(userId)], [
    matchId,
  ]);
}

/** Unconditional delete; prefer clearUserActiveMatchIf when releasing a specific match. */
export async function clearUserActiveMatch(userId: string): Promise<void> {
  await getRedis().del(userActiveMatchKey(userId));
}
