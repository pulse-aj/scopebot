import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, attachmentsTable } from "@workspace/db";
import { verifyAttachmentToken } from "../lib/attachment-links";
import { contentDispositionHeader } from "../lib/http";

const router: IRouter = Router();

// Mime types we're willing to serve inline (rendered in the browser / PDF
// viewer). Everything else is forced to download to avoid serving active
// content (e.g. SVG/HTML) inline from our origin.
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

// Public, unauthenticated access to an attachment via a signed token. The
// token is an HMAC of the attachment id (see lib/attachment-links), so it's
// unguessable and can't be enumerated. Used by PRD screenshots that must load
// inline in the app and open from the exported PDF for anyone with the link.
router.get("/attachments/public/:token", async (req, res) => {
  const id = verifyAttachmentToken(String(req.params.token));
  if (id == null) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [a] = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, id))
    .limit(1);
  if (!a) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const buf = Buffer.from(a.dataBase64, "base64");
  const inline = INLINE_TYPES.has(a.mimeType.toLowerCase());
  res.setHeader(
    "Content-Type",
    inline ? a.mimeType : "application/octet-stream",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    contentDispositionHeader(inline ? "inline" : "attachment", a.filename),
  );
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buf);
});

export default router;
