import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, ne, or } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  paperclipAgentsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import {
  clearPaperclipPushAttempt,
  getPaperclipSchedulerStatus,
  pushSingleFeatureRequest,
  triggerPaperclipRefreshInBackground,
} from "../lib/paperclip-scheduler";
import {
  clearNotionPushAttempt,
  getNotionSchedulerStatus,
  pushSingleToNotion,
  triggerNotionRefreshInBackground,
} from "../lib/notion-scheduler";

const router: IRouter = Router();

// GET /admin/engineering-space
// Single aggregated payload the admin Engineering Space page needs:
//   - schedulerStatus: configured?, last push/poll times, last errors
//   - agents: cached Paperclip agent roster (for id → name lookup)
//   - requests: every feature_request that's been pushed to Paperclip,
//     newest-pushed first, with its child task snapshot inlined.
router.get(
  "/admin/engineering-space",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    // Include both rows that landed in Paperclip AND planned rows whose
    // most recent push attempt failed — otherwise push failures are
    // invisible in the UI (no paperclipIssueId yet).
    const [rows, agents] = await Promise.all([
      db
        .select()
        .from(featureRequestsTable)
        .where(
          and(
            // Once a request is deployed it's off the engineers' plate — drop
            // it from Engineering Space even though it still carries its
            // Paperclip issue / Notion page id.
            ne(featureRequestsTable.status, "deployed"),
            or(
              // Agent-routed rows that reached Paperclip…
              isNotNull(featureRequestsTable.paperclipIssueId),
              // …or planned agent rows whose push failed (no issueId yet)…
              and(
                eq(featureRequestsTable.status, "planned"),
                isNotNull(featureRequestsTable.paperclipPushError),
              ),
              // …or human-routed rows that reached Notion…
              isNotNull(featureRequestsTable.notionPageId),
              // …or planned human rows whose Notion push failed.
              and(
                eq(featureRequestsTable.status, "planned"),
                isNotNull(featureRequestsTable.notionPushError),
              ),
            ),
          ),
        )
        .orderBy(desc(featureRequestsTable.paperclipPushedAt)),
      db.select().from(paperclipAgentsTable),
    ]);

    res.json({
      schedulerStatus: getPaperclipSchedulerStatus(),
      notionSchedulerStatus: getNotionSchedulerStatus(),
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        title: a.title,
        icon: a.icon,
        status: a.status,
      })),
      requests: rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        status: r.status,
        priority: r.priority,
        adminPriorityRank: r.adminPriorityRank,
        engineeringOwner: r.engineeringOwner,
        paperclipIssueId: r.paperclipIssueId,
        paperclipIdentifier: r.paperclipIdentifier,
        paperclipStatus: r.paperclipStatus,
        paperclipPriority: r.paperclipPriority,
        paperclipAssigneeAgentId: r.paperclipAssigneeAgentId,
        paperclipPushedAt: r.paperclipPushedAt?.toISOString() ?? null,
        paperclipLastSyncedAt: r.paperclipLastSyncedAt?.toISOString() ?? null,
        paperclipPushError: r.paperclipPushError,
        notionPageId: r.notionPageId,
        notionUrl: r.notionUrl,
        notionStatus: r.notionStatus,
        notionAssignee: r.notionAssignee,
        notionPushedAt: r.notionPushedAt?.toISOString() ?? null,
        notionLastSyncedAt: r.notionLastSyncedAt?.toISOString() ?? null,
        notionPushError: r.notionPushError,
        children: r.paperclipChildrenSnapshot ?? [],
      })),
    });
  },
);

// POST /admin/engineering-space/refresh
// Kick both the push + poll loops immediately. Returns 202 if at least one
// was started; status snapshot in body.
router.post(
  "/admin/engineering-space/refresh",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const r = triggerPaperclipRefreshInBackground();
    const n = triggerNotionRefreshInBackground();
    req.log?.info(
      { adminId: req.user!.id, paperclip: r, notion: n },
      "Admin triggered engineering-space refresh",
    );
    // "busy" isn't an error — the work the admin wanted is already
    // running. Return 202 in both cases so the client doesn't toast an
    // error; the body tells the UI which loop was busy.
    res.status(202).json({
      ...r,
      notion: n,
      schedulerStatus: getPaperclipSchedulerStatus(),
      notionSchedulerStatus: getNotionSchedulerStatus(),
    });
  },
);

// POST /admin/engineering-space/:id/retry-push
// Clear the failure markers on a single feature request and immediately
// push it to Paperclip. This is the ONLY way to re-push after a failed
// attempt — the scheduler never auto-retries, by design (so a 5xx where
// Paperclip actually persisted the issue can't produce duplicates).
router.post(
  "/admin/engineering-space/:id/retry-push",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const cleared = await clearPaperclipPushAttempt(id);
    if (!cleared) {
      res.status(409).json({
        error:
          "Cannot retry: feature request either doesn't exist, isn't planned, or has already been successfully pushed.",
      });
      return;
    }
    const result = await pushSingleFeatureRequest(id, true);
    req.log?.info(
      { adminId: req.user!.id, featureRequestId: id, result },
      "Admin retried Paperclip push",
    );
    if (result.ok) {
      res.json({ ok: true, paperclipIssueId: result.paperclipIssueId });
    } else {
      res.status(502).json({ ok: false, error: result.error });
    }
  },
);

// POST /admin/engineering-space/:id/retry-notion-push
// Notion equivalent of retry-push: clear the Notion failure markers on a
// single human-routed feature request and immediately re-create its Notion
// page. Only works for rows that have NOT already landed a notionPageId.
router.post(
  "/admin/engineering-space/:id/retry-notion-push",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const cleared = await clearNotionPushAttempt(id);
    if (!cleared) {
      res.status(409).json({
        error:
          "Cannot retry: feature request either doesn't exist or has already been successfully pushed to Notion.",
      });
      return;
    }
    const result = await pushSingleToNotion(id);
    req.log?.info(
      { adminId: req.user!.id, featureRequestId: id, result },
      "Admin retried Notion push",
    );
    if (result.ok) {
      res.json({ ok: true, notionPageId: result.notionPageId });
    } else {
      res.status(502).json({ ok: false, error: result.error });
    }
  },
);

export default router;
