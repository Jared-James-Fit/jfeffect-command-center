/**
 * The setup message a coach sends a new client, in the coach's own voice. Used for
 * "Copy setup message" and "Text from my phone", so a client gets the same words
 * whichever way it reaches them.
 */
export type SetupMessageKind = "setup" | "reset";

export function setupMessageText(opts: {
  firstName?: string | null;
  url: string;
  kind?: SetupMessageKind;
}): string {
  const first = opts.firstName?.trim() || "there";
  const what =
    opts.kind === "reset"
      ? "Here's a link to set a new password for your JF Effect app"
      : "Here's your link to set up your JF Effect coaching app";
  const then = opts.kind === "reset" ? "choose your password" : "create your password";
  return (
    `Hi ${first}! ${what}:\n${opts.url}\n\n` +
    `Tap it, press Continue, then ${then}. It works once, so if it has expired just let me know and I'll send a new one.`
  );
}

/** First name for a greeting: the first name field, else the first word of the full name. */
export function greetingName(c: { first_name?: string | null; full_name?: string | null } | null | undefined): string | null {
  return c?.first_name?.trim() || c?.full_name?.trim().split(/\s+/)[0] || null;
}

/**
 * The client's number in +E.164, or null if it can't be a real number. Ten digits are
 * treated as North American (+1), matching how the SMS sender reads them.
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (cleaned.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Opens the coach's own Messages app with the message filled in (iOS and Android). */
export function smsComposeHref(phone: string, body: string): string {
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}
