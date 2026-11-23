// Recovery codes for two-step sign-in (mfa-rules.ts, two-step.ts): the way
// back in when the phone is lost. Ten one-time codes, made when two-step is
// turned on and shown once; the database keeps only their hashes
// (20270424093000_staff_mfa_recovery.sql). Using one with the password
// confirms that sign-in, signs every other device out, stops trusting every
// device, and asks them to remove what was on the lost phone and add the new
// one.
//
// Pure: the code format, reading what someone types, and the saved file.

export const RECOVERY_CODE_COUNT = 10;

/** No 0 / o, 1 / i / l: nothing that reads as something else on paper. */
export const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const HALF = 5;

/** One code from random bytes ("k7m2p-q9tx4"); takes at least 10 bytes. */
export function recoveryCodeFrom(bytes: ArrayLike<number>): string {
  if (bytes.length < HALF * 2) throw new Error("Need 10 random bytes for a recovery code");
  let out = "";
  for (let i = 0; i < HALF * 2; i++) {
    // 256 % 31 leaves a slight lean toward the first letters; at 49 bits a
    // code that can be tried 5 times an hour, it doesn't matter.
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i === HALF - 1) out += "-";
  }
  return out;
}

/**
 * What someone typed or pasted, as the stored form: lower case, no spaces or
 * dashes. Null when it can't be a code (the wrong length, or a character no
 * code has: a typed 0 / o / 1 / i / l is a slip we can't fix, never a guess).
 */
export function normalizeRecoveryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toLowerCase().replace(/[\s\-_.]/g, "");
  if (s.length !== HALF * 2) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}

/** The file someone saves: plain text, who it's for, when, and how to use it. */
export function recoveryCodesFile(codes: string[], email: string | null | undefined, made: Date): string {
  const day = made.toISOString().slice(0, 10);
  return [
    "JF Effect: two-step sign-in recovery codes",
    email ? `For: ${email}` : null,
    `Made: ${day}`,
    "",
    "Lost your phone? Sign in with your password, tap \"Use a recovery code\"",
    "and type one of these. Each works once. Using one signs every other device",
    "out, then you remove what was on the lost phone and add your new one.",
    "Making new codes stops these from working.",
    "",
    ...codes,
    "",
    "Keep these somewhere other than your phone (a password manager, or printed).",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** SHA-256 of the stored form, as hex (Web Crypto: the server and tests alike). */
export async function recoveryCodeHash(normalized: string): Promise<string> {
  const data = new TextEncoder().encode(`jf-mfa-recovery:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
