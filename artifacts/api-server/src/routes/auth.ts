import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  dummyVerify,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "../lib/password.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySessionByToken,
  revokeAllUserSessions,
} from "../lib/sessions.js";
import { consumeAuthToken, issueAuthToken } from "../lib/authTokens.js";
import {
  sendInitialSetEmail,
  sendPasswordResetEmail,
  sendVerifyEmail,
} from "../lib/authEmails.js";
import { getRolesForEmail } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";

const router: IRouter = Router();

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  // Permissive email regex — Resend will reject truly bad addresses anyway.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return trimmed;
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 100);
}

function meShape(u: {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
}) {
  return { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin };
}

// ---- Sign up ----------------------------------------------------------
router.post(
  "/auth/sign-up",
  rateLimit({
    name: "sign-up",
    max: 5,
    windowMs: 60 * 60 * 1000,
    emailFromBody: true,
  }),
  async (req, res) => {
    const email = normalizeEmail((req.body as { email?: unknown }).email);
    const name = normalizeName((req.body as { name?: unknown }).name);
    const password = (req.body as { password?: unknown }).password;
    if (!email) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    if (typeof password !== "string") {
      res.status(400).json({ error: "Password is required." });
      return;
    }
    const pwError = validatePasswordStrength(password);
    if (pwError) {
      res.status(400).json({ error: pwError });
      return;
    }

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing) {
      // If the existing account never set a password (legacy Clerk row),
      // quietly resend the initial-set email so they can take ownership.
      if (!existing.passwordHash) {
        const token = await issueAuthToken(existing.id, "initial_set");
        await sendInitialSetEmail({
          to: existing.email,
          name: existing.name,
          token,
        });
      }
      // Always return the same shape so we don't leak account existence
      // beyond what a sign-in attempt would.
      res.status(200).json({ ok: true, requiresVerification: true });
      return;
    }

    const passwordHash = await hashPassword(password);
    const id = `usr_${crypto.randomBytes(16).toString("hex")}`;
    const { isAdmin, isEngineer } = await getRolesForEmail(email);
    const [created] = await db
      .insert(usersTable)
      .values({
        id,
        email,
        name,
        isAdmin,
        isEngineer,
        passwordHash,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: "Failed to create account." });
      return;
    }
    const token = await issueAuthToken(created.id, "verify_email");
    await sendVerifyEmail({ to: created.email, name: created.name, token });
    res.status(200).json({ ok: true, requiresVerification: true });
  },
);

// ---- Verify email -----------------------------------------------------
router.post(
  "/auth/verify-email",
  rateLimit({ name: "verify-email", max: 30, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const token = (req.body as { token?: unknown }).token;
    if (typeof token !== "string" || !token) {
      res.status(400).json({ error: "Missing token." });
      return;
    }
    const userId = await consumeAuthToken(token, "verify_email");
    if (!userId) {
      res
        .status(400)
        .json({ error: "This verification link is invalid or expired." });
      return;
    }
    const [user] = await db
      .update(usersTable)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!user) {
      res.status(400).json({ error: "Account not found." });
      return;
    }
    await createSession(user.id, req, res);
    res.json({ ok: true, user: meShape(user) });
  },
);

// ---- Resend verification ---------------------------------------------
router.post(
  "/auth/resend-verify",
  rateLimit({
    name: "resend-verify",
    max: 5,
    windowMs: 60 * 60 * 1000,
    emailFromBody: true,
  }),
  async (req, res) => {
    const email = normalizeEmail((req.body as { email?: unknown }).email);
    if (!email) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (user && !user.emailVerifiedAt) {
      const token = await issueAuthToken(user.id, "verify_email");
      await sendVerifyEmail({ to: user.email, name: user.name, token });
    }
    res.status(200).json({ ok: true });
  },
);

// ---- Sign in ----------------------------------------------------------
router.post(
  "/auth/sign-in",
  rateLimit({
    name: "sign-in",
    max: 10,
    windowMs: 15 * 60 * 1000,
    emailFromBody: true,
  }),
  async (req, res) => {
    const email = normalizeEmail((req.body as { email?: unknown }).email);
    const password = (req.body as { password?: unknown }).password;
    if (!email || typeof password !== "string") {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (!user) {
      // Burn the same wall-clock budget a real verify would, so an
      // attacker can't probe account existence by timing the response.
      await dummyVerify();
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    // Legacy Clerk migration users have no password hash. Trigger the
    // one-shot "set your password" flow automatically and tell the client
    // what happened.
    if (!user.passwordHash) {
      const token = await issueAuthToken(user.id, "initial_set");
      await sendInitialSetEmail({
        to: user.email,
        name: user.name,
        token,
      });
      res.status(409).json({
        error:
          "This account needs a new password. We just emailed you a link to set one.",
        needsInitialPasswordSet: true,
      });
      return;
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    if (!user.emailVerifiedAt) {
      const token = await issueAuthToken(user.id, "verify_email");
      await sendVerifyEmail({ to: user.email, name: user.name, token });
      res.status(403).json({
        error:
          "Please confirm your email first. We just sent you a new verification link.",
        needsEmailVerification: true,
      });
      return;
    }

    await createSession(user.id, req, res);
    res.json({ ok: true, user: meShape(user) });
  },
);

// ---- Sign out ---------------------------------------------------------
router.post("/auth/sign-out", async (req, res) => {
  const raw = (req as typeof req & { cookies?: Record<string, string> })
    .cookies?.[SESSION_COOKIE];
  await destroySessionByToken(raw);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---- Forgot password -------------------------------------------------
router.post(
  "/auth/forgot-password",
  rateLimit({
    name: "forgot-password",
    max: 5,
    windowMs: 60 * 60 * 1000,
    emailFromBody: true,
  }),
  async (req, res) => {
    const email = normalizeEmail((req.body as { email?: unknown }).email);
    if (email) {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (user) {
        // Existing-but-passwordless users get the initial-set email;
        // everyone else gets the regular reset email. Both land on the
        // same /auth/reset-password page.
        const kind = user.passwordHash ? "password_reset" : "initial_set";
        const token = await issueAuthToken(user.id, kind);
        if (kind === "password_reset") {
          await sendPasswordResetEmail({
            to: user.email,
            name: user.name,
            token,
          });
        } else {
          await sendInitialSetEmail({
            to: user.email,
            name: user.name,
            token,
          });
        }
      }
    }
    // Always 200 with the same body — don't leak account existence.
    res.status(200).json({ ok: true });
  },
);

// ---- Reset / set password --------------------------------------------
router.post(
  "/auth/reset-password",
  rateLimit({ name: "reset-password", max: 20, windowMs: 60 * 60 * 1000 }),
  async (req, res) => {
    const token = (req.body as { token?: unknown }).token;
    const password = (req.body as { password?: unknown }).password;
    if (typeof token !== "string" || !token) {
      res.status(400).json({ error: "Missing token." });
      return;
    }
    if (typeof password !== "string") {
      res.status(400).json({ error: "Password is required." });
      return;
    }
    const pwError = validatePasswordStrength(password);
    if (pwError) {
      res.status(400).json({ error: pwError });
      return;
    }
    // Try both kinds — the same form handles new-user reset and
    // legacy-user initial-set.
    let userId = await consumeAuthToken(token, "password_reset");
    if (!userId) userId = await consumeAuthToken(token, "initial_set");
    if (!userId) {
      res
        .status(400)
        .json({ error: "This link is invalid or has expired." });
      return;
    }
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .update(usersTable)
      .set({
        passwordHash,
        // Going through email proves they own the inbox — count it as
        // verified if they hadn't already.
        emailVerifiedAt: new Date(),
      })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!user) {
      res.status(400).json({ error: "Account not found." });
      return;
    }
    // Revoke any older sessions for safety, then mint a fresh one.
    await revokeAllUserSessions(user.id);
    await createSession(user.id, req, res);
    res.json({ ok: true, user: meShape(user) });
  },
);

export default router;
