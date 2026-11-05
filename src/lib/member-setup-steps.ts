/**
 * What a JF member is asked for before setup counts as done (pure, tested).
 *
 * A free account (subscription_status 'Free', no Stripe subscription) is
 * asked only what the app uses to plan their training: a goal, their
 * experience and the days they train. The paid / in-person membership keeps
 * its full setup (an ID photo, phone, date of birth, address, emergency
 * contact) for billing, waivers and sessions. The database's
 * member_setup_complete makes the same split (20270129120000_free_member_setup.sql).
 */

export type SetupStep = "photo" | "contact" | "basics" | "goals" | "schedule";

export const FULL_SETUP_STEPS: readonly SetupStep[] = [
  "photo",
  "contact",
  "basics",
  "goals",
  "schedule",
];
export const FREE_SETUP_STEPS: readonly SetupStep[] = ["goals", "schedule"];

export type SetupMember = {
  subscription_status?: string | null;
  stripe_subscription_id?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  sms_opt_out?: boolean | null;
  sms_consent_at?: string | null;
  date_of_birth?: string | null;
  address_line1?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  goals?: string | null;
  goals_tags?: string[] | null;
  experience_level?: string | null;
  training_background?: string | null;
  committed_training_days?: string[] | null;
};

export function isFreeAccount(
  m: Pick<SetupMember, "subscription_status" | "stripe_subscription_id"> | null | undefined,
): boolean {
  if (!m) return false;
  return (
    String(m.subscription_status ?? "")
      .trim()
      .toLowerCase() === "free" && !m.stripe_subscription_id
  );
}

export function setupStepsFor(m: SetupMember | null | undefined): readonly SetupStep[] {
  return isFreeAccount(m) ? FREE_SETUP_STEPS : FULL_SETUP_STEPS;
}

const filled = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** What's still missing (empty = setup is done). Same rules as member_setup_complete. */
export function setupMissing(m: SetupMember): string[] {
  const missing: string[] = [];
  if (!isFreeAccount(m)) {
    if (!filled(m.avatar_url)) missing.push("avatar_url");
    if (!filled(m.phone)) missing.push("phone");
    if (m.sms_opt_out && !m.sms_consent_at) missing.push("sms_consent");
    if (!m.date_of_birth) missing.push("date_of_birth");
    if (!filled(m.address_line1)) missing.push("address_line1");
    if (!filled(m.emergency_contact_name)) missing.push("emergency_contact_name");
    if (!filled(m.emergency_contact_phone)) missing.push("emergency_contact_phone");
  }
  const hasGoals = filled(m.goals) || (Array.isArray(m.goals_tags) && m.goals_tags.length > 0);
  if (!hasGoals) missing.push("goals");
  if (!filled(m.training_background) && !m.experience_level) missing.push("training_background");
  if (!m.committed_training_days || m.committed_training_days.length === 0)
    missing.push("committed_training_days");
  return missing;
}

/** The query MemberSetupGate and the setup wizard read (getMySetupStatus). */
export const MEMBER_SETUP_STATUS_KEY = ["m-setup-status"] as const;

/**
 * Whether member setup is still in the way, from that query's state (pure):
 * loading, or a JF member (not an admin sandbox) whose setup isn't complete.
 * No state at all means no setup gate is mounted (a coaching client). The
 * launch popups (Add to Home Screen, "Pounds or kilograms?") wait on it, so a
 * new member gets setup first and never a popup stacked on it.
 */
export function setupStillOpen(
  state: { status: string; data?: unknown } | undefined | null,
): boolean {
  if (!state) return false;
  if (state.status === "pending") return true;
  const d = state.data as
    | { complete?: boolean; member?: { account_type?: string; is_admin_sandbox?: boolean } | null }
    | undefined;
  return (
    d?.complete === false && d.member?.account_type === "jf_member" && !d.member?.is_admin_sandbox
  );
}
