import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  messagesTable,
  attachmentsTable,
  featureRequestsTable,
  featureRequestVersionsTable,
  usersTable,
  type Attachment,
  type Conversation,
  type Message,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  anthropic,
  MODEL,
  buildPmSystemPrompt,
  CREATE_FEATURE_REQUEST_TOOL,
  type ExistingRequestSummary,
} from "../lib/anthropic";
import {
  getAdminEmails,
  notifyAdminsOfUserReply,
  notifyOfNewRequirementsDoc,
  notifyOwnerOfResynthesis,
  getUserEmail,
} from "../lib/email";
import { composeScopeWithScreenshots } from "../lib/attachment-links";
import { proposeMergeForNewRequest } from "../lib/merge-detection";

const router: IRouter = Router();

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Anthropic hard-rejects any request whose PDF attachments total more than
// 100 pages ("A maximum of 100 PDF pages may be provided"). Without a guard,
// one oversized PDF permanently breaks its conversation: every subsequent
// message re-sends all attachments and gets a 400 back.
const MAX_PDF_PAGES = 100;

async function countPdfPages(dataBase64: string): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(Buffer.from(dataBase64, "base64"), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

function serializeAttachment(a: Attachment) {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeMessage(
  m: Message,
  atts: Attachment[],
  authorName: string | null = null,
) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    authorName,
    createdAt: m.createdAt.toISOString(),
    attachments: atts.map(serializeAttachment),
  };
}

function serializeConversationSummary(
  c: Conversation,
  messageCount: number,
) {
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    minor: c.minor,
    featureRequestId: c.featureRequestId ?? null,
    messageCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

async function loadFullConversation(conversationId: number) {
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  if (!conv) return null;

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));

  const attachments = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.conversationId, conversationId))
    .orderBy(asc(attachmentsTable.createdAt));

  // Resolve author display names for admin messages
  const authorIds = Array.from(
    new Set(
      messages.map((m) => m.authorUserId).filter((v): v is string => !!v),
    ),
  );
  const authors =
    authorIds.length === 0
      ? []
      : await db
          .select()
          .from(usersTable)
          .where(inArray(usersTable.id, authorIds));
  const authorById = new Map(authors.map((u) => [u.id, u]));

  const byMessage = new Map<number, Attachment[]>();
  const pending: Attachment[] = [];
  for (const a of attachments) {
    if (a.messageId == null) {
      pending.push(a);
    } else {
      const arr = byMessage.get(a.messageId) ?? [];
      arr.push(a);
      byMessage.set(a.messageId, arr);
    }
  }

  return {
    id: conv.id,
    title: conv.title,
    status: conv.status,
    minor: conv.minor,
    featureRequestId: conv.featureRequestId ?? null,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    messages: messages.map((m) => {
      const author = m.authorUserId
        ? authorById.get(m.authorUserId)
        : undefined;
      const authorName = author
        ? author.name || author.email || null
        : null;
      return serializeMessage(m, byMessage.get(m.id) ?? [], authorName);
    }),
    pendingAttachments: pending.map(serializeAttachment),
  };
}

// Exposed so the admin router can reuse it.
export { loadFullConversation };

router.get("/conversations", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const rows = await db
    .select({
      conv: conversationsTable,
      messageCount: sql<number>`count(${messagesTable.id})::int`,
    })
    .from(conversationsTable)
    .leftJoin(
      messagesTable,
      eq(messagesTable.conversationId, conversationsTable.id),
    )
    .where(eq(conversationsTable.userId, userId))
    .groupBy(conversationsTable.id)
    .orderBy(desc(conversationsTable.updatedAt));

  res.json(rows.map((r) => serializeConversationSummary(r.conv, r.messageCount)));
});

router.post("/conversations", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const minor = (req.body as { minor?: unknown } | undefined)?.minor === true;
  const [created] = await db
    .insert(conversationsTable)
    .values({ userId, minor })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Failed to create conversation" });
    return;
  }

  // Insert greeting from assistant
  const greeting = minor
    ? "Hi — quick one, got it. Tell me what's broken or what you'd like changed, in a sentence or two. If you have a screenshot, error message, or example handy, attach it and I'll fold it in — otherwise just describe it and I'll file it right away."
    : "Hi — I'm your product partner here. Tell me about a feature you'd like Pulse to build. Who is it for, and what problem are you trying to solve? Feel free to attach any sketches, screenshots, spreadsheets, or docs that help.";
  await db.insert(messagesTable).values({
    conversationId: created.id,
    role: "assistant",
    content: greeting,
  });

  const full = await loadFullConversation(created.id);
  res.status(201).json(full);
});

async function ensureOwnedConversation(req: Request, res: Response, id: number) {
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id))
    .limit(1);
  if (!conv || conv.userId !== req.user!.id) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return conv;
}

router.get("/conversations/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const owned = await ensureOwnedConversation(req, res, id);
  if (!owned) return;
  const full = await loadFullConversation(id);
  res.json(full);
});

router.post("/conversations/:id/attachments", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const owned = await ensureOwnedConversation(req, res, id);
  if (!owned) return;

  const { filename, mimeType, dataBase64 } = req.body ?? {};
  if (
    typeof filename !== "string" ||
    typeof mimeType !== "string" ||
    typeof dataBase64 !== "string" ||
    !filename ||
    !mimeType ||
    !dataBase64
  ) {
    res.status(400).json({ error: "Invalid attachment payload" });
    return;
  }
  // Approx decoded size
  const sizeBytes = Math.floor((dataBase64.length * 3) / 4);
  if (sizeBytes > MAX_FILE_BYTES) {
    res.status(413).json({ error: "File too large (max 5 MB)" });
    return;
  }

  // Reject single PDFs the model can never read — clearer to fail here with a
  // real reason than to break the chat later with a generic model error.
  if (mimeType === "application/pdf") {
    const pages = await countPdfPages(dataBase64);
    if (pages != null && pages > MAX_PDF_PAGES) {
      res.status(400).json({
        error: `This PDF has ${pages} pages — the AI can only read up to ${MAX_PDF_PAGES} PDF pages per conversation. Please attach a shorter excerpt with the relevant pages.`,
      });
      return;
    }
  }

  const [created] = await db
    .insert(attachmentsTable)
    .values({
      conversationId: id,
      filename,
      mimeType,
      sizeBytes,
      dataBase64,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Failed to save attachment" });
    return;
  }

  res.status(201).json(serializeAttachment(created));
});

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: string; data: string };
    };

function attachmentToBlocks(
  a: Attachment,
  omitPdf = false,
): AnthropicContentBlock[] {
  if (a.mimeType.startsWith("image/")) {
    return [
      {
        type: "image",
        source: { type: "base64", media_type: a.mimeType, data: a.dataBase64 },
      },
      { type: "text", text: `(Attached image: ${a.filename})` },
    ];
  }
  if (a.mimeType === "application/pdf") {
    if (omitPdf) {
      return [
        {
          type: "text",
          text: `(Attached PDF: ${a.filename} — its contents are not visible to you because the conversation's PDF attachments exceed the ${MAX_PDF_PAGES}-page model limit. If you need details from it, ask the user to paste the relevant excerpts as text.)`,
        },
      ];
    }
    return [
      {
        type: "document",
        source: { type: "base64", media_type: a.mimeType, data: a.dataBase64 },
      },
      { type: "text", text: `(Attached PDF: ${a.filename})` },
    ];
  }
  // Text-like fallback: decode base64 and inline as text
  try {
    const decoded = Buffer.from(a.dataBase64, "base64").toString("utf8");
    const truncated =
      decoded.length > 60000 ? decoded.slice(0, 60000) + "\n…[truncated]" : decoded;
    return [
      {
        type: "text",
        text: `(Attached file: ${a.filename}, type ${a.mimeType})\n\n${truncated}`,
      },
    ];
  } catch {
    return [
      {
        type: "text",
        text: `(Attached file: ${a.filename}, type ${a.mimeType} — binary content not previewable)`,
      },
    ];
  }
}

async function buildAnthropicMessages(conversationId: number) {
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));

  const allAttachments = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.conversationId, conversationId));

  const byMsg = new Map<number, Attachment[]>();
  for (const a of allAttachments) {
    if (a.messageId == null) continue;
    const arr = byMsg.get(a.messageId) ?? [];
    arr.push(a);
    byMsg.set(a.messageId, arr);
  }

  // Resolve admin display names for prefixing
  const adminIds = Array.from(
    new Set(
      messages
        .filter((m) => m.role === "admin")
        .map((m) => m.authorUserId)
        .filter((v): v is string => !!v),
    ),
  );
  const admins =
    adminIds.length === 0
      ? []
      : await db
          .select()
          .from(usersTable)
          .where(inArray(usersTable.id, adminIds));
  const adminById = new Map(admins.map((u) => [u.id, u]));

  // Budget PDF pages across the whole conversation (Anthropic caps a request
  // at MAX_PDF_PAGES total PDF pages). PDFs are kept in chronological order
  // until the budget runs out; the rest are replaced with a text note so the
  // request still succeeds and the model knows what it can't see.
  const pdfOmitted = new Set<number>();
  let pdfPagesUsed = 0;
  for (const m of messages) {
    for (const a of byMsg.get(m.id) ?? []) {
      if (a.mimeType !== "application/pdf") continue;
      const pages = await countPdfPages(a.dataBase64);
      if (pages == null) continue; // unparseable — keep legacy behavior
      if (pdfPagesUsed + pages > MAX_PDF_PAGES) {
        pdfOmitted.add(a.id);
      } else {
        pdfPagesUsed += pages;
      }
    }
  }
  if (pdfOmitted.size > 0) {
    logger.warn(
      {
        conversationId,
        omittedAttachmentIds: Array.from(pdfOmitted),
        pdfPagesUsed,
      },
      "PDF page budget exceeded — omitting PDFs from model context",
    );
  }

  return messages.map((m) => {
    const blocks: AnthropicContentBlock[] = [];
    const atts = byMsg.get(m.id) ?? [];
    for (const a of atts)
      blocks.push(...attachmentToBlocks(a, pdfOmitted.has(a.id)));

    if (m.role === "admin") {
      const author = m.authorUserId ? adminById.get(m.authorUserId) : undefined;
      const who = author ? author.name || author.email : "Admin";
      blocks.push({
        type: "text",
        text: `[Clarifying question from ${who} (ScopeBot admin) — please incorporate this into your scoping. The user will respond next.]\n\n${m.content}`,
      });
      // Anthropic only accepts user/assistant — surface admin notes as user turns.
      return { role: "user" as const, content: blocks };
    }

    if (m.content) blocks.push({ type: "text", text: m.content });
    if (blocks.length === 0) blocks.push({ type: "text", text: "" });
    return {
      role: m.role as "user" | "assistant",
      content: blocks,
    };
  });
}

// Exposed so the admin router can reuse it.
export { buildAnthropicMessages };

router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const owned = await ensureOwnedConversation(req, res, id);
  if (!owned) return;
  const wasFinalized = owned.status === "finalized";

  const { content, attachmentIds } = req.body ?? {};
  const hasAttachments =
    Array.isArray(attachmentIds) && attachmentIds.length > 0;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content required" });
    return;
  }
  if (content.trim().length === 0 && !hasAttachments) {
    res.status(400).json({ error: "Send a message or attach a file" });
    return;
  }
  const messageContent =
    content.trim().length === 0 ? "(attached files)" : content;

  const [userMsg] = await db
    .insert(messagesTable)
    .values({ conversationId: id, role: "user", content: messageContent })
    .returning();
  if (!userMsg) {
    res.status(500).json({ error: "Failed to save message" });
    return;
  }

  const ids = Array.isArray(attachmentIds)
    ? attachmentIds.filter((n) => typeof n === "number")
    : [];
  if (ids.length > 0) {
    await db
      .update(attachmentsTable)
      .set({ messageId: userMsg.id })
      .where(
        and(
          eq(attachmentsTable.conversationId, id),
          isNull(attachmentsTable.messageId),
          inArray(attachmentsTable.id, ids),
        ),
      );
  }

  // If this is the first user message, set the conversation title from it
  if (owned.title === "New conversation") {
    const trimmed =
      content.trim().slice(0, 80) || `Conversation #${id}`;
    await db
      .update(conversationsTable)
      .set({ title: trimmed, updatedAt: new Date() })
      .where(eq(conversationsTable.id, id));
  }

  // Call Claude — make the create_feature_request tool available so the bot
  // can finalize the spec on its own when it has enough information.
  const aMessages = await buildAnthropicMessages(id);
  let assistantText = "";
  let toolUse:
    | { id: string; input: Record<string, unknown> }
    | null = null;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      // 16384 — full scope docs are long and we were silently truncating
      // tool_use args (scope coming back as ""), producing empty PRDs.
      max_tokens: 16384,
      system: wasFinalized
        ? `${buildPmSystemPrompt(await loadExistingRequestContext(id), { minor: owned.minor })}\n\n[Note: this conversation was already finalized. The user is now answering follow-up clarifying questions. Reply briefly acknowledging their answer; do NOT call the create_feature_request tool — the requirements doc will be re-synthesized automatically.]`
        : buildPmSystemPrompt(await loadExistingRequestContext(id), {
            minor: owned.minor,
          }),
      tools: wasFinalized ? undefined : [CREATE_FEATURE_REQUEST_TOOL],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: aMessages as any,
    });
    assistantText = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const tu = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (tu && tu.name === CREATE_FEATURE_REQUEST_TOOL.name) {
      const input = tu.input as Record<string, unknown>;
      // Guard: a truncated max_tokens response can leave required fields
      // empty (we've seen `scope: ""`). Refuse to persist a half-PRD —
      // ask the user to retry instead, so we don't silently save garbage.
      const issue = validateToolInput(input, resp.stop_reason);
      if (issue) {
        req.log?.error(
          { stopReason: resp.stop_reason, issue, conversationId: id },
          "Chat tool_use rejected — incomplete PRD",
        );
        assistantText =
          assistantText ||
          "I started writing up the requirements but the response got cut off. Please send one more message (or click Finalize) to retry.";
      } else {
        toolUse = { id: tu.id, input };
      }
    }
    if (!assistantText && !toolUse) assistantText = "(no response)";
  } catch (err) {
    req.log?.error({ err }, "Anthropic call failed");
    assistantText =
      "I hit a snag reaching the model. Could you try sending that again?";
  }

  if (toolUse) {
    const result = await applyFeatureRequestTool({
      conversationId: id,
      userId: req.user!.id,
      input: toolUse.input,
      log: req.log,
    });
    if (result.ok) {
      const note =
        assistantText ||
        "I've got everything I need — I've written up the requirements doc for you.";
      await db.insert(messagesTable).values({
        conversationId: id,
        role: "assistant",
        content: `${note}\n\n✅ Created feature request: **${result.fr.title}**`,
      });
    } else {
      await db.insert(messagesTable).values({
        conversationId: id,
        role: "assistant",
        content:
          "I tried to write up the requirements but hit an error saving them. Could you click Finalize again in a moment?",
      });
    }
  } else {
    await db.insert(messagesTable).values({
      conversationId: id,
      role: "assistant",
      content: assistantText,
    });
  }

  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, id));

  // If we're in a post-finalize Q&A loop, re-synthesize the requirements doc
  // so admin clarifying questions and the user's answers actually feed back
  // into the spec, then notify admins that the owner replied.
  if (wasFinalized) {
    let resynthOk = false;
    let frForNotice: typeof featureRequestsTable.$inferSelect | null = null;
    try {
      const r = await resynthesizeForConversation({
        conversationId: id,
        actorUserId: req.user!.id,
        log: req.log,
        reason: "User replied after admin clarification",
      });
      if (r.ok) {
        resynthOk = true;
        frForNotice = r.fr;
      }
    } catch (err) {
      req.log?.error({ err }, "Auto re-synthesis failed");
    }

    // Notify admins (excluding the owner if they happen to be an admin) that
    // there's new content on a finalized request.
    try {
      if (!frForNotice) {
        const [fr0] = await db
          .select()
          .from(featureRequestsTable)
          .where(eq(featureRequestsTable.conversationId, id))
          .limit(1);
        frForNotice = fr0 ?? null;
      }
      if (frForNotice) {
        const adminEmails = (await getAdminEmails()).filter(
          (e) => e !== req.user!.email.toLowerCase(),
        );
        if (adminEmails.length > 0) {
          await notifyAdminsOfUserReply({
            adminEmails,
            ownerName: req.user!.name,
            ownerEmail: req.user!.email,
            featureRequestId: frForNotice.id,
            featureRequestTitle: frForNotice.title,
            message: messageContent,
          });
        }
      }
    } catch (err) {
      req.log?.warn({ err }, "Failed to send admin-notification email");
    }

    // If auto-resynthesis succeeded, also email the owner that the doc updated
    // (skipped automatically when the owner is the actor).
    if (resynthOk && frForNotice) {
      try {
        await notifyOwnerOfResynthesis({
          ownerEmail: req.user!.email,
          ownerName: req.user!.name,
          featureRequestId: frForNotice.id,
          featureRequestTitle: frForNotice.title,
          reason: "Auto re-synthesized after follow-up message",
          triggeredByUserId: req.user!.id,
          ownerUserId: frForNotice.userId,
        });
      } catch (err) {
        req.log?.warn({ err }, "Failed to send owner-resynth email");
      }
    }
  }

  const full = await loadFullConversation(id);
  res.json(full);
});

router.post("/conversations/:id/finalize", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const owned = await ensureOwnedConversation(req, res, id);
  if (!owned) return;

  // If a feature request already exists for this conversation, return it (idempotent).
  const [existing] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.conversationId, id))
    .limit(1);
  if (existing) {
    res
      .status(200)
      .json(
        serializeFeatureRequest(
          existing,
          req.user!.email,
          req.user!.name,
          !!req.user!.isAdmin,
        ),
      );
    return;
  }

  const aMessages = await buildAnthropicMessages(id);
  if (aMessages.length === 0) {
    res.status(400).json({ error: "Nothing to finalize" });
    return;
  }

  // Force Claude to call the create_feature_request tool.
  let toolInput: Record<string, unknown> | null = null;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16384,
      system: buildPmSystemPrompt(await loadExistingRequestContext(id), {
        minor: owned.minor,
      }),
      tools: [CREATE_FEATURE_REQUEST_TOOL],
      tool_choice: {
        type: "tool",
        name: CREATE_FEATURE_REQUEST_TOOL.name,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: aMessages as any,
    });
    const tu = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!tu) {
      req.log?.error({ resp }, "Finalize: model did not call the tool");
      res.status(502).json({ error: "Could not synthesize requirements" });
      return;
    }
    const candidate = tu.input as Record<string, unknown>;
    const issue = validateToolInput(candidate, resp.stop_reason);
    if (issue) {
      req.log?.error(
        { stopReason: resp.stop_reason, issue, conversationId: id },
        "Finalize: incomplete PRD from model",
      );
      res.status(502).json({
        error: `Could not synthesize requirements: ${issue}. Please try again.`,
      });
      return;
    }
    toolInput = candidate;
  } catch (err) {
    req.log?.error({ err }, "Finalize failed");
    res.status(502).json({ error: "Could not synthesize requirements" });
    return;
  }

  const result = await applyFeatureRequestTool({
    conversationId: id,
    userId: req.user!.id,
    input: toolInput,
    log: req.log,
  });
  if (!result.ok) {
    res.status(500).json({ error: "Failed to create feature request" });
    return;
  }

  res
    .status(201)
    .json(
      serializeFeatureRequest(
        result.fr,
        req.user!.email,
        req.user!.name,
        !!req.user!.isAdmin,
      ),
    );
});

// Load the image attachments for a conversation (oldest first) so we can embed
// them as public, inline screenshots in the generated PRD.
async function loadConversationImages(
  conversationId: number,
): Promise<{ id: number; filename: string }[]> {
  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.conversationId, conversationId));
  return rows
    .filter((a) => a.mimeType.toLowerCase().startsWith("image/"))
    .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
    .map((a) => ({ id: a.id, filename: a.filename }));
}

// Shared: persist a feature request from the tool input and finalize the
// conversation. Idempotent — if a feature request already exists for this
// conversation we return it instead of inserting a duplicate.
async function applyFeatureRequestTool(args: {
  conversationId: number;
  userId: string;
  input: Record<string, unknown>;
  log?: Request["log"];
}): Promise<
  | { ok: true; fr: typeof featureRequestsTable.$inferSelect }
  | { ok: false }
> {
  const { conversationId, userId, input, log } = args;

  const [conv] = await db
    .select({ minor: conversationsTable.minor })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1);
  const minor = conv?.minor ?? false;

  const [existing] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.conversationId, conversationId))
    .limit(1);
  if (existing) {
    await db
      .update(conversationsTable)
      .set({
        status: "finalized",
        featureRequestId: existing.id,
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, conversationId));
    return { ok: true, fr: existing };
  }

  const priorityRaw = String(input.priority ?? "medium");
  const priority: "low" | "medium" | "high" =
    priorityRaw === "low" || priorityRaw === "high" ? priorityRaw : "medium";

  const { relatedRequestIds, clusterRationale } = extractClusterFields(input);

  const scopeWithScreenshots = composeScopeWithScreenshots(
    String(input.scope ?? ""),
    await loadConversationImages(conversationId),
  );

  let fr: typeof featureRequestsTable.$inferSelect | undefined;
  try {
    const inserted = await db
      .insert(featureRequestsTable)
      .values({
        userId,
        conversationId,
        title: String(input.title ?? "Untitled feature").slice(0, 200),
        summary: String(input.summary ?? ""),
        problem: String(input.problem ?? ""),
        benefits: String(input.benefits ?? ""),
        currentSpend: String(input.currentSpend ?? ""),
        scope: scopeWithScreenshots,
        priority,
        status: "requested",
        minor,
        relatedRequestIds,
        clusterRationale,
      })
      .returning();
    fr = inserted[0];
  } catch (err) {
    // Concurrent call raced us — return the winner.
    const [raced] = await db
      .select()
      .from(featureRequestsTable)
      .where(eq(featureRequestsTable.conversationId, conversationId))
      .limit(1);
    if (raced) {
      await db
        .update(conversationsTable)
        .set({
          status: "finalized",
          featureRequestId: raced.id,
          updatedAt: new Date(),
        })
        .where(eq(conversationsTable.id, conversationId));
      return { ok: true, fr: raced };
    }
    log?.error({ err }, "applyFeatureRequestTool insert failed");
    return { ok: false };
  }
  if (!fr) return { ok: false };

  await db
    .update(conversationsTable)
    .set({
      status: "finalized",
      featureRequestId: fr.id,
      title: fr.title,
      updatedAt: new Date(),
    })
    .where(eq(conversationsTable.id, conversationId));

  await snapshotVersion(fr, userId, "Initial scope", 1);

  // Email: notify owner + admins that a new requirements doc was created.
  // Fire-and-forget; never block finalization on email delivery.
  try {
    const [adminEmails, owner] = await Promise.all([
      getAdminEmails(),
      getUserEmail(userId),
    ]);
    if (owner) {
      await notifyOfNewRequirementsDoc({
        adminEmails,
        ownerEmail: owner.email,
        ownerName: owner.name,
        featureRequestId: fr.id,
        featureRequestTitle: fr.title,
        summary: fr.summary,
        priority: fr.priority,
      });
    }
  } catch (err) {
    log?.warn({ err, featureRequestId: fr.id }, "new-doc email notification failed");
  }

  // Admin-only duplicate-PRD detection. Fire-and-forget — never block or fail
  // finalization on it, and never expose anything to the requesting customer.
  void proposeMergeForNewRequest({ newFr: fr, log }).catch((err) =>
    log?.warn({ err, featureRequestId: fr!.id }, "merge detection failed"),
  );

  return { ok: true, fr };
}

async function snapshotVersion(
  fr: typeof featureRequestsTable.$inferSelect,
  createdByUserId: string | null,
  changeReason: string,
  versionNumber?: number,
) {
  // Compute the next version number atomically inside the INSERT to avoid
  // a race between two concurrent re-synthesis calls (manual + auto).
  // The unique index on (feature_request_id, version_number) is the ultimate
  // safety net — if we still race, we retry once.
  const versionExpr =
    versionNumber !== undefined
      ? sql`${versionNumber}`
      : sql`COALESCE((SELECT MAX(version_number) FROM feature_request_versions WHERE feature_request_id = ${fr.id}), 0) + 1`;
  const insertSql = sql`
    INSERT INTO feature_request_versions
      (feature_request_id, version_number, title, summary, problem, benefits,
       current_spend, scope, priority, change_reason, created_by_user_id)
    SELECT
      ${fr.id},
      ${versionExpr},
      ${fr.title},
      ${fr.summary},
      ${fr.problem},
      ${fr.benefits},
      ${fr.currentSpend},
      ${fr.scope},
      ${fr.priority}::feature_request_priority,
      ${changeReason},
      ${createdByUserId}
  `;
  try {
    await db.execute(insertSql);
  } catch (err) {
    if (versionNumber === undefined) {
      await db.execute(insertSql);
    } else {
      throw err;
    }
  }
}

export { snapshotVersion };

// Re-run the model on the full conversation (incl. admin clarifying questions
// and user replies) and update the existing feature request in place. Records
// a new version row.
export async function resynthesizeForConversation(args: {
  conversationId: number;
  actorUserId: string | null;
  log?: Request["log"];
  reason: string;
}): Promise<
  | { ok: true; fr: typeof featureRequestsTable.$inferSelect }
  | { ok: false; reason: string }
> {
  const { conversationId, actorUserId, log, reason } = args;

  const [fr] = await db
    .select()
    .from(featureRequestsTable)
    .where(eq(featureRequestsTable.conversationId, conversationId))
    .limit(1);
  if (!fr) return { ok: false, reason: "No feature request to update" };

  const aMessages = await buildAnthropicMessages(conversationId);
  if (aMessages.length === 0)
    return { ok: false, reason: "Empty conversation" };

  let toolInput: Record<string, unknown> | null = null;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16384,
      system: `${buildPmSystemPrompt(await loadExistingRequestContext(conversationId), { minor: fr.minor })}\n\n[Re-synthesis: an existing requirements doc was already produced for this conversation. Read the entire transcript including any admin clarifying questions and the user's replies. Produce an UPDATED requirements doc that fully incorporates all new information. Keep the same general direction; expand or correct sections where the new exchanges add detail. You MUST call the create_feature_request tool — do not reply with text.]`,
      tools: [CREATE_FEATURE_REQUEST_TOOL],
      tool_choice: { type: "tool", name: CREATE_FEATURE_REQUEST_TOOL.name },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: aMessages as any,
    });
    const tu = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!tu) {
      log?.error({ resp }, "Re-synthesis: model did not call the tool");
      return { ok: false, reason: "Model did not produce a spec" };
    }
    const candidate = tu.input as Record<string, unknown>;
    const issue = validateToolInput(candidate, resp.stop_reason);
    if (issue) {
      log?.error(
        { stopReason: resp.stop_reason, issue, conversationId },
        "Re-synthesis: incomplete PRD from model — refusing to overwrite",
      );
      return {
        ok: false,
        reason: `Model returned an incomplete spec (${issue}). The existing doc was left unchanged.`,
      };
    }
    toolInput = candidate;
  } catch (err) {
    log?.error({ err }, "Re-synthesis: model call failed");
    return { ok: false, reason: "Model call failed" };
  }

  const priorityRaw = String(toolInput.priority ?? fr.priority);
  const priority: "low" | "medium" | "high" =
    priorityRaw === "low" || priorityRaw === "high"
      ? priorityRaw
      : priorityRaw === "medium"
        ? "medium"
        : fr.priority;

  // Use `nonEmpty` everywhere — `??` only catches null/undefined, so without
  // this an empty-string field from the model would wipe out the prior
  // value (exactly the bug that produced empty-scope PRDs).
  const cluster = extractClusterFields(toolInput);
  const scopeWithScreenshots = composeScopeWithScreenshots(
    nonEmpty(toolInput.scope, fr.scope),
    await loadConversationImages(conversationId),
  );
  const [updated] = await db
    .update(featureRequestsTable)
    .set({
      title: nonEmpty(toolInput.title, fr.title).slice(0, 200),
      summary: nonEmpty(toolInput.summary, fr.summary),
      problem: nonEmpty(toolInput.problem, fr.problem),
      benefits: nonEmpty(toolInput.benefits, fr.benefits),
      currentSpend: nonEmpty(toolInput.currentSpend, fr.currentSpend),
      scope: scopeWithScreenshots,
      priority,
      // Keep the prior cluster signal if the model omitted it this round
      // rather than nulling out useful admin metadata.
      relatedRequestIds:
        cluster.relatedRequestIds ?? fr.relatedRequestIds ?? null,
      clusterRationale:
        cluster.clusterRationale ?? fr.clusterRationale ?? null,
      updatedAt: new Date(),
    })
    .where(eq(featureRequestsTable.id, fr.id))
    .returning();
  if (!updated) return { ok: false, reason: "DB update failed" };

  await snapshotVersion(updated, actorUserId, reason);
  return { ok: true, fr: updated };
}

export function serializeFeatureRequest(
  fr: typeof featureRequestsTable.$inferSelect,
  email: string,
  name: string | null,
  // Admin-only fields below are gated. Callers MUST pass true only when the
  // viewer is an admin — otherwise these are nulled out so the response is
  // safe to send to the requesting customer. The OpenAPI contract still
  // marks them nullable, so the shape is stable.
  isAdmin: boolean = false,
) {
  return {
    id: fr.id,
    userId: fr.userId,
    userEmail: email,
    userName: name,
    title: fr.title,
    summary: fr.summary,
    problem: fr.problem,
    benefits: fr.benefits,
    currentSpend: fr.currentSpend,
    scope: fr.scope,
    status: fr.status,
    priority: fr.priority,
    createdAt: fr.createdAt.toISOString(),
    updatedAt: fr.updatedAt.toISOString(),
    conversationId: fr.conversationId,
    minor: fr.minor,
    // Admin-only: AI ranking signal may reference other customers' requests
    // or internal strategy in the rationale. Hide from non-admin viewers.
    aiPriorityRank: isAdmin ? fr.aiPriorityRank ?? null : null,
    aiPriorityRationale: isAdmin ? fr.aiPriorityRationale ?? null : null,
    aiPriorityGeneratedAt:
      isAdmin && fr.aiPriorityGeneratedAt
        ? fr.aiPriorityGeneratedAt.toISOString()
        : null,
    // Admin-only: clustering signal flags neighboring requests by id and
    // names them in the rationale. Never expose to the requesting customer.
    relatedRequestIds: isAdmin ? fr.relatedRequestIds ?? null : null,
    clusterRationale: isAdmin ? fr.clusterRationale ?? null : null,
    // Admin-only: manual rank an admin set when moving the request into
    // "Planned". Used to order the agent-facing backlog feed.
    adminPriorityRank: isAdmin ? fr.adminPriorityRank ?? null : null,
    // Admin-only: Paperclip integration snapshot. paperclipIssueId is the
    // idempotency key for the push loop; the rest is refreshed every
    // minute by the poll loop.
    paperclipIssueId: isAdmin ? fr.paperclipIssueId ?? null : null,
    paperclipIdentifier: isAdmin ? fr.paperclipIdentifier ?? null : null,
    paperclipStatus: isAdmin ? fr.paperclipStatus ?? null : null,
    paperclipPushedAt:
      isAdmin && fr.paperclipPushedAt
        ? fr.paperclipPushedAt.toISOString()
        : null,
    paperclipLastSyncedAt:
      isAdmin && fr.paperclipLastSyncedAt
        ? fr.paperclipLastSyncedAt.toISOString()
        : null,
    paperclipPushError: isAdmin ? fr.paperclipPushError ?? null : null,
    // Admin-only: engineering routing destination + Notion mirror snapshot.
    // engineeringOwner is the per-ticket choice ("agent" → Paperclip, "human"
    // → Notion); the notion* fields mirror the human-routed Notion page.
    engineeringOwner: isAdmin ? fr.engineeringOwner ?? null : null,
    notionPageId: isAdmin ? fr.notionPageId ?? null : null,
    notionUrl: isAdmin ? fr.notionUrl ?? null : null,
    notionStatus: isAdmin ? fr.notionStatus ?? null : null,
    notionAssignee: isAdmin ? fr.notionAssignee ?? null : null,
    notionPushedAt:
      isAdmin && fr.notionPushedAt ? fr.notionPushedAt.toISOString() : null,
    notionLastSyncedAt:
      isAdmin && fr.notionLastSyncedAt
        ? fr.notionLastSyncedAt.toISOString()
        : null,
    notionPushError: isAdmin ? fr.notionPushError ?? null : null,
  };
}

// Pull and sanitize the admin-only clustering signal from the model's tool
// call. We accept arrays of plausible integer ids and strip anything else;
// the result is intentionally nullable so callers can preserve a prior value
// when the model omits it.
function extractClusterFields(
  input: Record<string, unknown>,
): { relatedRequestIds: number[] | null; clusterRationale: string | null } {
  let relatedRequestIds: number[] | null = null;
  if (Array.isArray(input.relatedRequestIds)) {
    const ids = input.relatedRequestIds
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    relatedRequestIds = Array.from(new Set(ids));
  }
  const clusterRationale =
    typeof input.clusterRationale === "string" && input.clusterRationale.trim()
      ? input.clusterRationale.trim()
      : null;
  return { relatedRequestIds, clusterRationale };
}

// Coerce a tool-input field to a non-empty trimmed string, falling back
// to the prior value if missing or blank. `??` alone isn't enough — it
// only catches null/undefined, so a literal `""` from a truncated model
// response would silently wipe a previously-good field.
function nonEmpty(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
}

// Validate that a create_feature_request tool call from the model is
// actually a complete PRD. Returns a human-readable issue string if not,
// or null if it's good to persist. We've seen `scope: ""` come back when
// max_tokens truncates the tool_use args — those PRDs are unusable and
// must NOT be saved (or, for re-synth, must NOT overwrite the prior doc).
function validateToolInput(
  input: Record<string, unknown>,
  stopReason: string | null | undefined,
): string | null {
  const required: Array<keyof typeof input> = [
    "title",
    "summary",
    "problem",
    "benefits",
    "currentSpend",
    "scope",
  ];
  const empty = required.filter((k) => {
    const v = input[k];
    return typeof v !== "string" || v.trim().length === 0;
  });
  if (empty.length > 0) {
    const suffix =
      stopReason === "max_tokens"
        ? " (response was truncated by max_tokens)"
        : "";
    return `missing or empty field(s): ${empty.join(", ")}${suffix}`;
  }
  if (stopReason === "max_tokens") {
    // All required fields are non-empty but the response was cut off —
    // tail content (e.g. trailing list items in scope) may be missing.
    // Still better than nothing; log a warning but accept.
  }
  return null;
}

// Pull a compact view of the existing backlog (excluding the conversation we
// are currently scoping) so the PM model can ask informed prioritisation
// questions and avoid duplicates.
async function loadExistingRequestContext(
  excludeConversationId: number,
): Promise<ExistingRequestSummary[]> {
  const rows = await db
    .select({
      id: featureRequestsTable.id,
      title: featureRequestsTable.title,
      summary: featureRequestsTable.summary,
      status: featureRequestsTable.status,
      priority: featureRequestsTable.priority,
      conversationId: featureRequestsTable.conversationId,
    })
    .from(featureRequestsTable)
    .orderBy(desc(featureRequestsTable.updatedAt))
    .limit(60);
  return rows
    .filter((r) => r.conversationId !== excludeConversationId)
    .map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      status: r.status,
      priority: r.priority,
    }));
}

export default router;

// Anthropic SDK types
import type Anthropic from "@anthropic-ai/sdk";
