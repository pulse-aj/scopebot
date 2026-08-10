import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import {
  db,
  featureRequestsTable,
  featureRequestEventsTable,
} from "@workspace/db";
import { scopeWithSourceHeader } from "../lib/email.js";

const router: IRouter = Router();

// Bearer-token middleware used by the external dev agent (Claude Code /
// Cursor) integration. Validates `Authorization: Bearer <token>` against
// the INTEGRATION_API_TOKEN env var using a constant-time comparison.
// Cookies / Clerk are intentionally NOT consulted here — agents have no
// browser session.
const requireIntegrationToken: RequestHandler = (req, res, next) => {
  const expected = process.env.INTEGRATION_API_TOKEN;
  if (!expected) {
    req.log?.error(
      "INTEGRATION_API_TOKEN is not set — refusing integration request.",
    );
    res
      .status(503)
      .json({ error: "Integration API disabled (no token configured)" });
    return;
  }
  const header = req.header("authorization") ?? "";
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  const provided = match ? match[1]! : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok =
    a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: "Invalid integration token" });
    return;
  }
  next();
};

// Human-routed requests live in Notion only and must never be visible or
// mutable through the dev-agent surface — not via the queue list, and not by
// guessing an ID. null (legacy, pre-routing) is treated as agent-eligible.
// Applied to every by-id read/mutation so isolation can't be bypassed.
const notHumanOwned = or(
  isNull(featureRequestsTable.engineeringOwner),
  ne(featureRequestsTable.engineeringOwner, "human"),
);

// Agent-facing serialization. Deliberately distinct from the user-facing
// serializeFeatureRequest so the surface stays stable even if the
// customer-facing one changes (and to make it obvious that admin-only
// fields are intentionally exposed here — the bearer token IS the
// admin-level credential for this surface).
function serializeForAgent(
  fr: typeof featureRequestsTable.$inferSelect,
) {
  return {
    id: fr.id,
    title: fr.title,
    summary: fr.summary,
    problem: fr.problem,
    benefits: fr.benefits,
    currentSpend: fr.currentSpend,
    scope: scopeWithSourceHeader(fr.id, fr.scope),
    status: fr.status,
    priority: fr.priority,
    adminPriorityRank: fr.adminPriorityRank ?? null,
    aiPriorityRank: fr.aiPriorityRank ?? null,
    aiPriorityRationale: fr.aiPriorityRationale ?? null,
    relatedRequestIds: fr.relatedRequestIds ?? null,
    clusterRationale: fr.clusterRationale ?? null,
    createdAt: fr.createdAt.toISOString(),
    updatedAt: fr.updatedAt.toISOString(),
  };
}

// GET /integrations/feature-requests
// Returns the entire Planned backlog ordered by admin priority rank
// (NULLS LAST) then createdAt asc. The agent should treat this as a
// priority-ordered work queue.
router.get(
  "/integrations/feature-requests",
  requireIntegrationToken,
  async (_req, res) => {
    const rows = await db
      .select()
      .from(featureRequestsTable)
      .where(
        and(eq(featureRequestsTable.status, "planned"), notHumanOwned),
      )
      .orderBy(
        sql`${featureRequestsTable.adminPriorityRank} asc nulls last`,
        asc(featureRequestsTable.createdAt),
      );
    res.json(rows.map(serializeForAgent));
  },
);

// GET /integrations/feature-requests/:id
router.get(
  "/integrations/feature-requests/:id",
  requireIntegrationToken,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [fr] = await db
      .select()
      .from(featureRequestsTable)
      .where(and(eq(featureRequestsTable.id, id), notHumanOwned))
      .limit(1);
    if (!fr) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serializeForAgent(fr));
  },
);

// POST /integrations/feature-requests/:id/status
// The agent may move requests between "planned" and "in_progress". It may
// NOT set "requested" (that's the customer queue) or "deployed" (reserved
// for the GitHub webhook on PR-merge in Wave 2). It may also only act on
// requests already in planned/in_progress — once a human moves something
// back to "requested" the agent must wait for re-planning.
const AGENT_STATUSES = new Set(["planned", "in_progress"] as const);

router.post(
  "/integrations/feature-requests/:id/status",
  requireIntegrationToken,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const target =
      typeof req.body?.status === "string" ? req.body.status : "";
    if (!AGENT_STATUSES.has(target as "planned" | "in_progress")) {
      res.status(400).json({
        error:
          "Integration may only transition between 'planned' and 'in_progress'. 'deployed' is reserved for the GitHub webhook.",
      });
      return;
    }
    // Atomic compare-and-set: the source-state gate lives in the WHERE
    // clause so two concurrent integration calls can't race a card out of
    // (e.g.) "requested" — only rows currently in planned/in_progress can
    // be touched here. If 0 rows update, we look up the row to return the
    // right 404/409.
    const updatedRows = await db
      .update(featureRequestsTable)
      .set({
        status: target as "planned" | "in_progress",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(featureRequestsTable.id, id),
          inArray(featureRequestsTable.status, ["planned", "in_progress"]),
          notHumanOwned,
        ),
      )
      .returning();
    const updated = updatedRows[0];
    if (!updated) {
      const [current] = await db
        .select({ status: featureRequestsTable.status })
        .from(featureRequestsTable)
        .where(and(eq(featureRequestsTable.id, id), notHumanOwned))
        .limit(1);
      if (!current) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res
        .status(409)
        .json({ error: `Cannot move from '${current.status}' via integration` });
      return;
    }
    await db.insert(featureRequestEventsTable).values({
      featureRequestId: id,
      kind: "status_changed",
      source: "integration",
      message: `Status changed to ${target}`,
      payload: { to: target },
    });
    req.log?.info(
      { id, to: target },
      "Integration moved request status",
    );
    res.json(serializeForAgent(updated));
  },
);

// POST /integrations/feature-requests/:id/events
// Append a timeline event. Free-form payload, kind validated against an
// allow-list so the timeline stays grep-able.
const ALLOWED_EVENT_KINDS = new Set([
  "note",
  "branch_created",
  "commit",
  "pr_opened",
  "pr_updated",
  "pr_merged",
  "pr_closed",
  "build_failed",
  "build_passed",
]);

router.post(
  "/integrations/feature-requests/:id/events",
  requireIntegrationToken,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const kind =
      typeof req.body?.kind === "string" ? req.body.kind : "";
    if (!ALLOWED_EVENT_KINDS.has(kind)) {
      res.status(400).json({
        error: `Invalid event kind. Allowed: ${Array.from(
          ALLOWED_EVENT_KINDS,
        ).join(", ")}`,
      });
      return;
    }
    const message =
      typeof req.body?.message === "string"
        ? req.body.message.slice(0, 2000)
        : null;
    const payload =
      req.body?.payload &&
      typeof req.body.payload === "object" &&
      !Array.isArray(req.body.payload)
        ? (req.body.payload as Record<string, unknown>)
        : null;
    const [exists] = await db
      .select({ id: featureRequestsTable.id })
      .from(featureRequestsTable)
      .where(and(eq(featureRequestsTable.id, id), notHumanOwned))
      .limit(1);
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [ev] = await db
      .insert(featureRequestEventsTable)
      .values({
        featureRequestId: id,
        kind,
        source: "integration",
        message,
        payload,
      })
      .returning();
    req.log?.info(
      { id, kind, eventId: ev!.id },
      "Integration logged timeline event",
    );
    res.status(201).json({
      id: ev!.id,
      featureRequestId: ev!.featureRequestId,
      kind: ev!.kind,
      source: ev!.source,
      message: ev!.message,
      payload: ev!.payload,
      createdAt: ev!.createdAt.toISOString(),
    });
  },
);

export default router;
