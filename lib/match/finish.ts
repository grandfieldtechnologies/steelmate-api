import { eq } from "drizzle-orm";
import type { PlayerId } from "@steelmate/engine";
import type { getDb } from "@/db/client";
import { matches } from "@/db/schema";
import type { MatchRow } from "@/lib/match/lobby";
import {
  clearUserActiveMatchIf,
  getUserActiveMatchId,
} from "@/lib/redis/activeMatch";

type Db = ReturnType<typeof getDb>;

export type FinishMatchPatch = {
  winner?: PlayerId | null;
};

export async function clearActiveMatchKeys(matchRow: MatchRow): Promise<void> {
  await clearUserActiveMatchIf(matchRow.player0UserId, matchRow.id);
  if (matchRow.player1UserId) {
    await clearUserActiveMatchIf(matchRow.player1UserId, matchRow.id);
  }
}

export async function finishMatchAndReleasePlayers(
  db: Db,
  matchId: string,
  matchRow: MatchRow,
  patch: FinishMatchPatch = {},
): Promise<void> {
  await db
    .update(matches)
    .set({
      status: "finished",
      winner: patch.winner ?? null,
      finishedAt: new Date(),
    })
    .where(eq(matches.id, matchId));
  await clearActiveMatchKeys(matchRow);
}

export async function reconcileUserActiveMatch(
  db: Db,
  userId: string,
): Promise<void> {
  const matchId = await getUserActiveMatchId(userId);
  if (!matchId) return;

  const [row] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!row || row.status === "finished") {
    await clearUserActiveMatchIf(userId, matchId);
    return;
  }

  if (row.player0UserId !== userId && row.player1UserId !== userId) {
    await clearUserActiveMatchIf(userId, matchId);
  }
}
