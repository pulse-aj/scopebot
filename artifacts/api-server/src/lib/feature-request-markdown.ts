import { asc, eq } from "drizzle-orm";
import {
  db,
  attachmentsTable,
  featureRequestsTable,
  usersTable,
} from "@workspace/db";
import { requestUrl } from "./email";
import {
  attachmentPublicUrl,
  stripScreenshotsSection,
} from "./attachment-links";

type FeatureRequestRow = typeof featureRequestsTable.$inferSelect;

// Markdown link text must stay on one line and not break out of the [..]. Strip
// brackets and any control chars (newlines, etc.) from raw filenames.
function linkLabel(name: string, fallback: string): string {
  const cleaned = (name || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f[\]]/g, "")
    .trim();
  return cleaned || fallback;
}

export type BuildMarkdownOptions = {
  // Emit the hidden `<!-- scopebot-fr-id: N -->` reconciliation marker. Needed
  // for the Paperclip push (the scheduler matches it back to the request), but
  // noise in a user-downloaded file, so it defaults to off.
  includeMarker?: boolean;
};

function section(heading: string, body: string | null | undefined): string {
  const b = (body ?? "").trim();
  if (!b) return "";
  return `## ${heading}\n\n${b}\n`;
}

/**
 * Render a feature request as a complete, self-contained Markdown document:
 * a Source-PRD backlink, the title + metadata, every structured section
 * (summary / problem / benefits / current cost / scope), and an Attachments
 * section listing every uploaded image and file as a signed public link.
 *
 * Shared by the Paperclip push (so issues are created as full Markdown, not
 * just the scope) and the in-app "Download Markdown" button.
 */
export async function buildFeatureRequestMarkdown(
  fr: FeatureRequestRow,
  opts: BuildMarkdownOptions = {},
): Promise<string> {
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, fr.userId))
    .limit(1);

  const attachments = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.conversationId, fr.conversationId))
    .orderBy(asc(attachmentsTable.createdAt));

  const url = requestUrl(fr.id);
  const out: string[] = [];

  if (opts.includeMarker) {
    out.push(`<!-- scopebot-fr-id: ${fr.id} -->`);
  }
  out.push(
    `> **Source PRD:** [${url}](${url})  \n` +
      `> Open in ScopeBot to see the full conversation, post questions ` +
      `back to the requester, or update status.`,
  );

  out.push(`# ${fr.title}`);
  out.push(
    `_${[
      owner?.name || owner?.email || "Anonymous",
      `Status: ${fr.status.replace(/_/g, " ")}`,
      `Priority: ${fr.priority}`,
      `Updated ${fr.updatedAt.toISOString().slice(0, 10)}`,
    ].join("  ·  ")}_`,
  );

  const summary = section("Summary", fr.summary);
  if (summary) out.push(summary);
  const problem = section("Problem", fr.problem);
  if (problem) out.push(problem);
  const benefits = section("Benefits", fr.benefits);
  if (benefits) out.push(benefits);
  const spend = section("Current cost / pain", fr.currentSpend);
  if (spend) out.push(spend);
  // Drop the auto-appended "Screenshots & references" gallery so the images
  // aren't listed twice (inline here AND in the Attachments section below); the
  // Attachments section is the single canonical list of every uploaded file.
  const scope = section("Scope", stripScreenshotsSection(fr.scope));
  if (scope) out.push(scope);

  if (attachments.length > 0) {
    const images = attachments.filter((a) =>
      a.mimeType.toLowerCase().startsWith("image/"),
    );
    const files = attachments.filter(
      (a) => !a.mimeType.toLowerCase().startsWith("image/"),
    );
    const lines: string[] = ["## Attachments"];
    if (images.length > 0) {
      lines.push("**Images**");
      lines.push(
        images
          .map(
            (a) =>
              `- [${linkLabel(a.filename, `image-${a.id}`)}](${attachmentPublicUrl(a.id)})`,
          )
          .join("\n"),
      );
    }
    if (files.length > 0) {
      lines.push("**Files**");
      lines.push(
        files
          .map(
            (a) =>
              `- [${linkLabel(a.filename, `file-${a.id}`)}](${attachmentPublicUrl(a.id)})`,
          )
          .join("\n"),
      );
    }
    out.push(lines.join("\n\n"));
  }

  return out.join("\n\n").trimEnd() + "\n";
}
