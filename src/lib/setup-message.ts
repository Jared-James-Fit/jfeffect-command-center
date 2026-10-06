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
  /** Member setup links open straight on the password form; client links show Continue first. */
  continueStep?: boolean;
}): string {
  const first = opts.firstName?.trim() || "there";
  const what =
    opts.kind === "reset"
      ? "Here's a link to set a new password for your JF Effect app"
      : "Here's your link to set up your JF Effect app";
  const then = opts.kind === "reset" ? "choose your password" : "create your password";
  const steps = opts.continueStep === false ? `Tap it, then ${then}.` : `Tap it, press Continue, then ${then}.`;
  return (
    `Hi ${first}! ${what}:\n${opts.url}\n\n` +
    `${steps} It works once, so if it has expired just let me know and I'll send a new one.`
  );
}

/** Plain-English reason a setup text didn't go out, for the coach. */
export function smsNotSentReason(reason: string | null | undefined): string {
  switch (reason) {
    case "no_phone": return "no mobile number on file";
    case "opted_out": return "they've opted out of texts";
    case "sms_disabled": return "texting is turned off in SMS settings";
    case "no_automation": return "the \"New account\" text automation is off";
    case "not_on_allowlist": return "membership texts are limited to the allowlist in SMS safety settings";
    case "dry_run_mode": return "membership texts are in dry-run mode in SMS safety settings";
    default: return reason || "unknown error";
  }
}

/** First name for a greeting: the first name field, else the first word of the full name. */
export function greetingName(c: { first_name?: string | null; full_name?: string | null } | null | undefined): string | null {
  return c?.first_name?.trim() || c?.full_name?.trim().split(/\s+/)[0] || null;
}

/** Opens the coach's own Messages app with the message filled in (iOS and Android). */
export function smsComposeHref(phone: string, body: string): string {
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}
