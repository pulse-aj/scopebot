import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  emailCampaignsTable,
  emailCampaignRecipientsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { appBaseUrl, sendEmailStrict } from "../lib/email";

const router: IRouter = Router();

// ---- public tracking pixel: NO auth required, mounted first ----

// 1x1 transparent GIF
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);

router.get("/email/track/:token.gif", async (req, res) => {
  const token = req.params.token;
  // Always respond with the pixel — never fail the user's mail client.
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": String(TRACKING_PIXEL.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.status(200).end(TRACKING_PIXEL);

  // Record the open in the background. Failures here must not crash the
  // pixel response.
  if (!token || typeof token !== "string") return;
  try {
    const ua = (req.get("user-agent") || "").slice(0, 500);
    const now = new Date();
    const [recipient] = await db
      .select({
        id: emailCampaignRecipientsTable.id,
        campaignId: emailCampaignRecipientsTable.campaignId,
        openedAt: emailCampaignRecipientsTable.openedAt,
      })
      .from(emailCampaignRecipientsTable)
      .where(eq(emailCampaignRecipientsTable.trackingId, token))
      .limit(1);
    if (!recipient) return;

    await db
      .update(emailCampaignRecipientsTable)
      .set({
        openCount: sql`${emailCampaignRecipientsTable.openCount} + 1`,
        lastOpenedAt: now,
        lastUserAgent: ua,
        openedAt: recipient.openedAt ?? now,
      })
      .where(eq(emailCampaignRecipientsTable.id, recipient.id));
  } catch (err) {
    req.log?.warn({ err, token }, "Failed to record email open");
  }
});

// ---- admin-only CRUD ----

interface AudiencePayload {
  audience: "all_users" | "non_admins" | "admins" | "specific";
  specificEmails?: string[] | null;
}

function normalizeSpecificEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const email = raw.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    seen.add(email);
  }
  return Array.from(seen);
}

async function resolveAudience(payload: AudiencePayload): Promise<
  Array<{ email: string; userId: string | null }>
> {
  if (payload.audience === "specific") {
    const emails = normalizeSpecificEmails(payload.specificEmails);
    if (emails.length === 0) return [];
    const matched = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable);
    const byEmail = new Map(
      matched.map((u) => [u.email.toLowerCase(), u.id] as const),
    );
    return emails.map((email) => ({
      email,
      userId: byEmail.get(email) ?? null,
    }));
  }

  const allUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      isAdmin: usersTable.isAdmin,
    })
    .from(usersTable);

  const filtered = allUsers.filter((u) => {
    if (!u.email) return false;
    if (payload.audience === "all_users") return true;
    if (payload.audience === "admins") return u.isAdmin;
    if (payload.audience === "non_admins") return !u.isAdmin;
    return false;
  });

  // Deduplicate by email (case-insensitive) — multiple Clerk accounts
  // sharing an email would otherwise get duplicate copies.
  const dedup = new Map<string, { email: string; userId: string | null }>();
  for (const u of filtered) {
    const key = u.email.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, { email: u.email, userId: u.id });
    }
  }
  return Array.from(dedup.values());
}


function buildHtmlForRecipient(htmlBody: string, trackingId: string): string {
  const pixelUrl = `${appBaseUrl()}/api/email/track/${trackingId}.gif`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none;" />`;
  if (/<\/body\s*>/i.test(htmlBody)) {
    return htmlBody.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }
  return `${htmlBody}\n${pixel}`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface CampaignBody {
  subject?: unknown;
  preheader?: unknown;
  htmlBody?: unknown;
  audience?: unknown;
  specificEmails?: unknown;
}

function parseCampaignBody(body: CampaignBody, isCreate: boolean):
  | { ok: true; value: {
      subject?: string;
      preheader?: string | null;
      htmlBody?: string;
      audience?: AudiencePayload["audience"];
      specificEmails?: string[] | null;
    } }
  | { ok: false; error: string } {
  const out: {
    subject?: string;
    preheader?: string | null;
    htmlBody?: string;
    audience?: AudiencePayload["audience"];
    specificEmails?: string[] | null;
  } = {};
  if (body.subject !== undefined) {
    if (typeof body.subject !== "string" || !body.subject.trim()) {
      return { ok: false, error: "Subject is required" };
    }
    out.subject = body.subject.trim().slice(0, 500);
  } else if (isCreate) {
    return { ok: false, error: "Subject is required" };
  }
  if (body.preheader !== undefined) {
    if (body.preheader === null) {
      out.preheader = null;
    } else if (typeof body.preheader !== "string") {
      return { ok: false, error: "preheader must be a string" };
    } else {
      out.preheader = body.preheader.slice(0, 500);
    }
  }
  if (body.htmlBody !== undefined) {
    if (typeof body.htmlBody !== "string" || !body.htmlBody.trim()) {
      return { ok: false, error: "htmlBody is required" };
    }
    if (body.htmlBody.length > 1_000_000) {
      return { ok: false, error: "htmlBody is too large (1 MB max)" };
    }
    out.htmlBody = body.htmlBody;
  } else if (isCreate) {
    return { ok: false, error: "htmlBody is required" };
  }
  if (body.audience !== undefined) {
    if (
      body.audience !== "all_users" &&
      body.audience !== "non_admins" &&
      body.audience !== "admins" &&
      body.audience !== "specific"
    ) {
      return { ok: false, error: "Invalid audience" };
    }
    out.audience = body.audience;
  }
  if (body.specificEmails !== undefined) {
    if (body.specificEmails === null) {
      out.specificEmails = null;
    } else {
      out.specificEmails = normalizeSpecificEmails(body.specificEmails);
    }
  }
  return { ok: true, value: out };
}

router.get(
  "/admin/email-campaigns",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    const rows = await db
      .select({
        id: emailCampaignsTable.id,
        subject: emailCampaignsTable.subject,
        status: emailCampaignsTable.status,
        audience: emailCampaignsTable.audience,
        createdAt: emailCampaignsTable.createdAt,
        sentAt: emailCampaignsTable.sentAt,
        totalRecipients: emailCampaignsTable.totalRecipients,
        totalSent: emailCampaignsTable.totalSent,
        totalFailed: emailCampaignsTable.totalFailed,
        uniqueOpens: sql<number>`COALESCE(SUM(CASE WHEN ${emailCampaignRecipientsTable.openedAt} IS NOT NULL THEN 1 ELSE 0 END), 0)::int`,
        totalOpens: sql<number>`COALESCE(SUM(${emailCampaignRecipientsTable.openCount}), 0)::int`,
      })
      .from(emailCampaignsTable)
      .leftJoin(
        emailCampaignRecipientsTable,
        eq(emailCampaignRecipientsTable.campaignId, emailCampaignsTable.id),
      )
      .groupBy(emailCampaignsTable.id)
      .orderBy(desc(emailCampaignsTable.createdAt))
      .limit(200);
    res.json({ campaigns: rows });
  },
);

router.post(
  "/admin/email-campaigns",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = parseCampaignBody(req.body ?? {}, true);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const v = parsed.value;
    const [row] = await db
      .insert(emailCampaignsTable)
      .values({
        subject: v.subject!,
        preheader: v.preheader ?? null,
        htmlBody: v.htmlBody!,
        audience: v.audience ?? "all_users",
        specificEmails:
          v.specificEmails === undefined ? null : v.specificEmails,
        createdByUserId: req.user!.id,
      })
      .returning();
    res.status(201).json({ campaign: row });
  },
);

router.get(
  "/admin/email-campaigns/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [campaign] = await db
      .select()
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.id, id))
      .limit(1);
    if (!campaign) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const recipients = await db
      .select({
        id: emailCampaignRecipientsTable.id,
        email: emailCampaignRecipientsTable.email,
        sentAt: emailCampaignRecipientsTable.sentAt,
        sendError: emailCampaignRecipientsTable.sendError,
        openedAt: emailCampaignRecipientsTable.openedAt,
        openCount: emailCampaignRecipientsTable.openCount,
        lastOpenedAt: emailCampaignRecipientsTable.lastOpenedAt,
      })
      .from(emailCampaignRecipientsTable)
      .where(eq(emailCampaignRecipientsTable.campaignId, id))
      .orderBy(desc(emailCampaignRecipientsTable.openCount));

    const uniqueOpens = recipients.filter((r) => r.openedAt).length;
    const totalOpens = recipients.reduce((acc, r) => acc + r.openCount, 0);
    res.json({
      campaign,
      recipients,
      stats: {
        uniqueOpens,
        totalOpens,
        openRate:
          recipients.length > 0
            ? uniqueOpens / recipients.length
            : 0,
      },
    });
  },
);

router.patch(
  "/admin/email-campaigns/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (existing.status !== "draft") {
      res
        .status(400)
        .json({ error: "Only draft campaigns can be edited" });
      return;
    }
    const parsed = parseCampaignBody(req.body ?? {}, false);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const v = parsed.value;
    const [updated] = await db
      .update(emailCampaignsTable)
      .set({
        ...(v.subject !== undefined && { subject: v.subject }),
        ...(v.preheader !== undefined && { preheader: v.preheader }),
        ...(v.htmlBody !== undefined && { htmlBody: v.htmlBody }),
        ...(v.audience !== undefined && { audience: v.audience }),
        ...(v.specificEmails !== undefined && {
          specificEmails: v.specificEmails,
        }),
        updatedAt: new Date(),
      })
      .where(eq(emailCampaignsTable.id, id))
      .returning();
    res.json({ campaign: updated });
  },
);

router.delete(
  "/admin/email-campaigns/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(emailCampaignsTable)
      .where(eq(emailCampaignsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (existing.status === "sending") {
      res.status(400).json({ error: "Cannot delete a campaign that is sending" });
      return;
    }
    await db
      .delete(emailCampaignsTable)
      .where(eq(emailCampaignsTable.id, id));
    res.status(204).end();
  },
);

router.post(
  "/admin/email-campaigns/:id/send",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    // Atomically claim the campaign — only one sender wins.
    const claimed = await db
      .update(emailCampaignsTable)
      .set({ status: "sending", sendError: null })
      .where(
        and(
          eq(emailCampaignsTable.id, id),
          eq(emailCampaignsTable.status, "draft"),
        ),
      )
      .returning();
    if (claimed.length === 0) {
      res
        .status(400)
        .json({ error: "Campaign not found or not in draft status" });
      return;
    }
    const campaign = claimed[0];

    const audience: AudiencePayload["audience"] = campaign.audience;
    const recipients = await resolveAudience({
      audience,
      specificEmails: campaign.specificEmails,
    });

    if (recipients.length === 0) {
      await db
        .update(emailCampaignsTable)
        .set({
          status: "failed",
          sendError: "Audience resolved to zero recipients",
          totalRecipients: 0,
        })
        .where(eq(emailCampaignsTable.id, id));
      res
        .status(400)
        .json({ error: "Audience resolved to zero recipients" });
      return;
    }

    // Pre-create recipient rows with unique tracking IDs.
    const recipientRows = await db
      .insert(emailCampaignRecipientsTable)
      .values(
        recipients.map((r) => ({
          campaignId: campaign.id,
          email: r.email,
          userId: r.userId,
          trackingId: randomUUID(),
        })),
      )
      .returning();

    await db
      .update(emailCampaignsTable)
      .set({ totalRecipients: recipientRows.length, sentByUserId: req.user!.id })
      .where(eq(emailCampaignsTable.id, id));

    const text = htmlToText(campaign.htmlBody);
    const subject = campaign.subject;

    // Fire off sends in the background. Reply immediately so the admin's
    // request doesn't block on Resend's API for large lists.
    res.status(202).json({
      campaign: { ...campaign, status: "sending" },
      queued: recipientRows.length,
    });

    setImmediate(async () => {
      let sent = 0;
      let failed = 0;
      const firstErrors: string[] = [];
      for (const r of recipientRows) {
        const html = buildHtmlForRecipient(campaign.htmlBody, r.trackingId);
        try {
          await sendEmailStrict({ to: r.email, subject, html, text });
          sent += 1;
          await db
            .update(emailCampaignRecipientsTable)
            .set({ sentAt: new Date(), sendError: null })
            .where(eq(emailCampaignRecipientsTable.id, r.id));
        } catch (err) {
          failed += 1;
          const msg = err instanceof Error ? err.message : String(err);
          if (firstErrors.length < 3) firstErrors.push(msg);
          await db
            .update(emailCampaignRecipientsTable)
            .set({ sendError: msg.slice(0, 500) })
            .where(eq(emailCampaignRecipientsTable.id, r.id));
        }
        // Keep counters live so the admin UI's polling detail view reflects
        // progress while a large campaign is mid-send.
        await db
          .update(emailCampaignsTable)
          .set({ totalSent: sent, totalFailed: failed })
          .where(eq(emailCampaignsTable.id, id));
      }

      const campaignError =
        failed === 0
          ? null
          : sent === 0
            ? `All ${failed} sends failed. First error: ${firstErrors[0] ?? "unknown"}`
            : `${failed} of ${failed + sent} sends failed. First error: ${firstErrors[0] ?? "unknown"}`;

      await db
        .update(emailCampaignsTable)
        .set({
          status: sent === 0 ? "failed" : "sent",
          sentAt: new Date(),
          totalSent: sent,
          totalFailed: failed,
          sendError: campaignError,
        })
        .where(eq(emailCampaignsTable.id, id));
    });
  },
);

// Quick audience size preview (so admins can see "you're about to email N people").
router.post(
  "/admin/email-campaigns/preview-audience",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const audience = req.body?.audience;
    if (
      audience !== "all_users" &&
      audience !== "non_admins" &&
      audience !== "admins" &&
      audience !== "specific"
    ) {
      res.status(400).json({ error: "Invalid audience" });
      return;
    }
    const recipients = await resolveAudience({
      audience,
      specificEmails: req.body?.specificEmails ?? [],
    });
    res.json({ count: recipients.length, sample: recipients.slice(0, 5) });
  },
);

// Surfaces unused so importers stay valid even if drizzle helpers shift.
void isNull;

export default router;
