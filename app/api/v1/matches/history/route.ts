import { eq, or, and, desc } from "drizzle-orm";
import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { getDb } from "@/db/client";
import { matches, users } from "@/db/schema";

export const runtime = "nodejs";

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 50));
  try {
    const userId = await requireAuthUserId();
    const db = getDb();
    const rows = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.status, "finished"),
          or(
            eq(matches.player0UserId, userId),
            eq(matches.player1UserId, userId),
          ),
        ),
      )
      .orderBy(desc(matches.finishedAt))
      .limit(limit);

    const history = await Promise.all(
      rows.map(async (m) => {
        const youAre0 = m.player0UserId === userId;
        const opponentId = youAre0 ? m.player1UserId : m.player0UserId;
        let opponentName = "Opponent";
        if (opponentId) {
          const [u] = await db
            .select()
            .from(users)
            .where(eq(users.clerkId, opponentId))
            .limit(1);
          opponentName = u?.displayName ?? opponentId;
        }
        const yourSeat = youAre0 ? 0 : 1;
        return {
          id: m.id,
          finishedAt: m.finishedAt,
          winner: m.winner,
          youWon: m.winner === yourSeat,
          opponentName,
        };
      }),
    );

    return jsonWithCors({ history }, { origin });
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
