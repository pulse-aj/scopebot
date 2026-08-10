import crypto from "node:crypto";
import { db, authEmailTokensTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";

export type AuthTokenKind = "verify_email" | "password_reset" | "initial_set";

const TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  verify_email: 24 * 60 * 60 * 1000, // 24h
  password_reset: 60 * 60 * 1000, // 1h
  initial_set: 14 * 24 * 60 * 60 * 1000, // 14 days (migration links)
};

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a fresh token for the given user + kind, invalidating any
 * existing un-consumed tokens of the same kind. Returns the raw token to
 * embed in the outgoing email URL — never log it.
 */
export async function issueAuthToken(
  userId: string,
  kind: AuthTokenKind,
): Promise<string> {
  // Mark all outstanding tokens of this kind as consumed so a new email
  // invalidates the older one — prevents two simultaneously valid reset
  // links.
  await db
    .update(authEmailTokensTable)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authEmailTokensTable.userId, userId),
        eq(authEmailTokensTable.kind, kind),
        isNull(authEmailTokensTable.consumedAt),
      ),
    );
  const raw = randomToken();
  const tokenHash = hashToken(raw);
  const now = new Date();
  await db.insert(authEmailTokensTable).values({
    id: crypto.randomUUID(),
    userId,
    kind,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[kind]),
  });
  return raw;
}

/**
 * Atomically consume a token. Returns the userId if the token is valid
 * (right kind, not expired, not consumed), otherwise null.
 *
 * Uses a single UPDATE … WHERE … RETURNING to make consumption
 * race-safe — two concurrent clicks on the same link, only one wins.
 */
export async function consumeAuthToken(
  rawToken: string,
  kind: AuthTokenKind,
): Promise<string | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const rows = await db
    .update(authEmailTokensTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authEmailTokensTable.tokenHash, tokenHash),
        eq(authEmailTokensTable.kind, kind),
        isNull(authEmailTokensTable.consumedAt),
        gt(authEmailTokensTable.expiresAt, now),
      ),
    )
    .returning({ userId: authEmailTokensTable.userId });
  return rows[0]?.userId ?? null;
}
