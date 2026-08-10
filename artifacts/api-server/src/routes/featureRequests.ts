import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import {
  db,
  conversationsTable,
  featureRequestsTable,
  featureRequestVersionsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  serializeFeatureRequest,
  resynthesizeForConversation,
} from "./conversations";
import {
  notifyOwnerOfStatusChange,
  notifyOwnerOfResynthesis,
  getUserEmail,
} from "../lib/email";
import { isPaperclipConfigured } from "../lib/paperclip";
import { pushSingleFeatureRequest } from "../lib/paperclip-scheduler";
import { buildFeatureRequestMarkdown } from "../lib/feature-request-markdown";
import { contentDispositionHeader } from "../lib/http";
import { isNotionConfigured } from "../lib/notion";
import { pushSingleToNotion } from "../lib/notion-scheduler";

const router: IRouter = Router();

async function attachUsers(
  rows: (typeof featureRequestsTable.$inferSelect)[],
  isAdmin: boolean,
) {
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const users =
    userIds.length === 0
      ? []
      : await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
  const byId = new Map<string, User>(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const u = byId.get(r.userId);
    return serializeFeatureRequest(
      r,
      u?.email ?? "",
      u?.name ?? null,
      isAdmin,
    );
  });
}

router.get("/feature-requests", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.userId, req.user!.id))
    .orderBy(desc(featureRequestsTable.createdAt));
  res.json(
    rows.map((r) =>
      serializeFeatureRequest(
        r,
        req.user!.email,
        req.user!.name,
        !!req.user!.isAdmin,
      ),
    ),
  );
});

router.get("/feature-requests/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, id))
    .limit(1);
  if (!fr) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (fr.userId !== req.user!.id && !req.user!.isAdmin) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, fr.userId))
    .limit(1);
  res.json(
    serializeFeatureRequest(
      fr,
      owner?.email ?? "",
      owner?.name ?? null,
      !!req.user!.isAdmin,
    ),
  );
});

const STATUSES = new Set(["requested", "ready_for_execution", "planned", "in_progress", "deployed"]);
const PRIORITIES = new Set(["low", "medium", "high"]);

router.patch("/feature-requests/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, id))
    .limit(1);
  if (!fr) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (fr.userId !== req.user!.id && !req.user!.isAdmin) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const patch: Partial<typeof featureRequestsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof req.body?.status === "string") {
    if (!STATUSES.has(req.body.status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    // "deployed" is the terminal state and is reserved for admins (and,
    // in Wave 2, the GitHub webhook on PR-merge). Owners can't flip their
    // own request to Deployed — that's a triage call.
    if (req.body.status === "deployed" && !req.user!.isAdmin) {
      res
        .status(403)
        .json({ error: "Only admins can move a request to 'deployed'" });
      return;
    }
    patch.status = req.body.status;
  }
  if (typeof req.body?.priority === "string") {
    if (!PRIORITIES.has(req.body.priority)) {
      res.status(400).json({ error: "Invalid priority" });
      return;
    }
    patch.priority = req.body.priority;
  }

  // Admin-set priority rank for the Planned backlog. Only admins may write
  // this field — non-admins silently have the value dropped from the patch
  // so a malicious owner can't reorder the agent-facing queue.
  if ("adminPriorityRank" in (req.body ?? {})) {
    if (!req.user!.isAdmin) {
      res.status(403).json({ error: "Only admins may set adminPriorityRank" });
      return;
    }
    const raw = req.body.adminPriorityRank;
    if (raw === null) {
      patch.adminPriorityRank = null;
    } else if (
      typeof raw === "number" &&
      Number.isInteger(raw) &&
      raw >= 1 &&
      raw <= 10_000
    ) {
      patch.adminPriorityRank = raw;
    } else {
      res
        .status(400)
        .json({ error: "adminPriorityRank must be a positive integer or null" });
      return;
    }
  }

  // Engineering destination chosen when moving to "Planned": "agent" routes to
  // Paperclip + the dev-agent queue, "human" routes to Notion only. Admin-only,
  // same as adminPriorityRank — a malicious owner mustn't be able to reroute
  // their own ticket.
  if ("engineeringOwner" in (req.body ?? {})) {
    if (!req.user!.isAdmin) {
      res.status(403).json({ error: "Only admins may set engineeringOwner" });
      return;
    }
    const raw = req.body.engineeringOwner;
    if (raw === null || raw === "agent" || raw === "human") {
      patch.engineeringOwner = raw;
    } else {
      res
        .status(400)
        .json({ error: "engineeringOwner must be 'agent', 'human', or null" });
      return;
    }
  }

  const prevStatus = fr.status;
  const [updated] = await db
    .update(featureRequestsTable)
    .set(patch)
    .where(eq(featureRequestsTable.id, id))
    .returning();

  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, updated!.userId))
    .limit(1);

  // Notify owner on status change (skip if owner triggered it themselves).
  if (
    typeof patch.status === "string" &&
    patch.status !== prevStatus &&
    owner?.email &&
    owner.id !== req.user!.id
  ) {
    try {
      await notifyOwnerOfStatusChange({
        ownerEmail: owner.email,
        ownerName: owner.name,
        featureRequestId: updated!.id,
        featureRequestTitle: updated!.title,
        newStatus: patch.status,
      });
    } catch (err) {
      req.log?.warn({ err }, "Failed to send status-change email");
    }
  }

  // Fire-and-forget an immediate push when a card transitions INTO 'planned'
  // and has never been pushed before. Without this, the user has to wait up to
  // PUSH_INTERVAL_MS (5 min) for the next scheduler tick. We don't await — the
  // HTTP response shouldn't block on third-party latency, and the schedulers'
  // fire-and-forget semantics still apply (pushedAt is stamped on success or
  // failure so there's no duplicate risk if a scheduler tick fires
  // concurrently). The destination depends on engineeringOwner: "human" → a
  // Notion page; "agent" (or legacy null) → Paperclip.
  const movedToPlanned = patch.status === "planned" && prevStatus !== "planned";
  if (movedToPlanned && updated!.engineeringOwner === "human") {
    if (isNotionConfigured() && !updated!.notionPageId) {
      setImmediate(async () => {
        try {
          const result = await pushSingleToNotion(updated!.id);
          if (result.ok) {
            req.log?.info(
              {
                featureRequestId: updated!.id,
                notionPageId: result.notionPageId,
              },
              "Immediate Notion push on status->planned succeeded",
            );
          } else {
            req.log?.warn(
              { featureRequestId: updated!.id, err: result.error },
              "Immediate Notion push on status->planned failed (admin can retry from Engineering Space)",
            );
          }
        } catch (err) {
          req.log?.error(
            { featureRequestId: updated!.id, err },
            "Immediate Notion push threw",
          );
        }
      });
    }
  } else if (
    movedToPlanned &&
    isPaperclipConfigured() &&
    !updated!.paperclipIssueId
  ) {
    setImmediate(async () => {
      try {
        const result = await pushSingleFeatureRequest(updated!.id);
        if (result.ok) {
          req.log?.info(
            {
              featureRequestId: updated!.id,
              paperclipIssueId: result.paperclipIssueId,
            },
            "Immediate Paperclip push on status->planned succeeded",
          );
        } else {
          req.log?.warn(
            { featureRequestId: updated!.id, err: result.error },
            "Immediate Paperclip push on status->planned failed (admin can retry from Engineering Space)",
          );
        }
      } catch (err) {
        req.log?.error(
          { featureRequestId: updated!.id, err },
          "Immediate Paperclip push threw",
        );
      }
    });
  }

  res.json(
    serializeFeatureRequest(
      updated!,
      owner?.email ?? "",
      owner?.name ?? null,
      !!req.user!.isAdmin,
    ),
  );
});

// Delete a feature request. Owner or admin only — admins can delete any
// request across all users ("across any requests"). We delete the underlying
// conversation, which cascade-deletes the feature_request row itself (FK
// conversation -> feature_request, onDelete cascade) along with its messages,
// attachments, version history, engineering tasks, events, and merge proposals.
router.delete("/feature-requests/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, id))
    .limit(1);
  if (!fr) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (fr.userId !== req.user!.id && !req.user!.isAdmin) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .delete(conversationsTable)
    .where(eq(conversationsTable.id, fr.conversationId));

  req.log?.info(
    { featureRequestId: id, conversationId: fr.conversationId, byAdmin: !!req.user!.isAdmin },
    "Feature request deleted",
  );
  res.status(204).end();
});

async function loadAccessibleFeatureRequest(
  id: number,
  userId: string,
  isAdmin: boolean,
) {
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, id))
    .limit(1);
  if (!fr) return null;
  if (fr.userId !== userId && !isAdmin) return null;
  return fr;
}

router.get(
  "/feature-requests/:id/versions",
  requireAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const fr = await loadAccessibleFeatureRequest(
      id,
      req.user!.id,
      !!req.user!.isAdmin,
    );
    if (!fr) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const versions = await db
      .select()
      .from(featureRequestVersionsTable)
      .where(eq(featureRequestVersionsTable.featureRequestId, id))
      .orderBy(desc(featureRequestVersionsTable.versionNumber));
    const authorIds = Array.from(
      new Set(
        versions
          .map((v) => v.createdByUserId)
          .filter((v): v is string => !!v),
      ),
    );
    const authors =
      authorIds.length === 0
        ? []
        : await db
            .select()
            .from(usersTable)
            .where(inArray(usersTable.id, authorIds));
    const byId = new Map(authors.map((u) => [u.id, u]));
    res.json(
      versions.map((v) => {
        const a = v.createdByUserId ? byId.get(v.createdByUserId) : undefined;
        return {
          id: v.id,
          featureRequestId: v.featureRequestId,
          versionNumber: v.versionNumber,
          title: v.title,
          summary: v.summary,
          problem: v.problem,
          benefits: v.benefits,
          currentSpend: v.currentSpend,
          scope: v.scope,
          priority: v.priority,
          changeReason: v.changeReason,
          createdByUserId: v.createdByUserId,
          createdByName: a ? a.name || a.email : null,
          createdAt: v.createdAt.toISOString(),
        };
      }),
    );
  },
);

router.post(
  "/feature-requests/:id/resynthesize",
  requireAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const fr = await loadAccessibleFeatureRequest(
      id,
      req.user!.id,
      !!req.user!.isAdmin,
    );
    if (!fr) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = await resynthesizeForConversation({
      conversationId: fr.conversationId,
      actorUserId: req.user!.id,
      log: req.log,
      reason: `Manual re-synthesis by ${req.user!.name || req.user!.email}`,
    });
    if (!result.ok) {
      res.status(502).json({ error: result.reason });
      return;
    }
    const [owner] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, result.fr.userId))
      .limit(1);

    if (owner?.email) {
      try {
        await notifyOwnerOfResynthesis({
          ownerEmail: owner.email,
          ownerName: owner.name,
          featureRequestId: result.fr.id,
          featureRequestTitle: result.fr.title,
          reason: "Manual re-synthesis",
          triggeredByUserId: req.user!.id,
          ownerUserId: result.fr.userId,
        });
      } catch (err) {
        req.log?.warn({ err }, "Failed to send resynth email");
      }
    }

    res.json(
      serializeFeatureRequest(
        result.fr,
        owner?.email ?? "",
        owner?.name ?? null,
        !!req.user!.isAdmin,
      ),
    );
  },
);

router.get("/feature-requests/:id/pdf", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const fr = await loadAccessibleFeatureRequest(
    id,
    req.user!.id,
    !!req.user!.isAdmin,
  );
  if (!fr) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, fr.userId))
    .limit(1);

  const safeName = fr.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || `feature-request-${fr.id}`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeName}-v${fr.id}.pdf"`,
  );

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 64, left: 64, right: 64, bottom: 64 },
    info: {
      Title: fr.title,
      Author: "ScopeBot",
      Subject: "Feature Request",
    },
  });
  doc.pipe(res);

  // Header band
  doc
    .fillColor("#4F46E5")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("SCOPEBOT · PRODUCT REQUEST", { characterSpacing: 1.5 });
  doc.moveDown(0.4);
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text(fr.title);
  doc.moveDown(0.2);
  doc
    .fillColor("#6B7280")
    .font("Helvetica")
    .fontSize(10)
    .text(
      `${owner?.name || owner?.email || "Anonymous"}  ·  Status: ${fr.status.replace(/_/g, " ")}  ·  Priority: ${fr.priority}  ·  Updated ${fr.updatedAt.toISOString().slice(0, 10)}`,
    );
  doc.moveDown(0.6);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#E5E7EB")
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.8);

  const writeSection = (heading: string, body: string) => {
    doc
      .fillColor("#4F46E5")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(heading.toUpperCase(), { characterSpacing: 1.2 });
    doc.moveDown(0.25);
    doc.fillColor("#111827");
    renderMarkdown(doc, body);
    doc.moveDown(0.8);
  };

  writeSection("Summary", fr.summary);
  writeSection("Problem", fr.problem);
  writeSection("Benefits", fr.benefits);
  writeSection("Current cost / pain", fr.currentSpend);
  writeSection("Scope", fr.scope);

  // Footer
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fillColor("#9CA3AF")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `Generated ${new Date().toISOString().slice(0, 10)}  ·  Page ${i + 1} of ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 40,
        { align: "center", width: doc.page.width - 128 },
      );
  }

  doc.end();
});

router.get("/feature-requests/:id/markdown", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const fr = await loadAccessibleFeatureRequest(
    id,
    req.user!.id,
    !!req.user!.isAdmin,
  );
  if (!fr) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const safeName =
    fr.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || `feature-request-${fr.id}`;
  const md = await buildFeatureRequestMarkdown(fr);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    contentDispositionHeader("attachment", `${safeName}-v${fr.id}.md`),
  );
  res.send(md);
});

// Minimal markdown → pdfkit renderer. Supports H1/H2/H3, bullets (-, *),
// numbered lists, **bold**, *italic*, `code`, and paragraph breaks. Keeps
// rendering robust for any model output.
function renderMarkdown(
  doc: PDFKit.PDFDocument,
  md: string,
) {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  let inCodeBlock = false;
  for (let raw of lines) {
    if (raw.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      doc.moveDown(0.2);
      continue;
    }
    if (inCodeBlock) {
      doc.font("Courier").fontSize(9.5).fillColor("#374151").text(raw);
      continue;
    }
    if (raw.trim() === "") {
      doc.moveDown(0.4);
      continue;
    }
    // Image-only line (e.g. embedded screenshot) → clickable link. The PDF
    // can't render the bytes inline cheaply, so we surface a tappable link
    // that opens the full-size image (served from the public attachment URL).
    const imgOnly = raw.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (imgOnly) {
      const label = imgOnly[1]?.trim() || "image";
      doc
        .fillColor("#4F46E5")
        .font("Helvetica")
        .fontSize(10.5)
        .text(`View image: ${label}`, { link: imgOnly[2], underline: true });
      doc.fillColor("#111827");
      continue;
    }
    // Standalone link line → clickable link.
    const linkOnly = raw.match(/^\s*\[([^\]]+)\]\(([^)\s]+)\)\s*$/);
    if (linkOnly) {
      doc
        .fillColor("#4F46E5")
        .font("Helvetica")
        .fontSize(10.5)
        .text(linkOnly[1], { link: linkOnly[2], underline: true });
      doc.fillColor("#111827");
      continue;
    }
    const h1 = raw.match(/^#\s+(.*)/);
    const h2 = raw.match(/^##\s+(.*)/);
    const h3 = raw.match(/^###\s+(.*)/);
    if (h1) {
      doc
        .moveDown(0.3)
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(h1[1]);
      continue;
    }
    if (h2) {
      doc
        .moveDown(0.3)
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(h2[1]);
      continue;
    }
    if (h3) {
      doc
        .moveDown(0.2)
        .fillColor("#374151")
        .font("Helvetica-Bold")
        .fontSize(11.5)
        .text(h3[1]);
      continue;
    }
    const bullet = raw.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      doc
        .fillColor("#111827")
        .font("Helvetica")
        .fontSize(10.5)
        .text(`•  ${stripInline(bullet[1])}`, { indent: 12 });
      continue;
    }
    const num = raw.match(/^\s*(\d+)\.\s+(.*)/);
    if (num) {
      doc
        .fillColor("#111827")
        .font("Helvetica")
        .fontSize(10.5)
        .text(`${num[1]}.  ${stripInline(num[2])}`, { indent: 12 });
      continue;
    }
    doc
      .fillColor("#111827")
      .font("Helvetica")
      .fontSize(10.5)
      .text(stripInline(raw));
  }
}

function stripInline(s: string): string {
  // Remove markdown syntax we don't render with style — keep readable text.
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

export default router;
