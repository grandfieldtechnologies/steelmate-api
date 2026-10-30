import { eq, or, and, desc, max } from "drizzle-orm";
import type { PlayerAction, PlayerId } from "@steelmate/engine";
import { applyAction, legalActions } from "@steelmate/engine";
import type { getDb } from "@/db/client";
import { matchActions, matches } from "@/db/schema";
import {
  finishMatchAndReleasePlayers,
} from "@/lib/match/finish";
import {
  loadMatchPayload,
  saveMatchPayload,
  type MatchRedisPayload,
} from "@/lib/redis/match";
import { phaseDeadlineMs } from "./constants";

type Db = ReturnType<typeof getDb>;

export function setPhaseDeadline(payload: MatchRedisPayload): void {
  const player = payload.state.players[payload.state.activePlayer]!;
  payload.phaseDeadlineAt = phaseDeadlineMs(player.phase);
}

export async function persistSyntheticAction(
  db: Db,
  matchId: string,
  userId: string,
  action: PlayerAction,
  nextVersion: number,
): Promise<void> {
  const [seqRow] = await db
    .select({ maxSeq: max(matchActions.seq) })
    .from(matchActions)
    .where(eq(matchActions.matchId, matchId));
  const seq = (seqRow?.maxSeq ?? 0) + 1;
  await db.insert(matchActions).values({
    matchId,
    seq,
    userId,
    action: action as unknown as Record<string, unknown>,
    stateVersion: nextVersion,
  });
}

export type TickResult =
  | { kind: "ok"; payload: MatchRedisPayload; finished: boolean }
  | { kind: "expired_finished"; winner: PlayerId | null }
  | { kind: "missing" };

export async function tickMatch(
  db: Db,
  matchId: string,
  matchRow: typeof matches.$inferSelect,
): Promise<TickResult> {
  let payload = await loadMatchPayload(matchId);

  if (!payload) {
    if (matchRow.status !== "active") {
      return { kind: "missing" };
    }
    const winner = await finalizeExpiredMatch(db, matchId, matchRow);
    return { kind: "expired_finished", winner };
  }

  if (!payload.phaseDeadlineAt) {
    setPhaseDeadline(payload);
  }

  let safety = 12;
  while (
    safety-- > 0 &&
    payload.state.winner === null &&
    payload.phaseDeadlineAt != null &&
    Date.now() >= payload.phaseDeadlineAt
  ) {
    const player = payload.state.players[payload.state.activePlayer]!;
    const actorUserId: string =
      player.id === 0 ? matchRow.player0UserId : matchRow.player1UserId!;
    const action: PlayerAction =
      player.phase === "equip"
        ? { type: "end_equip_phase" }
        : { type: "end_turn" };

    const legal = legalActions(payload.state);
    if (!legal.some((a) => a.type === action.type)) break;

    const prevVersion: number = payload.version;
    const nextState = applyAction(payload.state, action);
    const nextVersion: number = prevVersion + 1;
    payload = {
      ...payload,
      state: nextState,
      version: nextVersion,
      eventCursor: nextState.events.length,
      lastActionUserId: actorUserId,
    };
    setPhaseDeadline(payload);
    await saveMatchPayload(matchId, payload);
    await persistSyntheticAction(db, matchId, actorUserId, action, nextVersion);

    if (nextState.winner !== null) {
      await finishMatchAndReleasePlayers(db, matchId, matchRow, {
        winner: nextState.winner,
      });
      return { kind: "ok", payload, finished: true };
    }
  }

  if (payload.state.winner !== null && matchRow.status === "active") {
    await finishMatchAndReleasePlayers(db, matchId, matchRow, {
      winner: payload.state.winner,
    });
    return { kind: "ok", payload, finished: true };
  }

  return { kind: "ok", payload, finished: false };
}

export async function finalizeExpiredMatch(
  db: Db,
  matchId: string,
  matchRow: typeof matches.$inferSelect,
): Promise<PlayerId | null> {
  const rows = await db
    .select()
    .from(matchActions)
    .where(eq(matchActions.matchId, matchId))
    .orderBy(desc(matchActions.seq))
    .limit(1);
  const last = rows[0];

  let winner: PlayerId | null = null;
  if (last) {
    if (last.userId === matchRow.player0UserId) winner = 0;
    else if (last.userId === matchRow.player1UserId) winner = 1;
  }

  await finishMatchAndReleasePlayers(db, matchId, matchRow, { winner });
  return winner;
}

export async function findActiveMatchForUser(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(matches)
    .where(
      and(
        or(
          eq(matches.player0UserId, userId),
          eq(matches.player1UserId, userId),
        ),
        or(
          eq(matches.status, "waiting"),
          eq(matches.status, "ready"),
          eq(matches.status, "active"),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export { clearActiveMatchKeys } from "@/lib/match/finish";
