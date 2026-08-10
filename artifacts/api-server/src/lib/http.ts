/**
 * Build a safe `Content-Disposition` header value.
 *
 * Node's `res.setHeader` rejects any byte outside Latin1 (ERR_INVALID_CHAR),
 * so a raw filename that contains non-Latin1 characters throws and turns the
 * response into a 500. macOS screenshots are a common trigger: their time
 * portion uses a NARROW NO-BREAK SPACE (U+202F) before "AM"/"PM", e.g.
 * "Screenshot 2026-06-04 at 8.54.14 AM.png".
 *
 * We emit both a sanitized ASCII `filename="…"` fallback (for older clients)
 * and an RFC 5987 / RFC 6266 `filename*=UTF-8''…` parameter that preserves the
 * original unicode name for modern browsers.
 */
export function contentDispositionHeader(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const stripped = (filename || "").replace(/[\r\n"]/g, "");
  const ascii = stripped.replace(/[^\x20-\x7E]/g, "_") || "download";
  // encodeURIComponent leaves !'()* unencoded, but those are not valid in an
  // RFC 5987 ext-value, so percent-encode them too.
  const encoded =
    stripped
      ? encodeURIComponent(stripped).replace(
          /['()*!]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        )
      : "download";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
