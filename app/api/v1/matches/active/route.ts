import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { getDb } from "@/db/client";
import { findActiveMatchForUser } from "@/lib/match/tickMatch";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  try {
    const userId = await requireAuthUserId();
    const db = getDb();
    const row = await findActiveMatchForUser(db, userId);
    if (!row) {
      return jsonWithCors({ match: null }, { origin });
    }
    const canCancel =
      row.status === "waiting" &&
      row.player1UserId == null &&
      row.player0UserId === userId;
    return jsonWithCors(
      {
        match: {
          id: row.id,
          status: row.status,
          inviteCode: row.inviteCode,
          matchmaking: row.matchmaking,
          canCancel,
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
