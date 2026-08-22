/**
 * Pure presentation helper for the Summary → "Account & Access" card.
 *
 * The old top-level "Account Setup" card was removed from the client profile
 * shell; the non-duplicated fields (account status, account created, invite
 * status, manage access) now live here. "Last signed in" intentionally stays
 * in App Activity only — it must not be repeated.
 */

export type ClientAccountAccessInput = {
  user_id?: string | null;
  account_created_at?: string | null;
  invite_sent_at?: string | null;
  invite_expires_at?: string | null;
  last_signed_in_at?: string | null;
  portal_access_disabled?: boolean | null;
  email?: string | null;
  needs_admin_help?: boolean | null;
};

export type ClientAccountAccess = {
  statusLabel: string;
  /** true when the coach needs to act (invite missing/expired, access off…). */
  needsAttention: boolean;
  accountCreatedAt: string | null;
  inviteStatusLabel: string;
  /** Fields intentionally excluded because App Activity already shows them. */
  excludedFields: readonly string[];
};

function toDate(v?: string | null) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

export function describeAccountAccess(
  input: ClientAccountAccessInput,
  now: number = Date.now(),
): ClientAccountAccess {
  const hasAccount = !!input.account_created_at || !!input.user_id;
  const inviteSent = toDate(input.invite_sent_at);
  const expires = toDate(input.invite_expires_at);
  const inviteExpired = !hasAccount && expires !== null && expires <= now;
  const accessDisabled = !!input.portal_access_disabled;
  const missingEmail = !input.email;

  let statusLabel: string;
  let needsAttention: boolean;
  if (accessDisabled) {
    statusLabel = "Access disabled";
    needsAttention = true;
  } else if (!hasAccount && inviteExpired) {
    statusLabel = "Invite expired";
    needsAttention = true;
  } else if (!hasAccount && inviteSent !== null) {
    statusLabel = "Invite pending";
    needsAttention = true;
  } else if (!hasAccount) {
    statusLabel = "No account";
    needsAttention = true;
  } else if (input.last_signed_in_at) {
    statusLabel = "Live";
    needsAttention = false;
  } else {
    statusLabel = "Never signed in";
    needsAttention = true;
  }

  if (missingEmail || input.needs_admin_help) needsAttention = true;

  const inviteStatusLabel = inviteSent === null
    ? "Not sent"
    : inviteExpired
      ? "Expired"
      : hasAccount
        ? "Completed"
        : "Sent";

  return {
    statusLabel,
    needsAttention,
    accountCreatedAt: input.account_created_at ?? null,
    inviteStatusLabel,
    excludedFields: ["last_signed_in_at", "last_active_at"],
  };
}
