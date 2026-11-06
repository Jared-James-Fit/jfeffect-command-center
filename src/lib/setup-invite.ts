/**
 * Every setup link (texted, copied or emailed) opens `/setup?invite=<signed
 * token>` (setup-invite.server.ts), so it works for SETUP_INVITE_DAYS until the
 * client has signed in, not only for the life of one sign-in token.
 *
 * - Email on file (the coach's): Continue signs them in at once and they pick a
 *   password. An emailed link also carries a one-time token; when that has
 *   expired or been used, the invite takes over instead of "link expired".
 * - No email: they type theirs and we email it a code (and a link). Only the
 *   code or the link signs them in, so an email typed by mistake, or by
 *   whoever a link was forwarded to, never gets into the account.
 */

/** How long a setup link stays usable. It stops once the client has signed in. */
export const SETUP_INVITE_DAYS = 14;

/** The `/setup` address carrying an invite token. */
export function setupInviteUrl(setupPage: string, token: string): string {
  const url = new URL(setupPage);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", token);
  return url.toString();
}

/** "devin@gmail.com" → "d•••n@gmail.com": enough to recognise, not enough to read off a forwarded link. */
export function maskEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const shown = local.length <= 2 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`;
  return `${shown}@${domain}`;
}

/** A typed email, cleaned; null when it isn't one. */
export function cleanInviteEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

/** A token carried on a setup link (uuid.expiry.signature): anything else is dropped. */
export function cleanInviteParam(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^[0-9a-f-]{36}\.\d{9,11}\.[0-9a-f]{32}$/i.test(v) ? v : null;
}

/**
 * Where the setup page starts for this client:
 * - "continue": an email the coach entered, one tap signs them in;
 * - "email": no email yet, they type theirs;
 * - "code": they typed one and it's waiting on the emailed code.
 */
export type SetupStep = "continue" | "email" | "code";

/** What the setup page can offer for a client record. */
export type SetupInviteState =
  | { state: "invalid" }
  | { state: "signed_in_before" }
  | { state: "ok"; firstName: string | null; emailHint: string | null; step: SetupStep };

export function setupInviteState(
  client: {
    first_name?: string | null;
    preferred_name?: string | null;
    full_name?: string | null;
    email?: string | null;
    archived?: boolean | null;
    status?: string | null;
    portal_access_disabled?: boolean | null;
    last_signed_in_at?: string | null;
  } | null | undefined,
  opts: { emailUnverified?: boolean } = {},
): SetupInviteState {
  if (!client || client.archived || client.portal_access_disabled || client.status === "Deactivated" || client.status === "Archived") {
    return { state: "invalid" };
  }
  // Someone who has signed in already signs in or resets their password; a setup link isn't for them.
  if (client.last_signed_in_at) return { state: "signed_in_before" };
  const firstName =
    (client.preferred_name ?? "").trim() ||
    (client.first_name ?? "").trim() ||
    (client.full_name ?? "").trim().split(/\s+/)[0] ||
    null;
  const email = (client.email ?? "").trim() || null;
  const step: SetupStep = !email ? "email" : opts.emailUnverified ? "code" : "continue";
  return { state: "ok", firstName, emailHint: maskEmail(email), step };
}
