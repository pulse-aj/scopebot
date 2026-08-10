import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../lib/auth";
import { anthropic, MODEL } from "../lib/anthropic";
import { openai } from "../lib/openai";

const router: IRouter = Router();

const REFINE_SYSTEM_PROMPT = `You are an expert email designer who writes production-ready, inline-styled, table-based HTML emails for transactional and marketing use.

You will be given:
- The user's current email HTML (may be empty or partial).
- A short natural-language instruction describing how to change or improve it.

Your job: return ONE complete, self-contained HTML document that incorporates the requested changes while preserving everything the user did not ask you to touch.

Rules:
- Output ONLY the raw HTML. No markdown fences, no commentary, no explanations.
- Always return a full document starting with <!doctype html> and including <html>, <head>, and <body>. If the input was a fragment, wrap it.
- Use email-safe HTML: inline styles, table-based layouts when needed, web-safe font stacks, absolute URLs for any external images.
- Do NOT invent placeholder copy when the user only asked for visual changes. Preserve their wording.
- Do NOT delete existing images, links, or content unless explicitly asked. If the user asks to add a section, weave it in naturally rather than replacing what is there.
- Keep the email under ~600px wide for inbox-friendly rendering.
- If the input HTML contains <img> tags using data: URLs, KEEP them as-is.
- Avoid <style> blocks and external CSS — use inline style="" attributes everywhere.
- Avoid JavaScript and <script> tags entirely.`;

router.post(
  "/admin/email/refine-html",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const html = typeof req.body?.html === "string" ? req.body.html : "";
    const instructions =
      typeof req.body?.instructions === "string"
        ? req.body.instructions.trim()
        : "";
    if (!instructions) {
      res.status(400).json({ error: "instructions is required" });
      return;
    }
    if (instructions.length > 4000) {
      res.status(400).json({ error: "instructions is too long" });
      return;
    }
    if (html.length > 500_000) {
      res.status(400).json({ error: "html is too large" });
      return;
    }

    try {
      const userMessage = `Current email HTML (may be empty):

\`\`\`html
${html || "(empty — start from scratch)"}
\`\`\`

Instructions for how to refine it:

${instructions}

Return the full refined HTML document now. Output raw HTML only — no markdown fences, no commentary.`;

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: REFINE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      let text = "";
      for (const block of response.content) {
        if (block.type === "text") text += block.text;
      }
      text = text.trim();

      // Strip ```html fences if the model added them despite instructions.
      const fenced = text.match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/i);
      if (fenced) text = fenced[1].trim();

      if (!text) {
        res.status(502).json({ error: "AI returned an empty response" });
        return;
      }

      res.json({ html: text });
    } catch (err) {
      req.log.error({ err }, "refine-html failed");
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to refine email HTML",
      });
    }
  },
);

type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";
const ALLOWED_SIZES: ReadonlySet<ImageSize> = new Set([
  "1024x1024",
  "1536x1024",
  "1024x1536",
]);

router.post(
  "/admin/email/generate-image",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const prompt =
      typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const requestedSize =
      typeof req.body?.size === "string" ? req.body.size : "1024x1024";

    if (!prompt) {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    if (prompt.length > 4000) {
      res.status(400).json({ error: "prompt is too long" });
      return;
    }
    if (!ALLOWED_SIZES.has(requestedSize as ImageSize)) {
      res.status(400).json({
        error: `size must be one of ${Array.from(ALLOWED_SIZES).join(", ")}`,
      });
      return;
    }
    const size = requestedSize as ImageSize;

    try {
      const result = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size,
        n: 1,
      });

      const b64 = result.data?.[0]?.b64_json;
      if (!b64) {
        res.status(502).json({ error: "Image generation returned no data" });
        return;
      }
      const dataUrl = `data:image/png;base64,${b64}`;
      res.json({ dataUrl, size });
    } catch (err) {
      req.log.error({ err }, "generate-image failed");
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to generate image",
      });
    }
  },
);

export default router;
