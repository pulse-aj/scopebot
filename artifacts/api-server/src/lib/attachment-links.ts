import { createHmac, timingSafeEqual } from "node:crypto";
import { appBaseUrl } from "./email";

// Public, capability-style links for conversation attachments.
//
// Attachments are otherwise auth-gated (owner + admins only). To let a
// finalized PRD embed screenshots that load inline in the app AND open from
// the exported PDF — including for people who aren't signed in — we mint
// unguessable, signed URLs. The signature is an HMAC of the attachment id
// keyed by SESSION_SECRET, so no DB column or token table is needed and the
// link can't be forged or enumerated by id.

const SECRET = process.env.SESSION_SECRET ?? "";
// Fail closed: a short/missing secret would make tokens trivially forgeable,
// turning the public route into unauthenticated access to every attachment.
// SESSION_SECRET is a required env in this app, so this should always hold.
const SECRET_OK = SECRET.length >= 16;

function sign(id: number): string {
  return createHmac("sha256", SECRET)
    .update(`attachment:${id}`)
    .digest("hex")
    .slice(0, 32);
}

export function signAttachmentToken(id: number): string {
  return `${id}-${sign(id)}`;
}

/** Returns the attachment id if the token is valid, otherwise null. */
export function verifyAttachmentToken(token: string): number | null {
  if (!SECRET_OK) return null;
  const m = /^(\d+)-([a-f0-9]{32})$/.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;
  return id;
}

export function attachmentPublicUrl(id: number): string {
  return `${appBaseUrl()}/api/attachments/public/${signAttachmentToken(id)}`;
}

const SECTION_HEADING = "## Screenshots & references";
const SECTION_INTRO =
  "Screenshots and design references attached to this request. They render inline in the app; in the exported PDF, click a link to open the full-size image.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match only OUR auto-appended block: the heading, immediately followed by the
// exact intro line, through end-of-string. Anchoring on the intro avoids
// truncating authored scope content that merely happens to reuse the heading.
const SECTION_RE = new RegExp(
  `\\n*##\\s+Screenshots & references\\s*\\n+${escapeRegExp(SECTION_INTRO)}[\\s\\S]*$`,
);

/**
 * Remove a previously-appended "Screenshots & references" section so we can
 * re-append a fresh one on re-synthesis without stacking duplicates. We always
 * append this section last, so cutting from the heading to end-of-string is
 * safe.
 */
export function stripScreenshotsSection(scope: string): string {
  return (scope ?? "").replace(SECTION_RE, "").trimEnd();
}

/**
 * Append a screenshots gallery to the scope markdown. Each image is a standard
 * markdown image pointing at its public URL — react-markdown renders it inline
 * in the app, and the PDF renderer turns it into a clickable link.
 */
export function composeScopeWithScreenshots(
  scope: string,
  images: { id: number; filename: string }[],
): string {
  const base = stripScreenshotsSection(scope ?? "");
  if (images.length === 0) return base;
  const items = images
    .map((img) => {
      const alt = (img.filename || `Screenshot ${img.id}`).replace(
        /[[\]]/g,
        "",
      );
      return `![${alt}](${attachmentPublicUrl(img.id)})`;
    })
    .join("\n\n");
  return `${base}\n\n${SECTION_HEADING}\n\n${SECTION_INTRO}\n\n${items}\n`;
}
