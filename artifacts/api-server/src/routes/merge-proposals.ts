import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  featureRequestVersionsTable,
  featureRequestMergeProposalsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { containsConfidentialLeak } from "../lib/merge-detection";

// Customer-safe version-history reason. Must NOT reference the duplicate, any
// other requester, or a request id — owners can read change reasons via
// GET /feature-requests/:id/versions.
const MERGE_CHANGE_REASON =
  "Scope consolidated to cover additional related requirements.";

// Thrown inside the approve transaction to roll back (leaving the proposal
// pending) when the drafted scope fails the confidentiality check.
class ConfidentialityError extends Error {}

const router: IRouter = Router();

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /admin/merge-proposals — pending duplicate suggestions, with both the
// duplicate and the primary request inlined (incl. the primary's CURRENT scope
// so admins can compare it against the proposed rewrite). Admin-only.
router.get(
  "/admin/merge-proposals",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const proposals = await db
      .select()
      .from(featureRequestMergeProposalsTable)
      .where(eq(featureRequestMergeProposalsTable.status, "pending"))
      .orderBy(desc(featureRequestMergeProposalsTable.createdAt));

    if (proposals.length === 0) {
      res.json({ proposals: [] });
      return;
    }

    const frIds = Array.from(
      new Set(
        proposals.flatMap((p) => [p.duplicateRequestId, p.primaryRequestId]),
      ),
    );
    const frs = await db
      .select({
        id: featureRequestsTable.id,
        title: featureRequestsTable.title,
        summary: featureRequestsTable.summary,
        scope: featureRequestsTable.scope,
        status: featureRequestsTable.status,
        priority: featureRequestsTable.priority,
        createdAt: featureRequestsTable.createdAt,
        userEmail: usersTable.email,
        userName: usersTable.name,
      })
      .from(featureRequestsTable)
      .innerJoin(usersTable, eq(usersTable.id, featureRequestsTable.userId))
      .where(inArray(featureRequestsTable.id, frIds));
    const byId = new Map(frs.map((f) => [f.id, f]));

    const serializeFr = (id: number) => {
      const f = byId.get(id);
      if (!f) return null;
      return {
        id: f.id,
        title: f.title,
        summary: f.summary,
        scope: f.scope,
        status: f.status,
        priority: f.priority,
        userEmail: f.userEmail,
        userName: f.userName,
        createdAt: toIso(f.createdAt),
      };
    };

    const items = proposals
      .map((p) => {
        const duplicate = serializeFr(p.duplicateRequestId);
        const primary = serializeFr(p.primaryRequestId);
        if (!duplicate || !primary) return null;
        return {
          id: p.id,
          confidence: p.confidence,
          relationRationale: p.relationRationale,
          proposedScope: p.proposedScope,
          createdAt: toIso(p.createdAt),
          duplicate,
          primary,
        };
      })
      .filter((x) => x !== null);

    res.json({ proposals: items });
  },
);

async function loadPendingOr404(id: number, res: Response) {
  const [p] = await db
    .select()
    .from(featureRequestMergeProposalsTable)
    .where(
      and(
        eq(featureRequestMergeProposalsTable.id, id),
        eq(featureRequestMergeProposalsTable.status, "pending"),
      ),
    )
    .limit(1);
  if (!p) {
    res.status(404).json({ error: "Proposal not found or already reviewed" });
    return null;
  }
  return p;
}

// POST /admin/merge-proposals/:id/approve — apply the drafted scope to the
// PRIMARY request (recording a new version snapshot) and mark the proposal
// approved. The duplicate request is left untouched. Admin-only.
//
// Runs in a single transaction. The proposal is "claimed" with a conditional
// UPDATE (status='pending' -> 'approved') so two concurrent approvals can't
// both apply the scope, and the new version row is inserted with RETURNING so
// appliedVersionNumber is the exact version created here (not a racy MAX()).
router.post(
  "/admin/merge-proposals/:id/approve",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const adminId = req.user!.id;
    const now = new Date();

    type ApproveResult =
      | { kind: "ok"; primaryRequestId: number; duplicateRequestId: number }
      | { kind: "not_pending" };

    let result: ApproveResult;
    try {
      result = await db.transaction(async (tx) => {
      // Claim the proposal: only one transaction can flip pending -> approved.
      const [claimed] = await tx
        .update(featureRequestMergeProposalsTable)
        .set({
          status: "approved",
          reviewedByUserId: adminId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(featureRequestMergeProposalsTable.id, id),
            eq(featureRequestMergeProposalsTable.status, "pending"),
          ),
        )
        .returning();
      if (!claimed) return { kind: "not_pending" };

      // Defense-in-depth: never let a confidentiality-leaking draft reach a
      // customer-visible field. Roll back the claim and leave it pending.
      if (containsConfidentialLeak(claimed.proposedScope)) {
        throw new ConfidentialityError();
      }

      const [primary] = await tx
        .update(featureRequestsTable)
        .set({ scope: claimed.proposedScope, updatedAt: now })
        .where(eq(featureRequestsTable.id, claimed.primaryRequestId))
        .returning();
      // FK guarantees the primary exists (cascade delete removes the proposal).
      if (!primary) throw new Error("primary request missing");

      const [version] = await tx
        .insert(featureRequestVersionsTable)
        .values({
          featureRequestId: primary.id,
          versionNumber: sql<number>`COALESCE((SELECT MAX(version_number) FROM feature_request_versions WHERE feature_request_id = ${primary.id}), 0) + 1`,
          title: primary.title,
          summary: primary.summary,
          problem: primary.problem,
          benefits: primary.benefits,
          currentSpend: primary.currentSpend,
          scope: primary.scope,
          priority: primary.priority,
          changeReason: MERGE_CHANGE_REASON,
          createdByUserId: adminId,
        })
        .returning({ versionNumber: featureRequestVersionsTable.versionNumber });

      await tx
        .update(featureRequestMergeProposalsTable)
        .set({ appliedVersionNumber: version?.versionNumber ?? null })
        .where(eq(featureRequestMergeProposalsTable.id, id));

      return {
        kind: "ok",
        primaryRequestId: claimed.primaryRequestId,
        duplicateRequestId: claimed.duplicateRequestId,
      };
      });
    } catch (err) {
      if (err instanceof ConfidentialityError) {
        res.status(422).json({
          error:
            "The drafted scope failed the confidentiality check and was not applied.",
        });
        return;
      }
      throw err;
    }

    if (result.kind === "not_pending") {
      res.status(404).json({ error: "Proposal not found or already reviewed" });
      return;
    }

    req.log?.info(
      {
        proposalId: id,
        primaryRequestId: result.primaryRequestId,
        duplicateRequestId: result.duplicateRequestId,
      },
      "merge proposal approved",
    );
    res.json({ ok: true, primaryRequestId: result.primaryRequestId });
  },
);

// POST /admin/merge-proposals/:id/reject — dismiss the suggestion. Nothing on
// either request changes. Admin-only.
router.post(
  "/admin/merge-proposals/:id/reject",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const proposal = await loadPendingOr404(id, res);
    if (!proposal) return;

    await db
      .update(featureRequestMergeProposalsTable)
      .set({
        status: "rejected",
        reviewedByUserId: req.user!.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(featureRequestMergeProposalsTable.id, id));

    res.json({ ok: true });
  },
);

export default router;
