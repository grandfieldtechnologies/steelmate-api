import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matches } from "@/db/schema";
import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { cancelWaitingMatch } from "@/lib/match/lobby";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function POST(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const { id } = await params;
  try {
    const userId = await requireAuthUserId();
    const db = getDb();
    const [matchRow] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, id))
      .limit(1);
    if (!matchRow) {
      return jsonWithCors({ error: "Not found" }, { status: 404, origin });
    }
    if (matchRow.player0UserId !== userId && matchRow.player1UserId !== userId) {
      return jsonWithCors({ error: "Forbidden" }, { status: 403, origin });
    }

    const result = await cancelWaitingMatch(db, matchRow, userId);
    if (!result.ok) {
      return jsonWithCors({ error: result.error }, { status: result.status, origin });
    }
    return jsonWithCors({ ok: true }, { origin });
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
