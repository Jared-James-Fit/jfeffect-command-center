// Production-only redirect base — never use preview/localhost in reset links.
export const RECOVERY_BASE_URL = "https://jfeffect.com";
export const RESET_PATH = "/reset-password";
export const RECOVERY_PATH = "/recover";

export const TOKEN_TTL_MINUTES = 30;
export const MAX_TOKEN_ATTEMPTS = 5;

// Rate limits
export const PER_IDENTIFIER_PER_MINUTE = 1;
export const PER_IDENTIFIER_PER_HOUR = 5;
export const PER_IP_PER_HOUR = 10;

export const NEUTRAL_RESPONSE_MESSAGE =
  "If an account matches that information, recovery instructions have been sent. Check your email and text messages.";

// Branded SMS copy
export function recoverySmsBody(link: string) {
  return `JF Effect: A password reset was requested for your account. Reset it securely here: ${link} This link expires in 30 minutes. If this wasn't you, ignore this message.`;
}

export function confirmationSmsBody() {
  return `JF Effect: Your password was just changed. If this wasn't you, contact support immediately.`;
}

// Password rules
export const PASSWORD_RULES = {
  minLength: 10,
  upper: /[A-Z]/,
  lower: /[a-z]/,
  digit: /[0-9]/,
  special: /[^A-Za-z0-9]/,
};

export function validatePassword(pw: string) {
  return {
    length: pw.length >= PASSWORD_RULES.minLength,
    upper: PASSWORD_RULES.upper.test(pw),
    lower: PASSWORD_RULES.lower.test(pw),
    digit: PASSWORD_RULES.digit.test(pw),
    special: PASSWORD_RULES.special.test(pw),
  };
}

export function passwordIsValid(pw: string) {
  const v = validatePassword(pw);
  return v.length && v.upper && v.lower && v.digit && v.special;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local[0] ?? "*";
  return `${visible}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return "+" + cleaned;
}

export function looksLikeEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}