/**
 * E.164 phone normalization shared across the membership signup,
 * account setup, and admin update flows. Returns the canonical
 * +<countrycode><number> string, or `null` when the input cannot
 * be normalized to a valid E.164 value.
 *
 * Rules:
 *   - Strip all non-digits (keep a leading '+' if present).
 *   - Reject empty input.
 *   - 10 digits (NANP local) → prepend +1.
 *   - 11 digits starting with '1' → prepend '+'.
 *   - 7-15 digits with a leading '+' → keep as-is.
 *   - Anything else (too short / too long / no country code) → null.
 */
export function normalizePhoneToE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D+/g, "");
  if (!digits) return null;

  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return "+" + digits;
  }
  // No leading '+': NANP defaults
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  // Other lengths without '+' are ambiguous — refuse rather than guess
  return null;
}

/** True when value is already a valid E.164 string. */
export function isE164(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\+[1-9]\d{6,14}$/.test(value);
}