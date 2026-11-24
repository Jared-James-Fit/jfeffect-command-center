/**
 * Who every app email is from, and where a reply lands.
 *
 * Sending: every app email goes through Lovable Emails on the verified sender domain
 * notify.jfeffect.com (DKIM/SPF live there; DMARC aligns on jfeffect.com). The From
 * address stays noreply@jfeffect.com, the address that sender path is verified for.
 * Only the display name changes per department.
 *
 * Replying: each department sets a Reply-To on a real Google Workspace alias, so a
 * client who hits reply reaches the right part of the one JF Effect inbox
 * (jared@jfeffect.com, with hello@, coaching@, support@ and billing@ as aliases).
 *
 * Never put a personal Gmail address in anything a client or member receives.
 */

export const EMAIL_SENDER_DOMAIN = "notify.jfeffect.com";
export const EMAIL_FROM_ADDRESS = "noreply@jfeffect.com";

/** Public contact addresses. All of them land in the one JF Effect inbox. */
export const CONTACT = {
  founder: "jared@jfeffect.com",
  hello: "hello@jfeffect.com",
  coaching: "coaching@jfeffect.com",
  support: "support@jfeffect.com",
  billing: "billing@jfeffect.com",
} as const;

export type EmailIdentityKey = "account" | "support" | "coaching" | "billing";

export const EMAIL_IDENTITIES: Record<EmailIdentityKey, { name: string; replyTo: string }> = {
  /** Sign-in codes, password resets, email changes, two-step codes. */
  account: { name: "JF Effect", replyTo: CONTACT.support },
  /** App setup, membership access, anything a member needs help with. */
  support: { name: "JF Effect Support", replyTo: CONTACT.support },
  /** Applications, agreements, coaching onboarding. */
  coaching: { name: "JF Effect Coaching", replyTo: CONTACT.coaching },
  /** Payment links, purchase confirmations, subscription notices. */
  billing: { name: "JF Effect Billing", replyTo: CONTACT.billing },
};

/** The From header for an identity: `JF Effect Coaching <noreply@jfeffect.com>`. */
export function emailFrom(identity: EmailIdentityKey): string {
  return `${EMAIL_IDENTITIES[identity].name} <${EMAIL_FROM_ADDRESS}>`;
}

export function emailReplyTo(identity: EmailIdentityKey): string {
  return EMAIL_IDENTITIES[identity].replyTo;
}

/** From + sender domain + Reply-To, ready to spread into an enqueue_email payload. */
export function emailEnvelope(identity: EmailIdentityKey) {
  return {
    from: emailFrom(identity),
    sender_domain: EMAIL_SENDER_DOMAIN,
    reply_to: emailReplyTo(identity),
  };
}
