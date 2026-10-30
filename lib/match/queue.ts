import { eq, and, asc, isNull, ne } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { decks, matches } from "@/db/schema";
import { requireCatalogVersion } from "@/lib/catalog";
import { randomInviteCode, randomSeed } from "@/lib/game-utils";
import { pairGuestOnMatch } from "@/lib/match/lobby";
import { reconcileUserActiveMatch } from "@/lib/match/finish";
import { findActiveMatchForUser } from "@/lib/match/tickMatch";
import { setUserActiveMatch } from "@/lib/redis/activeMatch";

type Db = ReturnType<typeof getDb>;

const PAIR_RETRY_ATTEMPTS = 6;

export async function enqueueForMatchmaking(
  db: Db,
  userId: string,
  deckId: string,
): Promise<
  | { ok: true; match: typeof matches.$inferSelect }
  | { ok: false; error: string; status: number; activeMatch?: unknown }
> {
  await reconcileUserActiveMatch(db, userId);
  const active = await findActiveMatchForUser(db, userId);
  if (active) {
    return {
      ok: false,
      error: "Already in an active match",
      status: 409,
      activeMatch: {
        id: active.id,
        status: active.status,
        inviteCode: active.inviteCode,
      },
    };
  }

  const catalogVersion = requireCatalogVersion();
  const [deck] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!deck) {
    return { ok: false, error: "Deck not found", status: 404 };
  }
  if (deck.catalogVersion !== catalogVersion) {
    return {
      ok: false,
      error: "Deck catalog version outdated; re-save deck",
      status: 400,
    };
  }

  for (let attempt = 0; attempt < PAIR_RETRY_ATTEMPTS; attempt++) {
    const [hostRow] = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.status, "waiting"),
          eq(matches.matchmaking, true),
          isNull(matches.player1UserId),
          ne(matches.player0UserId, userId),
        ),
      )
      .orderBy(asc(matches.createdAt))
      .limit(1);

    if (!hostRow) break;

    const paired = await pairGuestOnMatch(db, hostRow, userId, deckId);
    if (paired.ok) {
      return { ok: true, match: paired.match };
    }
    if (paired.status === 409) continue;
    return { ok: false, error: paired.error, status: paired.status };
  }

  const inviteCode = randomInviteCode().toUpperCase();
  const seed = randomSeed();
  const [match] = await db
    .insert(matches)
    .values({
      inviteCode,
      status: "waiting",
      matchmaking: true,
      catalogVersion,
      seed,
      player0UserId: userId,
      deck0Id: deck.id,
    })
    .returning();

  await setUserActiveMatch(userId, match!.id);
  return { ok: true, match: match! };
}
