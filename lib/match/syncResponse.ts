import {
  legalActions,
  projectGameStateForPlayer,
} from "@steelmate/engine";
import type { getDb } from "@/db/client";
import type { MatchRow } from "@/lib/match/lobby";
import { buildLobbyPayload } from "@/lib/match/lobby";
import { clearActiveMatchKeys } from "@/lib/match/finish";
import { tickMatch } from "@/lib/match/tickMatch";
import { playerIdForUser } from "@/lib/redis/match";

type Db = ReturnType<typeof getDb>;

export async function buildActiveMatchResponse(
  db: Db,
  matchId: string,
  matchRow: MatchRow,
  userId: string,
  sinceVersion: string | null,
): Promise<
  | { kind: "lobby"; body: Awaited<ReturnType<typeof buildLobbyPayload>> }
  | { kind: "finished"; body: Record<string, unknown> }
  | { kind: "unchanged"; body: { unchanged: true; version: number } }
  | { kind: "active"; body: Record<string, unknown> }
  | { kind: "error"; status: number; body: Record<string, unknown> }
> {
  if (matchRow.status === "finished") {
    await clearActiveMatchKeys(matchRow);
    return {
      kind: "finished",
      body: {
        status: matchRow.status,
        winner: matchRow.winner,
        version: 0,
      },
    };
  }

  if (matchRow.status === "waiting" || matchRow.status === "ready") {
    return {
      kind: "lobby",
      body: await buildLobbyPayload(db, matchRow, userId),
    };
  }

  const tick = await tickMatch(db, matchId, matchRow);
  if (tick.kind === "expired_finished") {
    return {
      kind: "finished",
      body: {
        status: "finished",
        winner: tick.winner,
        version: 0,
      },
    };
  }
  if (tick.kind === "missing") {
    return {
      kind: "error",
      status: 503,
      body: { error: "Active state unavailable" },
    };
  }

  const payload = tick.payload;
  const playerId = playerIdForUser(payload, userId);
  if (playerId === null) {
    return { kind: "error", status: 403, body: { error: "Forbidden" } };
  }

  if (sinceVersion !== null && Number(sinceVersion) === payload.version) {
    return {
      kind: "unchanged",
      body: { unchanged: true, version: payload.version },
    };
  }

  const projected = projectGameStateForPlayer(payload.state, playerId);
  const actor =
    payload.state.respondingPlayerId ?? payload.state.activePlayer;
  const legal = actor === playerId ? legalActions(payload.state) : [];
  const eventsFrom = payload.eventCursor;
  const eventsDelta = payload.state.events.slice(eventsFrom);

  return {
    kind: "active",
    body: {
      status: matchRow.status,
      version: payload.version,
      winner: payload.state.winner,
      you: projected,
      legalActions: legal,
      eventsDelta,
      playerId,
      phaseDeadlineAt: payload.phaseDeadlineAt,
      serverNow: Date.now(),
    },
  };
}
