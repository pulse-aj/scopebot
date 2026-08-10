import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Cheap periodic GC so the map doesn't grow unbounded.
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  },
  5 * 60 * 1000,
).unref?.();

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
}

/**
 * Tiny in-memory rate-limit middleware factory. Fine for a
 * single-process Reserved VM. Use a Redis-backed limiter if we ever
 * horizontally scale.
 *
 * Bucket key = `${name}:${ip}:${optionalEmail}`. The email part keeps
 * an attacker from drowning out a real user from the same NAT by
 * pounding `/forgot-password` for many addresses.
 */
export function rateLimit(opts: {
  name: string;
  max: number;
  windowMs: number;
  emailFromBody?: boolean;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = clientIp(req);
    let email = "";
    if (opts.emailFromBody) {
      const raw = (req.body as { email?: unknown } | undefined)?.email;
      if (typeof raw === "string") email = raw.trim().toLowerCase();
    }
    const key = `${opts.name}:${ip}:${email}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > opts.max) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests, please slow down." });
      return;
    }
    next();
  };
}
