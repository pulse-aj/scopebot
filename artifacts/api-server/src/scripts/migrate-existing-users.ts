/**
 * One-shot migration helper for the Clerk → self-hosted auth cutover.
 *
 * For every existing `users` row that has no `passwordHash`:
 *   - mark `emailVerifiedAt = createdAt` so we don't force them to
 *     re-verify an inbox they've already proved (Clerk required email
 *     verification);
 *   - issue an `initial_set` token and email them the "set your new
 *     password" link via the existing Resend integration.
 *
 * Idempotent: re-running only processes users who still have no password
 * hash. Pass `--force` to also reset `emailVerifiedAt` and rotate the
 * token (useful when re-sending the email).
 *
 *   pnpm --filter @workspace/api-server run migrate-users
 *   pnpm --filter @workspace/api-server run migrate-users -- --force
 */
import { db, usersTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { issueAuthToken } from "../lib/authTokens.js";
import { sendInitialSetEmail } from "../lib/authEmails.js";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const candidates = await db
    .select()
    .from(usersTable)
    .where(isNull(usersTable.passwordHash));

  if (candidates.length === 0) {
    console.log("No legacy passwordless users found — nothing to migrate.");
    return;
  }

  console.log(
    `Found ${candidates.length} legacy user(s) without a password hash.${
      force ? " (forced re-send)" : ""
    }`,
  );

  let ok = 0;
  let failed = 0;
  for (const u of candidates) {
    try {
      if (force || !u.emailVerifiedAt) {
        await db
          .update(usersTable)
          .set({ emailVerifiedAt: u.createdAt })
          .where(eq(usersTable.id, u.id));
      }
      const token = await issueAuthToken(u.id, "initial_set");
      await sendInitialSetEmail({ to: u.email, name: u.name, token });
      ok += 1;
      console.log(`  ok  ${u.email}`);
    } catch (err) {
      failed += 1;
      console.error(`  err ${u.email}:`, err);
    }
  }
  console.log(`Done. Emailed ${ok}, failed ${failed}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
