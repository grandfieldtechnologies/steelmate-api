import { eq, and, isNull } from "drizzle-orm";
import { createGame } from "@steelmate/engine";
import type { getDb } from "@/db/client";
import { decks, matches, users } from "@/db/schema";
import { getServerCatalog, requireCatalogVersion } from "@/lib/catalog";
import { setUserActiveMatch } from "@/lib/redis/activeMatch";
import { saveMatchPayload } from "@/lib/redis/match";
import { finishMatchAndReleasePlayers } from "@/lib/match/finish";
import { setPhaseDeadline } from "@/lib/match/tickMatch";

type Db = ReturnType<typeof getDb>;
export type MatchRow = typeof matches.$inferSelect;

export type LobbyPayload = {
  status: "waiting" | "ready";
  version: 0;
  inviteCode: string;
  matchmaking: boolean;
  player0Ready: boolean;
  player1Ready: boolean;
  you: { seat: 0 | 1; ready: boolean };
  opponent: { displayName: string } | null;
  canCancel: boolean;
  serverNow: number;
};

export async function displayNameForUser(
  db: Db,
  clerkId: string,
): Promise<string> {
  const [row] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return row?.displayName ?? "Player";
}

export async function buildLobbyPayload(
  db: Db,
  matchRow: MatchRow,
  userId: string,
): Promise<LobbyPayload> {
  const seat: 0 | 1 =
    matchRow.player0UserId === userId
      ? 0
      : matchRow.player1UserId === userId
        ? 1
        : 0;
  const ready = seat === 0 ? matchRow.player0Ready : matchRow.player1Ready;
  const opponentId =
    seat === 0 ? matchRow.player1UserId : matchRow.player0UserId;
  const opponent =
    opponentId != null
      ? { displayName: await displayNameForUser(db, opponentId) }
      : null;
  const canCancel =
    matchRow.status === "waiting" &&
    matchRow.player1UserId == null &&
    matchRow.player0UserId === userId;

  return {
    status: matchRow.status as "waiting" | "ready",
    version: 0,
    inviteCode: matchRow.inviteCode,
    matchmaking: matchRow.matchmaking,
    player0Ready: matchRow.player0Ready,
    player1Ready: matchRow.player1Ready,
    you: { seat, ready },
    opponent,
    canCancel,
    serverNow: Date.now(),
  };
}

async function loadOwnedDeck(
  db: Db,
  deckId: string,
  userId: string,
  catalogVersion: string,
): Promise<
  | { ok: true; deck: typeof decks.$inferSelect }
  | { ok: false; error: string; status: number }
> {
  const [deck] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!deck) return { ok: false, error: "Deck not found", status: 404 };
  if (deck.catalogVersion !== catalogVersion) {
    return {
      ok: false,
      error: "Deck catalog version outdated; re-save deck",
      status: 400,
    };
  }
  return { ok: true, deck };
}

export async function pairGuestOnMatch(
  db: Db,
  matchRow: MatchRow,
  guestUserId: string,
  guestDeckId: string,
): Promise<
  | { ok: true; match: MatchRow }
  | { ok: false; error: string; status: number }
> {
  if (matchRow.status !== "waiting") {
    return { ok: false, error: "Invite not found or already started", status: 404 };
  }
  if (matchRow.player1UserId != null) {
    return { ok: false, error: "Match is full", status: 409 };
  }
  if (matchRow.player0UserId === guestUserId) {
    return { ok: false, error: "Cannot join your own match", status: 400 };
  }

  const catalogVersion = requireCatalogVersion();
  const guestDeck = await loadOwnedDeck(db, guestDeckId, guestUserId, catalogVersion);
  if (!guestDeck.ok) {
    return { ok: false, error: guestDeck.error, status: guestDeck.status };
  }

  const [updated] = await db
    .update(matches)
    .set({
      status: "ready",
      player1UserId: guestUserId,
      deck1Id: guestDeck.deck.id,
      player0Ready: false,
      player1Ready: false,
    })
    .where(
      and(
        eq(matches.id, matchRow.id),
        eq(matches.status, "waiting"),
        isNull(matches.player1UserId),
      ),
    )
    .returning();

  if (!updated) {
    return { ok: false, error: "Match no longer available", status: 409 };
  }

  await setUserActiveMatch(guestUserId, updated.id);
  await setUserActiveMatch(updated.player0UserId, updated.id);

  return { ok: true, match: updated };
}

export async function startMatchIfReady(
  db: Db,
  matchRow: MatchRow,
): Promise<
  | { ok: true; match: MatchRow; started: boolean }
  | { ok: false; error: string; status: number }
> {
  if (matchRow.status !== "ready") {
    return { ok: false, error: "Match is not in ready state", status: 400 };
  }
  if (matchRow.player1UserId == null || matchRow.deck1Id == null) {
    return { ok: false, error: "Opponent not joined", status: 400 };
  }
  if (!matchRow.player0Ready || !matchRow.player1Ready) {
    return { ok: true, match: matchRow, started: false };
  }

  const catalogVersion = requireCatalogVersion();
  const [deck0] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, matchRow.deck0Id))
    .limit(1);
  const [deck1] = await db
    .select()
    .from(decks)
    .where(eq(decks.id, matchRow.deck1Id))
    .limit(1);
  if (!deck0 || !deck1) {
    return { ok: false, error: "Deck missing", status: 500 };
  }

  const hostName = await displayNameForUser(db, matchRow.player0UserId);
  const guestName = await displayNameForUser(db, matchRow.player1UserId);

  const { cardMap, equipmentTypes } = getServerCatalog();
  const state = createGame({
    decks: [deck0.cardIds, deck1.cardIds],
    defaultEquippedBySlot: [
      deck0.defaultEquippedBySlot ?? {},
      deck1.defaultEquippedBySlot ?? {},
    ],
    cards: cardMap,
    equipmentTypes,
    seed: matchRow.seed,
    mode: "hotseat",
    names: [hostName, guestName],
  });

  const payload = {
    state,
    version: 1,
    playerRoles: {
      0: matchRow.player0UserId,
      1: matchRow.player1UserId,
    } as { 0: string; 1: string },
    eventCursor: state.events.length,
  };
  setPhaseDeadline(payload);
  await saveMatchPayload(matchRow.id, payload);

  const [updated] = await db
    .update(matches)
    .set({ status: "active" })
    .where(and(eq(matches.id, matchRow.id), eq(matches.status, "ready")))
    .returning();

  if (!updated) {
    return { ok: false, error: "Match already started", status: 409 };
  }

  return { ok: true, match: updated, started: true };
}

export async function cancelWaitingMatch(
  db: Db,
  matchRow: MatchRow,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (matchRow.player0UserId !== userId) {
    return { ok: false, error: "Only the host can cancel", status: 403 };
  }
  if (matchRow.status !== "waiting" || matchRow.player1UserId != null) {
    return {
      ok: false,
      error: "Match cannot be cancelled",
      status: 400,
    };
  }

  await finishMatchAndReleasePlayers(db, matchRow.id, matchRow);

  return { ok: true };
}

export async function markPlayerReady(
  db: Db,
  matchRow: MatchRow,
  userId: string,
): Promise<
  | { ok: true; match: MatchRow }
  | { ok: false; error: string; status: number }
> {
  if (matchRow.status !== "ready") {
    return { ok: false, error: "Match is not ready", status: 400 };
  }

  const patch =
    matchRow.player0UserId === userId
      ? { player0Ready: true }
      : matchRow.player1UserId === userId
        ? { player1Ready: true }
        : null;

  if (!patch) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const [updated] = await db
    .update(matches)
    .set(patch)
    .where(eq(matches.id, matchRow.id))
    .returning();

  if (!updated) {
    return { ok: false, error: "Not found", status: 404 };
  }

  return { ok: true, match: updated };
}
