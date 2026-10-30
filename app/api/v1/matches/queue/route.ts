import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { getDb } from "@/db/client";
import { enqueueForMatchmaking } from "@/lib/match/queue";

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
    const db = getDb();
    const result = await enqueueForMatchmaking(db, userId, body.deckId);
    if (!result.ok) {
      return jsonWithCors(
        {
          error: result.error,
          ...(result.activeMatch ? { activeMatch: result.activeMatch } : {}),
        },
        { status: result.status, origin },
      );
    }
    return jsonWithCors(
      {
        match: {
          id: result.match.id,
          status: result.match.status,
          inviteCode: result.match.inviteCode,
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
