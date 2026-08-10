import { appBaseUrl, sendEmail } from "./email.js";

function authLink(path: string, token: string): string {
  const base = appBaseUrl();
  const url = new URL(`${base}${path}`);
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logoUrl(): string {
  return `${appBaseUrl()}/logo.png`;
}

function wrap(args: {
  title: string;
  preheader: string;
  bodyHtml: string;
  ctaUrl: string;
  ctaLabel: string;
}): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f6;padding:24px;margin:0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(args.preheader)}</div>
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#ffffff;padding:24px 24px 18px;border-bottom:1px solid #f3f4f6;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:14px;">
            <img src="${logoUrl()}" alt="ScopeBot" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">ScopeBot</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">Account &amp; access</div>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:6px 24px 0;">
      <div style="font-size:20px;font-weight:700;color:#0f172a;margin:18px 0 4px;line-height:1.3;">${escapeHtml(args.title)}</div>
    </div>
    <div style="padding:12px 24px 24px;color:#111827;font-size:14px;line-height:1.6;">
      ${args.bodyHtml}
      <div style="margin-top:24px;">
        <a href="${args.ctaUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">${escapeHtml(args.ctaLabel)}</a>
      </div>
      <div style="margin-top:24px;color:#6b7280;font-size:12px;">If the button doesn't work, paste this URL into your browser:<br/><span style="color:#374151;word-break:break-all;">${escapeHtml(args.ctaUrl)}</span></div>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #f3f4f6;color:#6b7280;font-size:12px;background:#fafafa;">
      You're receiving this because someone (hopefully you) requested it on ScopeBot. If it wasn't you, you can safely ignore this email.
    </div>
  </div>
</body></html>`;
}

export async function sendVerifyEmail(opts: {
  to: string;
  name: string | null;
  token: string;
}): Promise<void> {
  const url = authLink("/auth/verify-email", opts.token);
  const subject = "Confirm your email for ScopeBot";
  const html = wrap({
    title: "Confirm your email",
    preheader: "Click to verify your account and sign in.",
    bodyHtml: `<p>Hi ${escapeHtml(opts.name || "there")},</p>
    <p>Click the button below to confirm your email and finish setting up your ScopeBot account.</p>
    <p style="color:#6b7280;font-size:13px;">This link expires in 24 hours.</p>`,
    ctaUrl: url,
    ctaLabel: "Confirm email",
  });
  const text = `Hi ${opts.name || "there"},\n\nConfirm your email for ScopeBot:\n${url}\n\nThis link expires in 24 hours.`;
  await sendEmail({ to: opts.to, subject, html, text });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string | null;
  token: string;
}): Promise<void> {
  const url = authLink("/auth/reset-password", opts.token);
  const subject = "Reset your ScopeBot password";
  const html = wrap({
    title: "Reset your password",
    preheader: "Use this link to set a new password.",
    bodyHtml: `<p>Hi ${escapeHtml(opts.name || "there")},</p>
    <p>We got a request to reset the password on your ScopeBot account. Click below to choose a new one.</p>
    <p style="color:#6b7280;font-size:13px;">This link expires in 1 hour. If you didn't ask for this, you can ignore this email — your password won't change.</p>`,
    ctaUrl: url,
    ctaLabel: "Reset password",
  });
  const text = `Hi ${opts.name || "there"},\n\nReset your ScopeBot password:\n${url}\n\nThis link expires in 1 hour.`;
  await sendEmail({ to: opts.to, subject, html, text });
}

/**
 * Sent during the Clerk → self-hosted migration so existing accounts can
 * set a brand-new password on the new auth system.
 */
export async function sendInitialSetEmail(opts: {
  to: string;
  name: string | null;
  token: string;
}): Promise<void> {
  const url = authLink("/auth/reset-password", opts.token);
  const subject = "Set up your new ScopeBot password";
  const html = wrap({
    title: "Welcome back — set your new password",
    preheader: "We've upgraded sign-in. Set a new password to continue.",
    bodyHtml: `<p>Hi ${escapeHtml(opts.name || "there")},</p>
    <p>We've upgraded the sign-in system for ScopeBot. Your account, requests, and history are all still there — you just need to set a new password to sign back in.</p>
    <p style="color:#6b7280;font-size:13px;">This link is good for 14 days.</p>`,
    ctaUrl: url,
    ctaLabel: "Set new password",
  });
  const text = `Hi ${opts.name || "there"},\n\nWe've upgraded sign-in for ScopeBot. Set a new password to continue:\n${url}\n\nThis link is good for 14 days.`;
  await sendEmail({ to: opts.to, subject, html, text });
}
