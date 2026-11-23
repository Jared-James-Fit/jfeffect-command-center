/**
 * Membership (Nov 23 2026): what changing someone's plan would do, and what stops it. Pure.
 *
 * The free membership and coaching are the same record at two tiers (clients.service_tier), so a
 * change keeps every workout, record and message. What it can't do safely is leave money moving:
 * a coaching subscription that would keep charging must be stopped first (Billing → auto-pay, the
 * Stripe-safe path; nothing here calls Stripe), and what they owe stays owed either way.
 */
export type PlanTier = "membership" | "coaching";

export type PlanChangeReview = {
  clientId: string;
  name: string;
  tier: PlanTier;
  hasLogin: boolean;
  inactive: boolean;
  liveCharges: { name: string; nextCharge: string | null }[];
  endingCharges: { name: string; nextCharge: string | null }[];
  owedCents: number;
  upcomingSessions: number;
  memberRecord: boolean;
  memberAccessOff: boolean;
  assignedCoachId: string | null;
  coaches: { id: string; name: string }[];
  problems: string[];
};

/** Why a change can't happen (empty: it can). `to` defaults to the other tier. */
export function planChangeProblems(r: Omit<PlanChangeReview, "problems">, to?: PlanTier): string[] {
  const target: PlanTier = to ?? (r.tier === "coaching" ? "membership" : "coaching");
  const out: string[] = [];
  if (!r.hasLogin) out.push(`${r.name} hasn't signed in yet, so there's no app account to move. Send their setup link first.`);
  if (r.inactive) out.push(`${r.name}'s account is deactivated or being deleted. Reactivate it first.`);
  if (target === "membership" && r.liveCharges.length)
    out.push(
      `${r.liveCharges.map((c) => c.name).join(", ")} would keep charging. Stop auto-pay from their Billing first (changing plans never charges or refunds anything).`,
    );
  return out;
}

/** What the change means for this person, in plain lines, before anyone confirms it. */
export function planChangeLines(r: PlanChangeReview, to: PlanTier): string[] {
  const lines: string[] = [];
  lines.push("Same account: workouts, records, programs, Crew posts and messages all stay.");
  if (to === "membership") {
    lines.push("They keep the free app: workouts, programs, Crew, the food log and progress.");
    lines.push("Coaching stops for them: check-ins, the coach chat, the agreement, nutrition plans and PT booking are hidden (their history is kept).");
    if (r.endingCharges.length)
      lines.push(`${r.endingCharges.map((c) => c.name).join(", ")} already ends at its period's end; nothing more is charged.`);
    if (r.upcomingSessions)
      lines.push(`${r.upcomingSessions} booked session${r.upcomingSessions === 1 ? " stays" : "s stay"} booked; cancel from their Sessions if they shouldn't happen.`);
    if (r.memberAccessOff) lines.push("Their member access is switched off; switch it back on from their member page if they should use the app.");
  } else {
    lines.push("They get the coaching side: the coach chat, check-ins, the agreement, nutrition plans and PT booking.");
    lines.push("Nothing is charged: sell their package from Sales or their Billing.");
  }
  if (r.owedCents > 0) lines.push(`They still owe $${(r.owedCents / 100).toFixed(2)}; that stays owed.`);
  return lines;
}
