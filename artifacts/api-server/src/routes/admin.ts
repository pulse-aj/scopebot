import { Router, type IRouter } from "express";
import { desc, eq, sql, inArray } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  conversationsTable,
  messagesTable,
  usersTable,
  type User,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { serializeFeatureRequest, loadFullConversation } from "./conversations";
import { getUserEmail, notifyOwnerOfAdminQuestion } from "../lib/email";
import { loadCurrentPrioritization } from "../lib/prioritizer";
import {
  getNextScheduledRun,
  isPrioritizationRunning,
  triggerPrioritizationInBackground,
} from "../lib/scheduler";

const router: IRouter = Router();

async function withUsers(
  rows: (typeof featureRequestsTable.$inferSelect)[],
) {
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const users =
    userIds.length === 0
      ? []
      : await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
  const byId = new Map<string, User>(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const u = byId.get(r.userId);
    return serializeFeatureRequest(r, u?.email ?? "", u?.name ?? null, true);
  });
}

router.get(
  "/admin/feature-requests",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const rows = await db
      .select()
      .from(featureRequestsTable)
      .orderBy(desc(featureRequestsTable.createdAt));
    res.json(await withUsers(rows));
  },
);

router.get("/admin/stats", requireAuth, requireAdmin, async (_req, res) => {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(featureRequestsTable);

  const byStatusRows = await db
    .select({
      status: featureRequestsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(featureRequestsTable)
    .groupBy(featureRequestsTable.status);

  const byPriorityRows = await db
    .select({
      priority: featureRequestsTable.priority,
      count: sql<number>`count(*)::int`,
    })
    .from(featureRequestsTable)
    .groupBy(featureRequestsTable.priority);

  const recent = await db
    .select()
    .from(featureRequestsTable)
    .orderBy(desc(featureRequestsTable.createdAt))
    .limit(8);

  res.json({
    total: total ?? 0,
    byStatus: byStatusRows.map((r) => ({ status: r.status, count: r.count })),
    byPriority: byPriorityRows.map((r) => ({
      priority: r.priority,
      count: r.count,
    })),
    recentlyCreated: await withUsers(recent),
  });
});

router.get(
  "/admin/conversations/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const full = await loadFullConversation(id);
    if (!full) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(full);
  },
);

router.post(
  "/admin/conversations/:id/messages",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const content =
      typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content) {
      res.status(400).json({ error: "content required" });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await db.insert(messagesTable).values({
      conversationId: id,
      role: "admin",
      content,
      authorUserId: req.user!.id,
    });

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, id));

    req.log?.info(
      { conversationId: id, adminId: req.user!.id, ownerId: conv.userId },
      "Admin posted clarifying question",
    );

    // Email the request owner so they know to come reply.
    try {
      const owner = await getUserEmail(conv.userId);
      if (owner?.email && owner.email.toLowerCase() !== req.user!.email.toLowerCase()) {
        await notifyOwnerOfAdminQuestion({
          ownerEmail: owner.email,
          ownerName: owner.name,
          adminName: req.user!.name,
          adminEmail: req.user!.email,
          conversationId: id,
          conversationTitle: conv.title,
          question: content,
        });
      }
    } catch (err) {
      req.log?.warn({ err }, "Failed to send admin-question email");
    }

    const full = await loadFullConversation(id);
    res.json(full);
  },
);

router.get(
  "/admin/ai-prioritization",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const snapshot = await loadCurrentPrioritization(
      getNextScheduledRun(),
      isPrioritizationRunning(),
    );
    res.json(snapshot);
  },
);

// Kick off a refresh in the background and return immediately. The UI is
// expected to poll the GET endpoint until `isRunning` flips back to false
// and `generatedAt` advances — blocking the HTTP request on the Anthropic
// call risks exceeding proxy/client timeouts on large backlogs.
router.post(
  "/admin/ai-prioritization/refresh",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const result = triggerPrioritizationInBackground();
    const snapshot = await loadCurrentPrioritization(
      getNextScheduledRun(),
      isPrioritizationRunning(),
    );
    if (result === "busy") {
      res.status(409).json(snapshot);
      return;
    }
    req.log?.info(
      { adminId: req.user!.id },
      "Admin manually triggered AI prioritization",
    );
    res.status(202).json(snapshot);
  },
);

export default router;
