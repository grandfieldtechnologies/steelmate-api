import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matches } from "@/db/schema";
import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { buildActiveMatchResponse } from "@/lib/match/syncResponse";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: Request, { params }: Params) {
  const origin = req.headers.get("origin");
  const { id } = await params;
  const url = new URL(req.url);
  const sinceVersion = url.searchParams.get("sinceVersion");
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
    if (
      matchRow.player0UserId !== userId &&
      matchRow.player1UserId !== userId
    ) {
      return jsonWithCors({ error: "Forbidden" }, { status: 403, origin });
    }

    const sync = await buildActiveMatchResponse(
      db,
      id,
      matchRow,
      userId,
      sinceVersion,
    );
    if (sync.kind === "error") {
      return jsonWithCors(sync.body, { status: sync.status, origin });
    }
    if (sync.kind === "unchanged") {
      return jsonWithCors(sync.body, { origin });
    }
    return jsonWithCors(sync.body, { origin });
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

export async function POST(req: Request, { params }: Params) {
  return jsonWithCors(
    { error: "Use POST /api/v1/matches/[id]/actions" },
    { status: 405, origin: req.headers.get("origin") },
  );
}
