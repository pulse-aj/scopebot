import crypto from "node:crypto";
import type { Request, Response } from "express";
import { db, authSessionsTable, usersTable, type User } from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

export const SESSION_COOKIE = "pulse_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_SLIDE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh once per day

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function clientIp(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || null;
}

function userAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  if (!ua) return null;
  return String(ua).slice(0, 500);
}

function cookieOpts(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

export async function createSession(
  userId: string,
  req: Request,
  res: Response,
): Promise<void> {
  const raw = randomToken();
  const tokenHash = hashToken(raw);
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(authSessionsTable).values({
    id,
    userId,
    tokenHash,
    userAgent: userAgent(req),
    ip: clientIp(req),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  res.cookie(SESSION_COOKIE, raw, cookieOpts());
}

export async function destroySessionByToken(
  rawToken: string | undefined,
): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await db
    .update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(authSessionsTable.tokenHash, tokenHash));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...cookieOpts(), maxAge: undefined });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessionsTable.userId, userId),
        isNull(authSessionsTable.revokedAt),
      ),
    );
}

/**
 * Looks up an active session by its raw cookie token, slides the
 * expiry / lastSeenAt forward when needed, and returns the owning user.
 * Returns null if no session, expired, or revoked.
 */
export async function loadSessionUser(
  req: Request,
  res: Response,
): Promise<User | null> {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    SESSION_COOKIE
  ];
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const now = new Date();
  const rows = await db
    .select({
      session: authSessionsTable,
      user: usersTable,
    })
    .from(authSessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, authSessionsTable.userId))
    .where(
      and(
        eq(authSessionsTable.tokenHash, tokenHash),
        isNull(authSessionsTable.revokedAt),
        gt(authSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Slide the session forward at most once per day to avoid hammering
  // the DB on every request.
  const lastSeen = row.session.lastSeenAt.getTime();
  if (now.getTime() - lastSeen > SESSION_SLIDE_THRESHOLD_MS) {
    const newExpiry = new Date(now.getTime() + SESSION_TTL_MS);
    await db
      .update(authSessionsTable)
      .set({ lastSeenAt: now, expiresAt: newExpiry })
      .where(eq(authSessionsTable.id, row.session.id));
    // Refresh the cookie's maxAge too so the browser keeps it.
    res.cookie(SESSION_COOKIE, raw, cookieOpts());
  }

  return row.user;
}

/**
 * Best-effort cleanup of expired sessions — call occasionally from a
 * scheduler. Not required for correctness; the WHERE clause above
 * already ignores expired rows.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await db
    .delete(authSessionsTable)
    .where(sql`expires_at < now() - interval '7 days'`);
  // drizzle-orm rowCount is driver-dependent; we don't strictly need it.
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
