/**
 * A setup link for a client record with no email yet.
 *
 * The coach can always get someone into the app from just their name: Copy or
 * Text setup link gives `/setup?invite=<signed token>` (setup-invite.server.ts),
 * the person opens it, adds their email, and we send the usual setup email to
 * it. Their email is proven by that email's link, never by typing it, so a
 * forwarded or mistyped link can't hand a coaching record to someone else.
 * When the record has an email, the link only sends to that one (shown masked).
 */

/** How long a no-email setup link stays usable. It dies sooner once the record has a login. */
export const SETUP_INVITE_DAYS = 14;

/** A short wait between setup emails asked for from one link. */
export const SETUP_INVITE_RESEND_MS = 60_000;

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

/** What the invite page can offer for a client record. */
export type SetupInviteState =
  | { state: "invalid" }
  | { state: "signed_in_before" }
  | { state: "ok"; firstName: string | null; emailHint: string | null };

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
  return { state: "ok", firstName, emailHint: maskEmail(client.email) };
}
