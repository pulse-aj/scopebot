// Email helpers backed by the Replit Resend integration.
// Token/credentials are fetched fresh per send (never cache the client —
// see the Resend integration blueprint).
import { Resend } from "resend";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import { usersTable, teamMembersTable } from "@workspace/db/schema";
import { inArray, eq } from "drizzle-orm";

interface ResendCredentials {
  apiKey: string;
  fromEmail: string | null;
}

async function getResendCredentials(): Promise<ResendCredentials | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) return null;

  try {
    const resp = await fetch(
      "https://" +
        hostname +
        "/api/v2/connection?include_secrets=true&connector_names=resend",
      {
        headers: {
          Accept: "application/json",
          "X-Replit-Token": xReplitToken,
        },
      },
    );
    const data = (await resp.json()) as {
      items?: Array<{
        settings?: { api_key?: string; from_email?: string | null };
      }>;
    };
    const item = data.items?.[0];
    if (!item?.settings?.api_key) return null;
    return {
      apiKey: item.settings.api_key,
      fromEmail: item.settings.from_email ?? null,
    };
  } catch (err) {
    logger.warn({ err }, "Failed to fetch Resend credentials");
    return null;
  }
}

// Exported so the rest of the server (auth emails, campaign tracking
// pixels, etc.) all build links against the same canonical public host.
// Order of precedence:
//   1. PUBLIC_APP_URL — explicit override (e.g. https://requests.example.com)
//      so production emails always link to the custom domain, not the
//      raw `*.replit.app` hostname.
//   2. REPLIT_DOMAINS[0] — what Replit gives us at runtime.
//   3. localhost — dev fallback.
export function appBaseUrl(): string {
  const override = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (override) return override;
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  if (domains.length > 0) return `https://${domains[0]}`;
  return "http://localhost";
}

export function requestUrl(featureRequestId: number): string {
  return `${appBaseUrl()}/requests/${featureRequestId}`;
}

// Prepend a small "Source PRD" header to a scope doc so that any agent
// (Claude Code, Cursor, Paperclip, etc.) reading the markdown can follow
// the link back to ScopeBot — to chat with the customer, watch for
// updates, or attach engineering tasks. Stored scope in the DB is left
// untouched; this is added at serve time so the link always reflects
// the current PUBLIC_APP_URL.
export function scopeWithSourceHeader(
  featureRequestId: number,
  scope: string,
): string {
  const url = requestUrl(featureRequestId);
  // Hidden, host-independent marker so we can reconcile a pushed issue back to
  // its feature request even if PUBLIC_APP_URL changes (the visible URL below
  // would then differ). Rendered markdown hides HTML comments.
  const header =
    `<!-- scopebot-fr-id: ${featureRequestId} -->\n\n` +
    `> **Source PRD:** [${url}](${url})  \n` +
    `> Open in ScopeBot to see the full conversation, post questions ` +
    `back to the requester, or update status.\n\n`;
  return header + (scope ?? "");
}

export function conversationUrl(conversationId: number): string {
  return `${appBaseUrl()}/app/conversations/${conversationId}`;
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

// Strict variant: throws on missing config or any provider failure so
// callers (e.g. campaign sends) can deterministically count success/failure.
// Use this instead of `sendEmail` when you need real delivery accounting.
export async function sendEmailStrict(args: SendArgs): Promise<void> {
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  const filtered = recipients.filter(Boolean);
  if (filtered.length === 0) {
    throw new Error("No recipients");
  }
  const creds = await getResendCredentials();
  if (!creds) {
    throw new Error("Resend integration is not configured");
  }
  const from = creds.fromEmail ?? "ScopeBot <onboarding@resend.dev>";
  const client = new Resend(creds.apiKey);
  const { error } = await client.emails.send({
    from,
    to: filtered,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  if (error) {
    const msg =
      (error as { message?: string }).message ||
      (typeof error === "string" ? error : JSON.stringify(error));
    throw new Error(`Resend rejected email: ${msg}`);
  }
}

export async function sendEmail(args: SendArgs): Promise<void> {
  const recipients = Array.isArray(args.to) ? args.to : [args.to];
  const filtered = recipients.filter(Boolean);
  if (filtered.length === 0) return;

  const creds = await getResendCredentials();
  if (!creds) {
    logger.warn(
      { to: filtered, subject: args.subject },
      "Resend not configured — skipping email",
    );
    return;
  }
  const from = creds.fromEmail ?? "ScopeBot <onboarding@resend.dev>";
  const client = new Resend(creds.apiKey);
  try {
    const { error } = await client.emails.send({
      from,
      to: filtered,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (error) {
      logger.error(
        { err: error, to: filtered, subject: args.subject },
        "Resend rejected email",
      );
    } else {
      logger.info(
        { to: filtered, subject: args.subject },
        "Notification email sent",
      );
    }
  } catch (err) {
    logger.error({ err }, "Resend send threw");
  }
}

export async function getAdminEmails(): Promise<string[]> {
  // team_members is the source of truth for admin recipients; the optional
  // ADMIN_EMAILS env var only supplements it (useful before first login).
  const rows = await db
    .select({ email: teamMembersTable.email })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.role, "admin"));
  const fromDb = rows.map((r) => r.email.toLowerCase());
  const fromEnv = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...fromDb, ...fromEnv]));
}

export async function getUserEmail(userId: string): Promise<{
  email: string;
  name: string | null;
} | null> {
  const [u] = await db
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(inArray(usersTable.id, [userId]))
    .limit(1);
  if (!u) return null;
  return { email: u.email, name: u.name };
}

function logoUrl(): string {
  return `${appBaseUrl()}/logo.png`;
}

function wrap(title: string, bodyHtml: string, ctaUrl: string, ctaLabel: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;padding:24px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ffffff;padding:24px 24px 18px;border-bottom:1px solid #f3f4f6;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:14px;">
            <img src="${logoUrl()}" alt="ScopeBot" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">ScopeBot</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">Internal product request workspace</div>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:6px 24px 0;">
      <div style="font-size:20px;font-weight:700;color:#0f172a;margin:18px 0 4px;line-height:1.3;">${escapeHtml(title)}</div>
    </div>
    <div style="padding:12px 24px 24px;color:#111827;font-size:14px;line-height:1.6;">
      ${bodyHtml}
      <div style="margin-top:24px;">
        <a href="${ctaUrl}" style="display:inline-block;background:#0e7490;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">${escapeHtml(ctaLabel)}</a>
      </div>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px;background:#fafafa;">
      You're receiving this because you have a feature request in ScopeBot.
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Specific notifications ----

export async function notifyOwnerOfAdminQuestion(opts: {
  ownerEmail: string;
  ownerName: string | null;
  adminName: string | null;
  adminEmail: string;
  conversationId: number;
  conversationTitle: string | null;
  question: string;
}): Promise<void> {
  const url = conversationUrl(opts.conversationId);
  const who = opts.adminName || opts.adminEmail;
  const title = `${who} has a question about "${opts.conversationTitle || "your feature request"}"`;
  const html = wrap(
    title,
    `<p>Hi ${escapeHtml(opts.ownerName || "there")},</p>
     <p><strong>${escapeHtml(who)}</strong> from the team left a clarifying question on your feature request:</p>
     <blockquote style="margin:12px 0;padding:12px 16px;background:#fff7ed;border-left:4px solid #f59e0b;border-radius:6px;color:#7c2d12;white-space:pre-wrap;">${escapeHtml(opts.question)}</blockquote>
     <p>Hop back into the chat to answer — your reply will automatically refresh the requirements doc.</p>`,
    url,
    "Open the chat",
  );
  const text = `${who} asked a clarifying question:\n\n${opts.question}\n\nReply at ${url}`;
  await sendEmail({ to: opts.ownerEmail, subject: title, html, text });
}

export async function notifyAdminsOfUserReply(opts: {
  adminEmails: string[];
  ownerName: string | null;
  ownerEmail: string;
  featureRequestId: number;
  featureRequestTitle: string;
  message: string;
}): Promise<void> {
  const url = requestUrl(opts.featureRequestId);
  const who = opts.ownerName || opts.ownerEmail;
  const subject = `${who} replied on "${opts.featureRequestTitle}"`;
  const html = wrap(
    subject,
    `<p><strong>${escapeHtml(who)}</strong> sent a follow-up on a finalized request. The requirements doc is being re-synthesized to incorporate it.</p>
     <blockquote style="margin:12px 0;padding:12px 16px;background:#eef2ff;border-left:4px solid #4f46e5;border-radius:6px;color:#1e1b4b;white-space:pre-wrap;">${escapeHtml(opts.message.slice(0, 1200))}${opts.message.length > 1200 ? "…" : ""}</blockquote>`,
    url,
    "Open in admin",
  );
  const text = `${who} replied on "${opts.featureRequestTitle}":\n\n${opts.message}\n\n${url}`;
  await sendEmail({
    to: opts.adminEmails,
    subject,
    html,
    text,
  });
}

export async function notifyOwnerOfStatusChange(opts: {
  ownerEmail: string;
  ownerName: string | null;
  featureRequestId: number;
  featureRequestTitle: string;
  newStatus: string;
}): Promise<void> {
  const url = requestUrl(opts.featureRequestId);
  const labels: Record<string, string> = {
    requested: "Requested",
    planned: "Planned",
    in_progress: "In Progress",
    deployed: "Deployed",
  };
  const label = labels[opts.newStatus] ?? opts.newStatus;
  const subject = `"${opts.featureRequestTitle}" is now ${label}`;
  const html = wrap(
    subject,
    `<p>Hi ${escapeHtml(opts.ownerName || "there")},</p>
     <p>Status update on your feature request <strong>${escapeHtml(opts.featureRequestTitle)}</strong>:</p>
     <p style="font-size:18px;font-weight:700;color:#4f46e5;margin:18px 0;">${escapeHtml(label)}</p>`,
    url,
    "View request",
  );
  const text = `Your feature request "${opts.featureRequestTitle}" is now ${label}.\n\n${url}`;
  await sendEmail({ to: opts.ownerEmail, subject, html, text });
}

export async function notifyOfNewRequirementsDoc(opts: {
  adminEmails: string[];
  ownerEmail: string;
  ownerName: string | null;
  featureRequestId: number;
  featureRequestTitle: string;
  summary: string;
  priority: string;
}): Promise<void> {
  const url = requestUrl(opts.featureRequestId);
  const who = opts.ownerName || opts.ownerEmail;
  const priorityLabel = opts.priority.charAt(0).toUpperCase() + opts.priority.slice(1);

  // Admins: "new doc filed"
  const adminSubject = `New requirements doc: "${opts.featureRequestTitle}"`;
  const adminHtml = wrap(
    adminSubject,
    `<p><strong>${escapeHtml(who)}</strong> just finalized a new requirements doc.</p>
     <p style="margin:6px 0;"><strong>Title:</strong> ${escapeHtml(opts.featureRequestTitle)}</p>
     <p style="margin:6px 0;"><strong>Priority:</strong> ${escapeHtml(priorityLabel)}</p>
     <blockquote style="margin:12px 0;padding:12px 16px;background:#f0fdfa;border-left:4px solid #0e7490;border-radius:6px;color:#134e4a;white-space:pre-wrap;">${escapeHtml(opts.summary.slice(0, 1200))}${opts.summary.length > 1200 ? "…" : ""}</blockquote>`,
    url,
    "Open in admin",
  );
  const adminText = `${who} filed a new requirements doc: "${opts.featureRequestTitle}" (${priorityLabel}).\n\n${opts.summary}\n\n${url}`;
  const adminRecipients = opts.adminEmails.filter(
    (e) => e.toLowerCase() !== opts.ownerEmail.toLowerCase(),
  );
  if (adminRecipients.length > 0) {
    await sendEmail({
      to: adminRecipients,
      subject: adminSubject,
      html: adminHtml,
      text: adminText,
    });
  }

  // Owner: "your requirements doc is ready"
  const ownerSubject = `Your requirements doc is ready: "${opts.featureRequestTitle}"`;
  const ownerHtml = wrap(
    ownerSubject,
    `<p>Hi ${escapeHtml(opts.ownerName || "there")},</p>
     <p>The AI product manager finalized your requirements doc for <strong>${escapeHtml(opts.featureRequestTitle)}</strong>. The team has been notified and will triage it shortly.</p>
     <p style="margin:6px 0;"><strong>Priority:</strong> ${escapeHtml(priorityLabel)}</p>
     <p>You can still reply in the chat — any new context will automatically refresh the doc.</p>`,
    url,
    "View your doc",
  );
  const ownerText = `Your requirements doc "${opts.featureRequestTitle}" is ready.\n\n${url}`;
  await sendEmail({
    to: opts.ownerEmail,
    subject: ownerSubject,
    html: ownerHtml,
    text: ownerText,
  });
}

export async function notifyOwnerOfResynthesis(opts: {
  ownerEmail: string;
  ownerName: string | null;
  featureRequestId: number;
  featureRequestTitle: string;
  reason: string;
  triggeredByUserId: string | null;
  ownerUserId: string;
}): Promise<void> {
  // Don't notify the owner if they themselves triggered it.
  if (opts.triggeredByUserId && opts.triggeredByUserId === opts.ownerUserId) {
    return;
  }
  const url = requestUrl(opts.featureRequestId);
  const subject = `Requirements updated: "${opts.featureRequestTitle}"`;
  const html = wrap(
    subject,
    `<p>Hi ${escapeHtml(opts.ownerName || "there")},</p>
     <p>The AI re-synthesized the requirements doc for <strong>${escapeHtml(opts.featureRequestTitle)}</strong>.</p>
     <p style="color:#6b7280;font-size:13px;">Reason: ${escapeHtml(opts.reason)}</p>
     <p>You can browse every revision in the version history panel on the request page.</p>`,
    url,
    "View latest version",
  );
  const text = `The requirements doc for "${opts.featureRequestTitle}" was re-synthesized (${opts.reason}).\n\n${url}`;
  await sendEmail({ to: opts.ownerEmail, subject, html, text });
}
