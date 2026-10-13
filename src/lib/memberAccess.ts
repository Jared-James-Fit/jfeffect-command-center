/**
 * Shared access helper. Single source of truth for whether a member
 * should be allowed past gated /m/* routes and protected data reads.
 *
 * Order matters: the kill switch wins, then overrides, then subscription,
 * then grace, then hard expiry.
 */

export type MemberAccessInput = {
  manual_access_override?: boolean | null;
  manual_access_disabled?: boolean | null;
  subscription_status?: string | null;
  status?: string | null;
  access_end_date?: string | Date | null;
  in_grace?: boolean | null;
  /** When a cancelled subscription's paid period ends (cancel_at, else current_period_end). */
  cancel_at?: string | Date | null;
  current_period_end?: string | Date | null;
};

// Billing writes these as "Active", "Trialing", "Complimentary" (any case).
const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "admin_granted", "complimentary"]);
// Cancelled, but the month is paid for: access until the period ends.
// ("Hold Plan" and "Paused" stay locked on purpose: data kept, features off.)
const CANCELS_AT_PERIOD_END = "active (cancels at period end)";
const INACTIVE_STATUSES = new Set(["expired", "cancelled", "canceled"]);

function toMs(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function isMemberAccessActive(
  member: MemberAccessInput | null | undefined,
): boolean {
  if (!member) return false;

  // 1. Admin kill switch — always wins.
  if (member.manual_access_disabled === true) return false;

  const now = Date.now();
  const endMs = toMs(member.access_end_date ?? null);
  const accessExpired = endMs !== null && endMs <= now;

  // 2. Admin override grants access (kill switch already ruled out).
  if (member.manual_access_override === true) return true;

  // 3. Grace period keeps access on temporarily.
  if (member.in_grace === true) return true;

  // 4. Hard expiry past with no override / grace → denied.
  if (accessExpired) return false;

  // 5. Inactive lifecycle status with no override / grace → denied.
  const status = (member.status ?? "").toLowerCase();
  if (INACTIVE_STATUSES.has(status)) return false;

  // 6. Active subscription status → allowed (if not past access_end_date).
  const sub = (member.subscription_status ?? "").trim().toLowerCase();
  if (ACTIVE_SUB_STATUSES.has(sub)) return true;

  // 7. Cancelled at period end → allowed until the paid period is over.
  if (sub === CANCELS_AT_PERIOD_END) {
    const until = toMs(member.cancel_at ?? null) ?? toMs(member.current_period_end ?? null);
    return until === null || until > now;
  }

  return false;
}