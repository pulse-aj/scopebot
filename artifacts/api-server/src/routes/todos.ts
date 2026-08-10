import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  customerCompaniesTable,
  todoTasksTable,
  todoTaskCommentsTable,
  type TodoTask,
  type TodoTaskComment,
  type CustomerCompany,
  type User,
} from "@workspace/db";
import { requireAuth, requireStaff } from "../lib/auth";

const router: IRouter = Router();

const TODO_STATUSES = ["todo", "in_progress", "done"] as const;
type TodoStatus = (typeof TODO_STATUSES)[number];

function isTodoStatus(v: unknown): v is TodoStatus {
  return typeof v === "string" && (TODO_STATUSES as readonly string[]).includes(v);
}

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

// Normalizes an optional, nullable text field for PATCH bodies: `undefined`
// when the key is absent (leave unchanged), `null` when explicitly cleared,
// or the trimmed string otherwise.
function patchStr(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) return undefined;
  const v = body[key];
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type UserMap = Map<string, User>;

async function userMap(ids: (string | null | undefined)[]): Promise<UserMap> {
  const uniq = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (uniq.length === 0) return new Map();
  const rows = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, uniq));
  return new Map(rows.map((u) => [u.id, u]));
}

type CompanyMap = Map<number, CustomerCompany>;

async function companyMap(ids: (number | null | undefined)[]): Promise<CompanyMap> {
  const uniq = Array.from(
    new Set(ids.filter((v): v is number => typeof v === "number")),
  );
  if (uniq.length === 0) return new Map();
  const rows = await db
    .select()
    .from(customerCompaniesTable)
    .where(inArray(customerCompaniesTable.id, uniq));
  return new Map(rows.map((c) => [c.id, c]));
}

function displayName(u: User | undefined): string | null {
  if (!u) return null;
  return u.name || u.email || null;
}

function serializeTask(
  t: TodoTask,
  opts: { assignee?: User; customer?: CustomerCompany; commentCount?: number },
): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    details: t.details,
    status: t.status,
    customerId: t.customerId,
    customerName: opts.customer?.name ?? null,
    assigneeUserId: t.assigneeUserId,
    assigneeName: displayName(opts.assignee),
    assigneeEmail: opts.assignee?.email ?? null,
    createdByUserId: t.createdByUserId,
    commentCount: opts.commentCount ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function serializeComment(
  c: TodoTaskComment,
  author?: User,
): Record<string, unknown> {
  return {
    id: c.id,
    taskId: c.taskId,
    body: c.body,
    authorUserId: c.authorUserId,
    authorName: displayName(author),
    authorEmail: author?.email ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function loadTaskOr404(
  id: number,
  res: Response,
): Promise<TodoTask | null> {
  const [t] = await db
    .select()
    .from(todoTasksTable)
    .where(eq(todoTasksTable.id, id))
    .limit(1);
  if (!t) {
    res.status(404).json({ error: "Task not found" });
    return null;
  }
  return t;
}

// ────────────────────────────────────────────────────────────────────────────
// Customers (reused from the CRM `customer_companies` entity)
// ────────────────────────────────────────────────────────────────────────────

// List selectable customers for the task pickers.
router.get("/todos/customers", requireAuth, requireStaff, async (_req, res) => {
  const rows = await db
    .select({
      id: customerCompaniesTable.id,
      name: customerCompaniesTable.name,
    })
    .from(customerCompaniesTable)
    .orderBy(asc(customerCompaniesTable.name));
  res.json(rows);
});

// Create a customer by name (deduped case-insensitively). Admin-only.
router.post("/todos/customers", requireAuth, requireStaff, async (req, res) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const name = cleanStr((req.body ?? {}).name);
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [existing] = await db
    .select()
    .from(customerCompaniesTable)
    .where(sql`lower(${customerCompaniesTable.name}) = ${name.toLowerCase()}`)
    .limit(1);
  if (existing) {
    res.json({ id: existing.id, name: existing.name });
    return;
  }
  const [created] = await db
    .insert(customerCompaniesTable)
    .values({ name, createdByUserId: req.user!.id })
    .returning();
  res.status(201).json({ id: created.id, name: created.name });
});

// Raised by resolveCustomerId when the caller supplied a malformed or unknown
// customerId. Callers translate this into a 400 instead of silently dropping
// the customer association.
class InvalidCustomerError extends Error {}

// Resolve a customer for a task body: prefer an explicit customerId, else
// create/find one from a free-text customerName. Returns the company id or
// null (no customer). Throws InvalidCustomerError on a malformed/unknown
// customerId so the caller can return 400 rather than nulling the field.
async function resolveCustomerId(
  body: Record<string, unknown>,
  createdByUserId: string,
): Promise<number | null> {
  const cid = body.customerId;
  if (cid != null && cid !== "") {
    const id = parseId(cid);
    if (id == null) throw new InvalidCustomerError("invalid customerId");
    const [c] = await db
      .select({ id: customerCompaniesTable.id })
      .from(customerCompaniesTable)
      .where(eq(customerCompaniesTable.id, id))
      .limit(1);
    if (!c) throw new InvalidCustomerError("unknown customerId");
    return c.id;
  }
  const name = cleanStr(body.customerName);
  if (!name) return null;
  const [existing] = await db
    .select({ id: customerCompaniesTable.id })
    .from(customerCompaniesTable)
    .where(sql`lower(${customerCompaniesTable.name}) = ${name.toLowerCase()}`)
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(customerCompaniesTable)
    .values({ name, createdByUserId })
    .returning({ id: customerCompaniesTable.id });
  return created.id;
}

// ────────────────────────────────────────────────────────────────────────────
// Assignees (staff: admins + engineers)
// ────────────────────────────────────────────────────────────────────────────

router.get("/todos/assignees", requireAuth, requireStaff, async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(or(eq(usersTable.isAdmin, true), eq(usersTable.isEngineer, true)))
    .orderBy(asc(usersTable.name), asc(usersTable.email));
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name || r.email,
      email: r.email,
    })),
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Tasks
// ────────────────────────────────────────────────────────────────────────────

// List every task (staff see all). `?mine=true` limits to the caller's tasks.
router.get("/todos", requireAuth, requireStaff, async (req, res) => {
  const mine = req.query.mine === "true" || req.query.mine === "1";
  const where = mine
    ? eq(todoTasksTable.assigneeUserId, req.user!.id)
    : undefined;
  const tasks = await db
    .select()
    .from(todoTasksTable)
    .where(where)
    .orderBy(desc(todoTasksTable.updatedAt));

  const users = await userMap(
    tasks.flatMap((t) => [t.assigneeUserId, t.createdByUserId]),
  );
  const companies = await companyMap(tasks.map((t) => t.customerId));

  const counts = new Map<number, number>();
  if (tasks.length > 0) {
    const rows = await db
      .select({
        taskId: todoTaskCommentsTable.taskId,
        count: sql<number>`count(*)::int`,
      })
      .from(todoTaskCommentsTable)
      .where(
        inArray(
          todoTaskCommentsTable.taskId,
          tasks.map((t) => t.id),
        ),
      )
      .groupBy(todoTaskCommentsTable.taskId);
    for (const r of rows) counts.set(r.taskId, r.count);
  }

  res.json(
    tasks.map((t) =>
      serializeTask(t, {
        assignee: t.assigneeUserId
          ? users.get(t.assigneeUserId)
          : undefined,
        customer:
          t.customerId != null ? companies.get(t.customerId) : undefined,
        commentCount: counts.get(t.id) ?? 0,
      }),
    ),
  );
});

// Create a task. Admin-only.
router.post("/todos", requireAuth, requireStaff, async (req, res) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = cleanStr(body.title);
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const status = body.status === undefined ? "todo" : body.status;
  if (!isTodoStatus(status)) {
    res.status(400).json({ error: "invalid status" });
    return;
  }

  let assigneeUserId: string | null = null;
  const rawAssignee = cleanStr(body.assigneeUserId);
  if (rawAssignee) {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, rawAssignee))
      .limit(1);
    if (!u || (!u.isAdmin && !u.isEngineer)) {
      res.status(400).json({ error: "assignee must be a staff member" });
      return;
    }
    assigneeUserId = u.id;
  }

  let customerId: number | null;
  try {
    customerId = await resolveCustomerId(body, req.user!.id);
  } catch (e) {
    if (e instanceof InvalidCustomerError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
  const details = cleanStr(body.details) ?? null;

  const [created] = await db
    .insert(todoTasksTable)
    .values({
      title,
      details,
      status,
      customerId,
      assigneeUserId,
      createdByUserId: req.user!.id,
    })
    .returning();

  const users = await userMap([created.assigneeUserId, created.createdByUserId]);
  const companies = await companyMap([created.customerId]);
  res.status(201).json(
    serializeTask(created, {
      assignee: created.assigneeUserId
        ? users.get(created.assigneeUserId)
        : undefined,
      customer:
        created.customerId != null
          ? companies.get(created.customerId)
          : undefined,
      commentCount: 0,
    }),
  );
});

// Update a task. Admins may edit any field; non-admin staff may only change
// the status (so assignees can move their work along the board).
router.patch("/todos/:id", requireAuth, requireStaff, async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const task = await loadTaskOr404(id, res);
  if (!task) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const isAdmin = req.user!.isAdmin;

  const updates: Partial<typeof todoTasksTable.$inferInsert> = {};

  if ("status" in body) {
    if (!isTodoStatus(body.status)) {
      res.status(400).json({ error: "invalid status" });
      return;
    }
    updates.status = body.status;
  }

  if (!isAdmin) {
    // Non-admin staff can only move status.
    const otherKeys = Object.keys(body).filter((k) => k !== "status");
    if (otherKeys.length > 0) {
      res.status(403).json({ error: "Only admins can edit task details" });
      return;
    }
  } else {
    if ("title" in body) {
      const title = cleanStr(body.title);
      if (!title) {
        res.status(400).json({ error: "title cannot be empty" });
        return;
      }
      updates.title = title;
    }
    const details = patchStr(body, "details");
    if (details !== undefined) updates.details = details;

    if ("assigneeUserId" in body) {
      const raw = cleanStr(body.assigneeUserId);
      if (!raw) {
        updates.assigneeUserId = null;
      } else {
        const [u] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, raw))
          .limit(1);
        if (!u || (!u.isAdmin && !u.isEngineer)) {
          res.status(400).json({ error: "assignee must be a staff member" });
          return;
        }
        updates.assigneeUserId = u.id;
      }
    }

    if ("customerId" in body || "customerName" in body) {
      try {
        updates.customerId = await resolveCustomerId(body, req.user!.id);
      } catch (e) {
        if (e instanceof InvalidCustomerError) {
          res.status(400).json({ error: e.message });
          return;
        }
        throw e;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "no updatable fields provided" });
    return;
  }
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(todoTasksTable)
    .set(updates)
    .where(eq(todoTasksTable.id, id))
    .returning();

  const users = await userMap([updated.assigneeUserId, updated.createdByUserId]);
  const companies = await companyMap([updated.customerId]);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(todoTaskCommentsTable)
    .where(eq(todoTaskCommentsTable.taskId, id));
  res.json(
    serializeTask(updated, {
      assignee: updated.assigneeUserId
        ? users.get(updated.assigneeUserId)
        : undefined,
      customer:
        updated.customerId != null
          ? companies.get(updated.customerId)
          : undefined,
      commentCount: count,
    }),
  );
});

// Delete a task. Admin-only.
router.delete("/todos/:id", requireAuth, requireStaff, async (req, res) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const task = await loadTaskOr404(id, res);
  if (!task) return;
  await db.delete(todoTasksTable).where(eq(todoTasksTable.id, id));
  res.status(204).end();
});

// ────────────────────────────────────────────────────────────────────────────
// Comments
// ────────────────────────────────────────────────────────────────────────────

router.get(
  "/todos/:id/comments",
  requireAuth,
  requireStaff,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const task = await loadTaskOr404(id, res);
    if (!task) return;
    const comments = await db
      .select()
      .from(todoTaskCommentsTable)
      .where(eq(todoTaskCommentsTable.taskId, id))
      .orderBy(asc(todoTaskCommentsTable.createdAt));
    const users = await userMap(comments.map((c) => c.authorUserId));
    res.json(
      comments.map((c) =>
        serializeComment(
          c,
          c.authorUserId ? users.get(c.authorUserId) : undefined,
        ),
      ),
    );
  },
);

router.post(
  "/todos/:id/comments",
  requireAuth,
  requireStaff,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const task = await loadTaskOr404(id, res);
    if (!task) return;
    const body = cleanStr((req.body ?? {}).body);
    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const [created] = await db
      .insert(todoTaskCommentsTable)
      .values({ taskId: id, authorUserId: req.user!.id, body })
      .returning();
    res.status(201).json(serializeComment(created, req.user!));
  },
);

export default router;
