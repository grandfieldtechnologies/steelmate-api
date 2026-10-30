import { eq, max } from "drizzle-orm";
import {
  applyAction,
  legalActions,
  projectGameStateForPlayer,
  type PlayerAction,
} from "@steelmate/engine";
import { getDb } from "@/db/client";
import { matchActions, matches } from "@/db/schema";
import { AuthError, requireAuthUserId } from "@/lib/auth";
import { jsonWithCors, preflight } from "@/lib/cors";
import { actionsEqual } from "@/lib/game-utils";
import {
  loadMatchPayload,
  playerIdForUser,
  saveMatchPayload,
} from "@/lib/redis/match";
import { finishMatchAndReleasePlayers } from "@/lib/match/finish";
import { setPhaseDeadline, tickMatch } from "@/lib/match/tickMatch";

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
    const body = (await req.json()) as { action?: PlayerAction };
    if (!body.action || typeof body.action !== "object") {
      return jsonWithCors({ error: "action required" }, { status: 400, origin });
    }

    const db = getDb();
    const [matchRow] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, id))
      .limit(1);
    if (!matchRow || matchRow.status !== "active") {
      return jsonWithCors({ error: "Match not active" }, { status: 400, origin });
    }
    if (
      matchRow.player0UserId !== userId &&
      matchRow.player1UserId !== userId
    ) {
      return jsonWithCors({ error: "Forbidden" }, { status: 403, origin });
    }

    const tick = await tickMatch(db, id, matchRow);
    if (tick.kind !== "ok") {
      return jsonWithCors({ error: "Match unavailable" }, { status: 503, origin });
    }
    let payload = tick.payload;

    const playerId = playerIdForUser(payload, userId);
    if (playerId === null) {
      return jsonWithCors({ error: "Forbidden" }, { status: 403, origin });
    }

    const actor =
      payload.state.respondingPlayerId ?? payload.state.activePlayer;
    if (actor !== playerId) {
      return jsonWithCors({ error: "Not your turn" }, { status: 403, origin });
    }

    const legal = legalActions(payload.state);
    const action = body.action;
    if (!legal.some((a) => actionsEqual(a, action))) {
      return jsonWithCors({ error: "Illegal action" }, { status: 400, origin });
    }

    const prevVersion = payload.version;
    const nextState = applyAction(payload.state, action);
    const nextVersion = prevVersion + 1;

    const nextPayload = {
      ...payload,
      state: nextState,
      version: nextVersion,
      eventCursor: nextState.events.length,
      lastActionUserId: userId,
    };
    setPhaseDeadline(nextPayload);
    await saveMatchPayload(id, nextPayload);

    const [seqRow] = await db
      .select({ maxSeq: max(matchActions.seq) })
      .from(matchActions)
      .where(eq(matchActions.matchId, id));
    const seq = (seqRow?.maxSeq ?? 0) + 1;

    await db.insert(matchActions).values({
      matchId: id,
      seq,
      userId,
      action: action as unknown as Record<string, unknown>,
      stateVersion: nextVersion,
    });

    if (nextState.winner !== null) {
      await finishMatchAndReleasePlayers(db, id, matchRow, {
        winner: nextState.winner,
      });
    }

    const projected = projectGameStateForPlayer(nextState, playerId);
    const nextActor =
      nextState.respondingPlayerId ?? nextState.activePlayer;
    const nextLegal =
      nextActor === playerId ? legalActions(nextState) : [];

    return jsonWithCors(
      {
        version: nextVersion,
        you: projected,
        legalActions: nextLegal,
        eventsDelta: nextState.events.slice(payload.eventCursor),
        winner: nextState.winner,
        phaseDeadlineAt: nextPayload.phaseDeadlineAt,
        serverNow: Date.now(),
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
