import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE } from "../lib/sessions.js";

/**
 * Cookie-auth CSRF defense.
 *
 * Browsers automatically attach our `pulse_session` cookie to cross-site
 * requests as long as they're same-site under `sameSite=lax`. On
 * Replit the app is published under `*.replit.app` and arbitrary custom
 * domains, so an attacker on another `*.replit.app` could plausibly be
 * treated as same-site — `sameSite=lax` is not enough on its own.
 *
 * Policy: for any non-safe HTTP method that carries our session cookie,
 * require either the `Origin` or (if missing) the `Referer` header's
 * origin to match the configured allowlist. Server-to-server callers
 * (e.g. `/api/integrations/*` with a Bearer token, the Paperclip
 * webhook) never carry the session cookie, so they pass straight
 * through without an Origin requirement.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function buildAllowedOrigins(): Set<string> {
  const out = new Set<string>();
  for (const d of (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    out.add(`https://${d}`);
  }
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) out.add(`https://${dev}`);
  // In dev workflows the proxy serves on localhost too.
  if (process.env.NODE_ENV !== "production") {
    out.add("http://localhost");
    out.add("http://localhost:80");
    out.add("http://127.0.0.1");
  }
  return out;
}

const ALLOWED = buildAllowedOrigins();

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function csrfGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const hasSessionCookie = Boolean(
    (req as Request & { cookies?: Record<string, string> }).cookies?.[
      SESSION_COOKIE
    ],
  );
  if (!hasSessionCookie) return next(); // bearer / unauth callers can't CSRF

  const origin =
    (req.headers.origin as string | undefined) ||
    originFromReferer(req.headers.referer as string | undefined);

  if (!origin || !ALLOWED.has(origin)) {
    req.log?.warn(
      { origin, referer: req.headers.referer, method: req.method, url: req.url },
      "Blocked cookie-auth request with missing/foreign Origin (CSRF guard)",
    );
    res.status(403).json({ error: "Forbidden (CSRF check failed)" });
    return;
  }
  next();
}
