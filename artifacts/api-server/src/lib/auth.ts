import type { Request, Response, NextFunction } from "express";
import {
  db,
  usersTable,
  teamMembersTable,
  type User,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { loadSessionUser } from "./sessions.js";

// Bootstrap admins — seeded ONLY when the team_members table is completely
// empty (first run of a fresh DB). Once anyone has ever been added, the
// table is the sole source of truth; if these emails are removed via Team
// Settings, they stay removed across restarts.
// Configured via ADMIN_EMAILS (comma-separated list of email addresses).
const BOOTSTRAP_ADMINS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

let bootstrapPromise: Promise<void> | null = null;
async function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(teamMembersTable);
      if (count > 0) return;
      for (const email of BOOTSTRAP_ADMINS) {
        await db
          .insert(teamMembersTable)
          .values({ email: email.toLowerCase(), role: "admin" })
          .onConflictDoNothing();
      }
    })().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  await bootstrapPromise;
}

export async function getRolesForEmail(
  email: string | null | undefined,
): Promise<{ isAdmin: boolean; isEngineer: boolean }> {
  if (!email) return { isAdmin: false, isEngineer: false };
  const rows = await db
    .select({ role: teamMembersTable.role })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.email, email.toLowerCase()));
  return {
    isAdmin: rows.some((r) => r.role === "admin"),
    isEngineer: rows.some((r) => r.role === "engineer"),
  };
}

/**
 * Re-sync isAdmin/isEngineer flags on every user whose email matches one of
 * the given (lowercased) emails. Called after team_members CRUD so role
 * changes take effect on the next request without waiting for re-login.
 */
export async function resyncRolesForEmails(emails: string[]): Promise<void> {
  const lowered = Array.from(
    new Set(emails.map((e) => e.toLowerCase()).filter(Boolean)),
  );
  if (lowered.length === 0) return;
  const users = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.email, lowered));
  for (const u of users) {
    const { isAdmin, isEngineer } = await getRolesForEmail(u.email);
    if (u.isAdmin !== isAdmin || u.isEngineer !== isEngineer) {
      await db
        .update(usersTable)
        .set({ isAdmin, isEngineer })
        .where(eq(usersTable.id, u.id));
    }
  }
}

/**
 * Re-sync admin/engineer flags for a single user against team_members.
 * Called on every authenticated request so role changes propagate even
 * when an email isn't part of an explicit resync call (e.g. bootstrap
 * admins on first login).
 */
async function syncRolesForUser(u: User): Promise<User> {
  const { isAdmin, isEngineer } = await getRolesForEmail(u.email);
  if (u.isAdmin === isAdmin && u.isEngineer === isEngineer) return u;
  const [updated] = await db
    .update(usersTable)
    .set({ isAdmin, isEngineer })
    .where(eq(usersTable.id, u.id))
    .returning();
  return updated ?? u;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await ensureBootstrap();
    const user = await loadSessionUser(req, res);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = await syncRolesForUser(user);
    next();
  } catch (err) {
    req.log?.error({ err }, "Failed to authenticate request");
    res.status(500).json({ error: "Failed to load user" });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// Staff = anyone with an admin or engineer role. Gates the
// admin to-do list, which engineers (who don't see the Admin dashboard) can
// still view and comment on.
export function requireStaff(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user?.isAdmin && !req.user?.isEngineer) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
