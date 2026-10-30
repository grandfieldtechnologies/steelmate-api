import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matches } from "@/db/schema";
import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { pairGuestOnMatch } from "@/lib/match/lobby";
import { reconcileUserActiveMatch } from "@/lib/match/finish";
import { findActiveMatchForUser } from "@/lib/match/tickMatch";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const userId = await requireAuthUserId();
    const body = (await req.json()) as {
      inviteCode?: string;
      deckId?: string;
    };
    if (!body.inviteCode?.trim() || !body.deckId) {
      return jsonWithCors(
        { error: "inviteCode and deckId required" },
        { status: 400, origin },
      );
    }
    const db = getDb();
    await reconcileUserActiveMatch(db, userId);
    const [matchRow] = await db
      .select()
      .from(matches)
      .where(eq(matches.inviteCode, body.inviteCode.trim().toUpperCase()))
      .limit(1);
    if (!matchRow || matchRow.status !== "waiting") {
      return jsonWithCors(
        { error: "Invite not found or already started" },
        { status: 404, origin },
      );
    }
    if (matchRow.player0UserId === userId) {
      return jsonWithCors(
        { error: "Cannot join your own match" },
        { status: 400, origin },
      );
    }
    const existing = await findActiveMatchForUser(db, userId);
    if (existing && existing.id !== matchRow.id) {
      return jsonWithCors(
        {
          error: "Already in an active match",
          activeMatch: {
            id: existing.id,
            status: existing.status,
            inviteCode: existing.inviteCode,
          },
        },
        { status: 409, origin },
      );
    }

    const paired = await pairGuestOnMatch(
      db,
      matchRow,
      userId,
      body.deckId,
    );
    if (!paired.ok) {
      return jsonWithCors({ error: paired.error }, { status: paired.status, origin });
    }

    return jsonWithCors(
      {
        match: {
          id: paired.match.id,
          status: paired.match.status,
        },
      },
      { origin },
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
