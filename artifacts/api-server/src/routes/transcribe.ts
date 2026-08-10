import { Router, type IRouter, raw } from "express";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const ELEVENLABS_MODEL = "scribe_v1";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // ElevenLabs accepts up to ~1GB but a chat snippet should never approach this.
const REQUEST_TIMEOUT_MS = 60_000;

// POST /api/transcribe — accepts a raw audio blob in the request body
// (Content-Type from MediaRecorder, typically audio/webm) and returns
// `{ text: string }`. Auth-required: only signed-in users can transcribe,
// and the ElevenLabs API key never leaves the server.
router.post(
  "/transcribe",
  requireAuth,
  raw({ type: "*/*", limit: MAX_AUDIO_BYTES }),
  async (req, res) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      res
        .status(503)
        .json({ error: "Voice transcription is not configured" });
      return;
    }

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "Empty audio body" });
      return;
    }

    const contentType = req.header("content-type") || "audio/webm";
    // Map common MediaRecorder mime types to a sensible file extension
    // so ElevenLabs auto-detects the format. The extension matters more
    // than the MIME type to their server-side decoder.
    const ext = contentType.includes("mp4")
      ? "mp4"
      : contentType.includes("ogg")
        ? "ogg"
        : contentType.includes("wav")
          ? "wav"
          : contentType.includes("mpeg") || contentType.includes("mp3")
            ? "mp3"
            : "webm";

    const form = new FormData();
    form.append("model_id", ELEVENLABS_MODEL);
    form.append(
      "file",
      new Blob([new Uint8Array(body)], { type: contentType }),
      `clip.${ext}`,
    );

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const upstream = await fetch(ELEVENLABS_STT_URL, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal: controller.signal,
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        req.log?.error(
          { status: upstream.status, body: text.slice(0, 500) },
          "ElevenLabs STT request failed",
        );
        res
          .status(502)
          .json({ error: `Transcription failed (${upstream.status})` });
        return;
      }
      const json = (await upstream.json()) as { text?: unknown };
      const text = typeof json.text === "string" ? json.text.trim() : "";
      res.json({ text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log?.error({ err: message }, "ElevenLabs STT call threw");
      res.status(502).json({ error: "Transcription request failed" });
    } finally {
      clearTimeout(t);
    }
  },
);

export default router;
