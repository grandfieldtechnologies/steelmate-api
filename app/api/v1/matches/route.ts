import { eq, and } from "drizzle-orm";
import { createGame } from "@steelmate/engine";
import { getDb } from "@/db/client";
import { decks, matches } from "@/db/schema";
import { AuthError, requireAuthUserId } from "@/lib/auth";
import { getServerCatalog, requireCatalogVersion } from "@/lib/catalog";
import { jsonWithCors, preflight } from "@/lib/cors";
import { randomInviteCode, randomSeed } from "@/lib/game-utils";
import { saveMatchPayload } from "@/lib/redis/match";
import { setUserActiveMatch } from "@/lib/redis/activeMatch";
import { findActiveMatchForUser } from "@/lib/match/tickMatch";
import { reconcileUserActiveMatch } from "@/lib/match/finish";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const userId = await requireAuthUserId();
    const body = (await req.json()) as { deckId?: string };
    if (!body.deckId) {
      return jsonWithCors({ error: "deckId required" }, { status: 400, origin });
    }
    const catalogVersion = requireCatalogVersion();
    const db = getDb();
    await reconcileUserActiveMatch(db, userId);
    const active = await findActiveMatchForUser(db, userId);
    if (active) {
      return jsonWithCors(
        {
          error: "Already in an active match",
          activeMatch: {
            id: active.id,
            status: active.status,
            inviteCode: active.inviteCode,
          },
        },
        { status: 409, origin },
      );
    }
    const [deck] = await db
      .select()
      .from(decks)
      .where(and(eq(decks.id, body.deckId), eq(decks.userId, userId)))
      .limit(1);
    if (!deck) {
      return jsonWithCors({ error: "Deck not found" }, { status: 404, origin });
    }
    if (deck.catalogVersion !== catalogVersion) {
      return jsonWithCors(
        { error: "Deck catalog version outdated; re-save deck" },
        { status: 400, origin },
      );
    }
    const inviteCode = randomInviteCode().toUpperCase();
    const seed = randomSeed();
    const [match] = await db
      .insert(matches)
      .values({
        inviteCode,
        status: "waiting",
        catalogVersion,
        seed,
        player0UserId: userId,
        deck0Id: deck.id,
      })
      .returning();
    await setUserActiveMatch(userId, match!.id);
    return jsonWithCors(
      {
        match: {
          id: match!.id,
          inviteCode: match!.inviteCode,
          status: match!.status,
        },
      },
      { status: 201, origin },
    );
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonWithCors({ error: e.message }, { status: e.status, origin });
    }
    return jsonWithCors(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500, origin },
    );
  }
}
