import { Router, type IRouter } from "express";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  teamMembersTable,
  usersTable,
  type TeamMember,
} from "@workspace/db";
import {
  requireAuth,
  requireAdmin,
  resyncRolesForEmails,
} from "../lib/auth";

const router: IRouter = Router();

type Role = TeamMember["role"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function serialize(row: TeamMember) {
  let addedByName: string | null = null;
  let addedByEmail: string | null = null;
  if (row.addedByUserId) {
    const [u] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, row.addedByUserId))
      .limit(1);
    addedByName = u?.name ?? null;
    addedByEmail = u?.email ?? null;
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    note: row.note,
    addedByName,
    addedByEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/admin/team-members",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const rows = await db
      .select()
      .from(teamMembersTable)
      .orderBy(desc(teamMembersTable.role), asc(teamMembersTable.email));
    res.json(await Promise.all(rows.map(serialize)));
  },
);

router.post(
  "/admin/team-members",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const role = req.body?.role as Role | undefined;
    const note =
      typeof req.body?.note === "string" ? req.body.note.trim() || null : null;

    if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }
    if (role !== "admin" && role !== "engineer") {
      res.status(400).json({ error: "Role must be 'admin' or 'engineer'" });
      return;
    }
    const email = rawEmail.toLowerCase();

    // Race-safe insert: rely on the (email, role) unique index. If a parallel
    // request adds the same entry, onConflictDoNothing returns no rows and we
    // surface a clean 409 to the caller.
    const insertResult = await db
      .insert(teamMembersTable)
      .values({
        email,
        role,
        note,
        addedByUserId: req.user!.id,
      })
      .onConflictDoNothing({
        target: [teamMembersTable.email, teamMembersTable.role],
      })
      .returning();
    if (insertResult.length === 0) {
      res.status(409).json({ error: "That email already has this role" });
      return;
    }
    const [created] = insertResult;

    await resyncRolesForEmails([email]);

    req.log?.info(
      { email, role, addedBy: req.user!.id },
      "Team member added",
    );
    res.json(await serialize(created!));
  },
);

router.delete(
  "/admin/team-members/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [row] = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Atomic delete with race-safe "last admin" guard.
    // For an admin row, only delete if at least one OTHER admin exists.
    // For a non-admin row, delete unconditionally.
    let deleted: { id: number }[];
    if (row.role === "admin") {
      deleted = await db
        .delete(teamMembersTable)
        .where(
          sql`${teamMembersTable.id} = ${id} AND (
            SELECT COUNT(*)::int FROM ${teamMembersTable}
            WHERE role = 'admin' AND id <> ${id}
          ) >= 1`,
        )
        .returning({ id: teamMembersTable.id });
      if (deleted.length === 0) {
        res
          .status(400)
          .json({ error: "Cannot remove the last admin — add another first." });
        return;
      }
    } else {
      deleted = await db
        .delete(teamMembersTable)
        .where(eq(teamMembersTable.id, id))
        .returning({ id: teamMembersTable.id });
      if (deleted.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
    }

    await resyncRolesForEmails([row.email]);

    req.log?.info(
      { id, email: row.email, role: row.role, removedBy: req.user!.id },
      "Team member removed",
    );
    res.status(204).end();
  },
);

export default router;
