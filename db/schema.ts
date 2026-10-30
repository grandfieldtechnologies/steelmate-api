import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import type { DefaultEquippedBySlot } from "@steelmate/engine";

export const users = pgTable("users", {
  clerkId: text("clerk_id").primaryKey(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const decks = pgTable("decks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.clerkId),
  name: text("name").notNull(),
  cardIds: jsonb("card_ids").$type<string[]>().notNull(),
  defaultEquippedBySlot: jsonb("default_equipped_by_slot")
    .$type<DefaultEquippedBySlot>()
    .notNull()
    .default({}),
  catalogVersion: text("catalog_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type MatchStatus = "waiting" | "ready" | "active" | "finished";

export const matches = pgTable("matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteCode: text("invite_code").notNull().unique(),
  status: text("status").$type<MatchStatus>().notNull(),
  matchmaking: boolean("matchmaking").notNull().default(false),
  catalogVersion: text("catalog_version").notNull(),
  seed: integer("seed").notNull(),
  player0UserId: text("player0_user_id")
    .notNull()
    .references(() => users.clerkId),
  player1UserId: text("player1_user_id").references(() => users.clerkId),
  deck0Id: uuid("deck0_id")
    .notNull()
    .references(() => decks.id),
  deck1Id: uuid("deck1_id").references(() => decks.id),
  player0Ready: boolean("player0_ready").notNull().default(false),
  player1Ready: boolean("player1_ready").notNull().default(false),
  winner: integer("winner").$type<0 | 1 | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const matchActions = pgTable("match_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id),
  seq: integer("seq").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.clerkId),
  action: jsonb("action").$type<Record<string, unknown>>().notNull(),
  stateVersion: integer("state_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
