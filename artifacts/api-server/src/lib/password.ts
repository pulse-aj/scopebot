import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Constant-time-ish dummy compare used when the requested email doesn't
 * exist, so the wall-clock cost of a sign-in attempt doesn't reveal
 * account existence. We bcrypt-compare a fixed garbage password against
 * a pre-computed hash of equivalent cost.
 */
const DUMMY_HASH =
  "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.Z8b3oQVw3sB0n6cQ6CevlYz6dC.W"; // bcrypt("dummy", 12)
export async function dummyVerify(): Promise<void> {
  await bcrypt.compare("dummy-pw-for-timing-equalization", DUMMY_HASH);
}

export function validatePasswordStrength(pw: string): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}
