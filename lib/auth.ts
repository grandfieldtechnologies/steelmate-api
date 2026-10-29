import { verifyToken } from "@clerk/backend";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";

function authorizedParties(): string[] | undefined {
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : undefined;
}

async function userIdFromBearerToken(): Promise<string | null> {
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  const parties = authorizedParties();
  try {
    const payload = await verifyToken(token, {
      secretKey,
      ...(parties ? { authorizedParties: parties } : {}),
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function requireAuthUserId(): Promise<string> {
  const userId = await userIdFromBearerToken();
  if (!userId) throw new AuthError("Unauthorized", 401);
  await ensureUserRow(userId);
  return userId;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function ensureUserRow(clerkId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (rows.length > 0) return;

  let displayName: string | null = null;
  try {
    const user = await currentUser();
    displayName =
      user?.fullName ??
      user?.username ??
      user?.primaryEmailAddress?.emailAddress ??
      null;
  } catch {
    /* cross-origin API — no Clerk session on this host */
  }

  await db.insert(users).values({ clerkId, displayName }).onConflictDoNothing();
}
