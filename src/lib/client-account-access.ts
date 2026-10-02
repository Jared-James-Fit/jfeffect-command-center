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
  stage: "no_account" | "setup_pending" | "setup_expired" | "account_no_signin" | "live" | "access_disabled";
  primaryAction: "send_setup" | "resend_setup" | "password_recovery" | "none";
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
  const hasAccount = !!input.account_created_at || !!input.user_id || !!input.last_signed_in_at;
  const inviteSent = toDate(input.invite_sent_at);
  const expires = toDate(input.invite_expires_at);
  const inviteExpired = !hasAccount && expires !== null && expires <= now;
  const accessDisabled = !!input.portal_access_disabled;
  const missingEmail = !input.email;

  let statusLabel: string;
  let needsAttention: boolean;
  let stage: ClientAccountAccess["stage"];
  let primaryAction: ClientAccountAccess["primaryAction"];
  if (accessDisabled) {
    statusLabel = "Access disabled";
    needsAttention = true;
    stage = "access_disabled";
    primaryAction = "none";
  } else if (!hasAccount && inviteExpired) {
    statusLabel = "Invite expired";
    needsAttention = true;
    stage = "setup_expired";
    primaryAction = "resend_setup";
  } else if (!hasAccount && inviteSent !== null) {
    statusLabel = "Waiting on client";
    needsAttention = true;
    stage = "setup_pending";
    primaryAction = "resend_setup";
  } else if (!hasAccount) {
    statusLabel = "No account";
    needsAttention = true;
    stage = "no_account";
    primaryAction = "send_setup";
  } else if (input.last_signed_in_at) {
    statusLabel = "Live";
    needsAttention = false;
    stage = "live";
    primaryAction = "password_recovery";
  } else {
    statusLabel = "Never signed in";
    needsAttention = true;
    stage = "account_no_signin";
    primaryAction = "password_recovery";
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
    stage,
    primaryAction,
    excludedFields: ["last_signed_in_at", "last_active_at"],
  };
}
