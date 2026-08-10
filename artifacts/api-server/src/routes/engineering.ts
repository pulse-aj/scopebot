import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  featureRequestsTable,
  conversationsTable,
  messagesTable,
  usersTable,
  engineeringTasksTable,
  engineeringTaskMessagesTable,
  customerQuestionDraftsTable,
  type EngineeringTask,
  type EngineeringTaskMessage,
  type CustomerQuestionDraft,
  type User,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { anthropic, MODEL } from "../lib/anthropic";
import { getUserEmail, notifyOwnerOfAdminQuestion } from "../lib/email";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const TASK_STATUSES = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);

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

function serializeTask(
  t: EngineeringTask,
  assignee?: User,
): Record<string, unknown> {
  return {
    id: t.id,
    featureRequestId: t.featureRequestId,
    title: t.title,
    description: t.description,
    status: t.status,
    assigneeUserId: t.assigneeUserId,
    assigneeName: assignee ? assignee.name || assignee.email || null : null,
    assigneeEmail: assignee?.email ?? null,
    githubRepo: t.githubRepo,
    githubBranch: t.githubBranch,
    githubPrNumber: t.githubPrNumber,
    githubPrUrl: t.githubPrUrl,
    githubPrState: t.githubPrState,
    githubPrStateUpdatedAt: t.githubPrStateUpdatedAt
      ? t.githubPrStateUpdatedAt.toISOString()
      : null,
    createdByUserId: t.createdByUserId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function serializeTaskMessage(
  m: EngineeringTaskMessage,
  author?: User,
): Record<string, unknown> {
  return {
    id: m.id,
    taskId: m.taskId,
    role: m.role,
    content: m.content,
    authorUserId: m.authorUserId,
    authorName: author ? author.name || author.email || null : null,
    draftId: m.draftId,
    createdAt: m.createdAt.toISOString(),
  };
}

function serializeDraft(
  d: CustomerQuestionDraft,
  proposedBy?: User,
  reviewedBy?: User,
): Record<string, unknown> {
  return {
    id: d.id,
    featureRequestId: d.featureRequestId,
    taskId: d.taskId,
    conversationId: d.conversationId,
    proposedByUserId: d.proposedByUserId,
    proposedByName: proposedBy ? proposedBy.name || proposedBy.email || null : null,
    draftContent: d.draftContent,
    contextNote: d.contextNote,
    status: d.status,
    reviewedByUserId: d.reviewedByUserId,
    reviewedByName: reviewedBy ? reviewedBy.name || reviewedBy.email || null : null,
    reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
    postedMessageId: d.postedMessageId,
    createdAt: d.createdAt.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Admin user list (for assignee picker)
// ────────────────────────────────────────────────────────────────────────────

router.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.isAdmin), asc(usersTable.email));
  res.json(
    rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isAdmin: u.isAdmin,
      isEngineer: u.isEngineer,
    })),
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Tasks CRUD
// ────────────────────────────────────────────────────────────────────────────

router.get(
  "/feature-requests/:id/tasks",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select()
      .from(engineeringTasksTable)
      .where(eq(engineeringTasksTable.featureRequestId, id))
      .orderBy(asc(engineeringTasksTable.createdAt));
    const assignees = await userMap(rows.map((r) => r.assigneeUserId));
    res.json(
      rows.map((r) =>
        serializeTask(r, r.assigneeUserId ? assignees.get(r.assigneeUserId) : undefined),
      ),
    );
  },
);

router.post(
  "/feature-requests/:id/tasks",
  requireAuth,
  requireAdmin,
  async (req, res) => {
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
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "title required" });
      return;
    }
    const description =
      typeof req.body?.description === "string" ? req.body.description : "";
    const status =
      typeof req.body?.status === "string" && TASK_STATUSES.has(req.body.status)
        ? (req.body.status as EngineeringTask["status"])
        : "backlog";
    const assigneeUserId =
      typeof req.body?.assigneeUserId === "string" && req.body.assigneeUserId
        ? req.body.assigneeUserId
        : null;
    const [created] = await db
      .insert(engineeringTasksTable)
      .values({
        featureRequestId: id,
        title,
        description,
        status,
        assigneeUserId,
        createdByUserId: req.user!.id,
      })
      .returning();
    const assignees = await userMap([created!.assigneeUserId]);
    req.log?.info({ taskId: created!.id, frId: id }, "Engineering task created");
    res.status(201).json(
      serializeTask(
        created!,
        created!.assigneeUserId
          ? assignees.get(created!.assigneeUserId)
          : undefined,
      ),
    );
  },
);

router.patch(
  "/engineering-tasks/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(engineeringTasksTable)
      .where(eq(engineeringTasksTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const patch: Partial<typeof engineeringTasksTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof req.body?.title === "string") {
      const t = req.body.title.trim();
      if (!t) {
        res.status(400).json({ error: "title cannot be empty" });
        return;
      }
      patch.title = t;
    }
    if (typeof req.body?.description === "string") {
      patch.description = req.body.description;
    }
    if (typeof req.body?.status === "string") {
      if (!TASK_STATUSES.has(req.body.status)) {
        res.status(400).json({ error: "invalid status" });
        return;
      }
      patch.status = req.body.status;
    }
    if ("assigneeUserId" in (req.body ?? {})) {
      patch.assigneeUserId =
        typeof req.body.assigneeUserId === "string" && req.body.assigneeUserId
          ? req.body.assigneeUserId
          : null;
    }
    for (const field of [
      "githubRepo",
      "githubBranch",
      "githubPrUrl",
    ] as const) {
      if (field in (req.body ?? {})) {
        const v = req.body[field];
        (patch as Record<string, unknown>)[field] =
          typeof v === "string" && v ? v : null;
      }
    }
    if ("githubPrNumber" in (req.body ?? {})) {
      const v = req.body.githubPrNumber;
      patch.githubPrNumber =
        typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    // When the PR URL/number is being cleared (or the repo/PR is being
    // swapped), the previously cached PR state would otherwise stick around
    // and mislead users. Clear it whenever a relevant identity field changes
    // to null, and let the explicit refresh-pr-state endpoint repopulate it.
    if (
      ("githubPrUrl" in (req.body ?? {}) && patch.githubPrUrl === null) ||
      ("githubPrNumber" in (req.body ?? {}) && patch.githubPrNumber === null) ||
      ("githubRepo" in (req.body ?? {}) && patch.githubRepo === null)
    ) {
      patch.githubPrState = null;
      patch.githubPrStateUpdatedAt = null;
    }
    const [updated] = await db
      .update(engineeringTasksTable)
      .set(patch)
      .where(eq(engineeringTasksTable.id, id))
      .returning();
    const assignees = await userMap([updated!.assigneeUserId]);
    res.json(
      serializeTask(
        updated!,
        updated!.assigneeUserId
          ? assignees.get(updated!.assigneeUserId)
          : undefined,
      ),
    );
  },
);

router.delete(
  "/engineering-tasks/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(engineeringTasksTable)
      .where(eq(engineeringTasksTable.id, id));
    res.status(204).end();
  },
);

// ────────────────────────────────────────────────────────────────────────────
// Engineer ↔ AI PM chat per task
// ────────────────────────────────────────────────────────────────────────────

async function loadTaskWithFr(id: number) {
  const [task] = await db
    .select()
    .from(engineeringTasksTable)
    .where(eq(engineeringTasksTable.id, id))
    .limit(1);
  if (!task) return null;
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, task.featureRequestId))
    .limit(1);
  if (!fr) return null;
  return { task, fr };
}

router.get(
  "/engineering-tasks/:id/messages",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select()
      .from(engineeringTaskMessagesTable)
      .where(eq(engineeringTaskMessagesTable.taskId, id))
      .orderBy(
        asc(engineeringTaskMessagesTable.createdAt),
        asc(engineeringTaskMessagesTable.id),
      );
    const authors = await userMap(rows.map((r) => r.authorUserId));
    res.json(
      rows.map((m) =>
        serializeTaskMessage(
          m,
          m.authorUserId ? authors.get(m.authorUserId) : undefined,
        ),
      ),
    );
  },
);

const ENGINEER_PM_SYSTEM_PROMPT = `You are a senior product manager at Pulse Energy (EV charger / fleet / roaming software) helping an engineer who is implementing a specific feature request or bug fix. You have full context on the original customer conversation and the finalized requirements doc.

Your job in this thread:
- Answer the engineer's questions about scope, intent, acceptance criteria, edge cases, and customer context using ONLY what's in the transcript and the requirements doc.
- When the engineer asks something that the customer never clarified, or the doc is silent on, DO NOT invent an answer. Instead, call the propose_customer_question tool to draft a clear, focused question to send back to the customer.
- The customer question will go through admin review before reaching the customer, so write it the way you'd want it sent — polite, concrete, and one focused topic per draft. Do not bundle 5 unrelated questions in one draft.
- Prefer to answer the engineer first using available context. Only propose a customer question when the answer genuinely requires customer input.
- Keep replies short and concrete. Engineers are busy.`;

const PROPOSE_CUSTOMER_QUESTION_TOOL: Anthropic.Tool = {
  name: "propose_customer_question",
  description:
    "Draft a question to send to the original customer/requester when the engineer needs information that isn't in the existing transcript or requirements doc. The draft will go through admin review before being posted to the customer conversation.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The exact question to ask the customer. Plain prose, polite, focused on one topic. No greeting required.",
      },
      rationale: {
        type: "string",
        description:
          "One-sentence note for the admin reviewer explaining why this needs to go to the customer (what gap in our info it fills).",
      },
    },
    required: ["question", "rationale"],
  },
};

async function buildTaskContextBlocks(
  taskId: number,
  frId: number,
): Promise<string> {
  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.id, frId))
    .limit(1);
  if (!fr) return "";
  // Customer transcript (text only — keep prompt manageable)
  const customerMsgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, fr.conversationId))
    .orderBy(
      asc(messagesTable.createdAt),
      asc(messagesTable.id),
    );
  const transcript = customerMsgs
    .map((m) => {
      const tag =
        m.role === "user"
          ? "CUSTOMER"
          : m.role === "admin"
            ? "ADMIN"
            : "AI-PM";
      return `[${tag}] ${m.content}`;
    })
    .join("\n\n");
  const doc = `# ${fr.title}

## Summary
${fr.summary}

## Problem
${fr.problem}

## Benefits
${fr.benefits}

## Current cost / pain
${fr.currentSpend}

## Scope
${fr.scope}`;
  return `Here is the finalized requirements doc and the original customer conversation transcript for this task.

=== REQUIREMENTS DOC ===
${doc}

=== CUSTOMER CONVERSATION TRANSCRIPT ===
${transcript}
=== END TRANSCRIPT ===

The engineer assigned to this task will now ask you questions. Use ONLY the doc and transcript above as customer context; do not invent customer details.`;
}

router.post(
  "/engineering-tasks/:id/messages",
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
    const loaded = await loadTaskWithFr(id);
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { task, fr } = loaded;

    // Persist engineer message
    const [engMsg] = await db
      .insert(engineeringTaskMessagesTable)
      .values({
        taskId: id,
        role: "engineer",
        content,
        authorUserId: req.user!.id,
      })
      .returning();

    // Load full history for prompt
    const history = await db
      .select()
      .from(engineeringTaskMessagesTable)
      .where(eq(engineeringTaskMessagesTable.taskId, id))
      .orderBy(
        asc(engineeringTaskMessagesTable.createdAt),
        asc(engineeringTaskMessagesTable.id),
      );

    const context = await buildTaskContextBlocks(id, fr.id);

    const apiMessages: Anthropic.MessageParam[] = [
      { role: "user", content: context },
      {
        role: "assistant",
        content:
          "Understood. I have the requirements and the transcript. What do you want to know?",
      },
      ...history.map<Anthropic.MessageParam>((m) => ({
        role: m.role === "engineer" ? "user" : "assistant",
        content: m.content,
      })),
    ];

    let assistantText = "";
    const newDraftIds: number[] = [];
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: ENGINEER_PM_SYSTEM_PROMPT,
        tools: [PROPOSE_CUSTOMER_QUESTION_TOOL],
        messages: apiMessages,
      });
      for (const block of resp.content) {
        if (block.type === "text") {
          assistantText += (assistantText ? "\n\n" : "") + block.text;
        } else if (
          block.type === "tool_use" &&
          block.name === "propose_customer_question"
        ) {
          const input = block.input as {
            question?: string;
            rationale?: string;
          };
          const q = typeof input.question === "string" ? input.question.trim() : "";
          const rationale =
            typeof input.rationale === "string" ? input.rationale.trim() : null;
          if (q) {
            const [draft] = await db
              .insert(customerQuestionDraftsTable)
              .values({
                featureRequestId: fr.id,
                taskId: task.id,
                conversationId: fr.conversationId,
                proposedByUserId: req.user!.id,
                draftContent: q,
                contextNote: rationale,
                status: "pending",
              })
              .returning();
            newDraftIds.push(draft!.id);
          }
        }
      }
    } catch (err) {
      req.log?.error({ err, taskId: id }, "AI engineer-chat call failed");
      assistantText =
        "(Sorry — I hit an error reaching the model. Please retry.)";
    }

    // Compose a fallback message if model produced only tool calls
    if (!assistantText.trim()) {
      assistantText =
        newDraftIds.length > 0
          ? "I drafted a question for the customer — it's waiting on admin review."
          : "(No reply produced.)";
    }

    const [assistantMsg] = await db
      .insert(engineeringTaskMessagesTable)
      .values({
        taskId: id,
        role: "assistant",
        content: assistantText,
        draftId: newDraftIds[0] ?? null,
      })
      .returning();

    // Touch task updatedAt
    await db
      .update(engineeringTasksTable)
      .set({ updatedAt: new Date() })
      .where(eq(engineeringTasksTable.id, id));

    const all = await db
      .select()
      .from(engineeringTaskMessagesTable)
      .where(eq(engineeringTaskMessagesTable.taskId, id))
      .orderBy(
        asc(engineeringTaskMessagesTable.createdAt),
        asc(engineeringTaskMessagesTable.id),
      );
    const authors = await userMap(all.map((m) => m.authorUserId));
    res.json(
      all.map((m) =>
        serializeTaskMessage(
          m,
          m.authorUserId ? authors.get(m.authorUserId) : undefined,
        ),
      ),
    );

    req.log?.info(
      {
        taskId: id,
        engineerMsgId: engMsg!.id,
        assistantMsgId: assistantMsg!.id,
        newDraftIds,
      },
      "Engineer chat turn",
    );
  },
);

// ────────────────────────────────────────────────────────────────────────────
// Customer question drafts (review queue)
// ────────────────────────────────────────────────────────────────────────────

router.get(
  "/feature-requests/:id/customer-question-drafts",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const rows = await db
      .select()
      .from(customerQuestionDraftsTable)
      .where(eq(customerQuestionDraftsTable.featureRequestId, id))
      .orderBy(desc(customerQuestionDraftsTable.createdAt));
    const users = await userMap([
      ...rows.map((r) => r.proposedByUserId),
      ...rows.map((r) => r.reviewedByUserId),
    ]);
    res.json(
      rows.map((d) =>
        serializeDraft(
          d,
          d.proposedByUserId ? users.get(d.proposedByUserId) : undefined,
          d.reviewedByUserId ? users.get(d.reviewedByUserId) : undefined,
        ),
      ),
    );
  },
);

router.post(
  "/customer-question-drafts/:id/approve",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [draft] = await db
      .select()
      .from(customerQuestionDraftsTable)
      .where(eq(customerQuestionDraftsTable.id, id))
      .limit(1);
    if (!draft) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (draft.status !== "pending") {
      res.status(409).json({ error: `Draft already ${draft.status}` });
      return;
    }
    const edited =
      typeof req.body?.editedContent === "string"
        ? req.body.editedContent.trim()
        : "";
    const finalContent = edited || draft.draftContent;
    if (!finalContent) {
      res.status(400).json({ error: "Cannot post an empty question" });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, draft.conversationId))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Atomically claim the draft (status='pending' -> 'approved'). If another
    // request beat us, no row updates and we abort without posting a message.
    const claimed = await db
      .update(customerQuestionDraftsTable)
      .set({
        status: "approved",
        reviewedByUserId: req.user!.id,
        reviewedAt: new Date(),
        draftContent: finalContent,
      })
      .where(
        and(
          eq(customerQuestionDraftsTable.id, id),
          eq(customerQuestionDraftsTable.status, "pending"),
        ),
      )
      .returning();
    if (claimed.length === 0) {
      res.status(409).json({ error: "Draft already reviewed" });
      return;
    }

    const [postedMsg] = await db
      .insert(messagesTable)
      .values({
        conversationId: draft.conversationId,
        role: "admin",
        content: finalContent,
        authorUserId: req.user!.id,
      })
      .returning();

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, draft.conversationId));

    const [updated] = await db
      .update(customerQuestionDraftsTable)
      .set({ postedMessageId: postedMsg!.id })
      .where(eq(customerQuestionDraftsTable.id, id))
      .returning();

    // Email the owner (mirror admin direct-post flow)
    try {
      const owner = await getUserEmail(conv.userId);
      if (
        owner?.email &&
        owner.email.toLowerCase() !== req.user!.email.toLowerCase()
      ) {
        await notifyOwnerOfAdminQuestion({
          ownerEmail: owner.email,
          ownerName: owner.name,
          adminName: req.user!.name,
          adminEmail: req.user!.email,
          conversationId: draft.conversationId,
          conversationTitle: conv.title,
          question: finalContent,
        });
      }
    } catch (err) {
      req.log?.warn({ err }, "Failed to send approved-draft email");
    }

    const users = await userMap([
      updated!.proposedByUserId,
      updated!.reviewedByUserId,
    ]);
    res.json(
      serializeDraft(
        updated!,
        updated!.proposedByUserId
          ? users.get(updated!.proposedByUserId)
          : undefined,
        updated!.reviewedByUserId
          ? users.get(updated!.reviewedByUserId)
          : undefined,
      ),
    );
  },
);

router.post(
  "/customer-question-drafts/:id/reject",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [draft] = await db
      .select()
      .from(customerQuestionDraftsTable)
      .where(eq(customerQuestionDraftsTable.id, id))
      .limit(1);
    if (!draft) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (draft.status !== "pending") {
      res.status(409).json({ error: `Draft already ${draft.status}` });
      return;
    }
    const rejected = await db
      .update(customerQuestionDraftsTable)
      .set({
        status: "rejected",
        reviewedByUserId: req.user!.id,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(customerQuestionDraftsTable.id, id),
          eq(customerQuestionDraftsTable.status, "pending"),
        ),
      )
      .returning();
    if (rejected.length === 0) {
      res.status(409).json({ error: "Draft already reviewed" });
      return;
    }
    const [updated] = rejected;
    const users = await userMap([
      updated!.proposedByUserId,
      updated!.reviewedByUserId,
    ]);
    res.json(
      serializeDraft(
        updated!,
        updated!.proposedByUserId
          ? users.get(updated!.proposedByUserId)
          : undefined,
        updated!.reviewedByUserId
          ? users.get(updated!.reviewedByUserId)
          : undefined,
      ),
    );
  },
);

export default router;
