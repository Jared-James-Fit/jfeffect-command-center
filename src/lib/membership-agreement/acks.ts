// The JF Membership Agreement a self-serve member accepts in the app. The
// text itself is the published `membership-agreement` legal document (Admin →
// Legal), so a new version there is what asks every member to accept again.

export const MEMBERSHIP_AGREEMENT_SLUG = "membership-agreement";

/** The ticks a member gives, each recorded word for word with their typed name. */
export const MEMBERSHIP_AGREEMENT_ACKS = [
  {
    id: "terms",
    text: "I have read and agree to the JF Membership Agreement, the Terms of Service and the Privacy Policy.",
  },
  {
    id: "health",
    text: "I am healthy enough to train, or a doctor has cleared me to. I will stop and get help if something feels wrong, and I will check with a professional about any health condition, injury, medication or pregnancy before I train.",
  },
  {
    id: "risk",
    text: "I understand training can cause injury, that plans, targets and app tools are general and not made for me, and that I give up claims against JF Effect (including for negligence) as far as the law allows.",
  },
] as const;

export type MembershipAckId = (typeof MEMBERSHIP_AGREEMENT_ACKS)[number]["id"];

/** The short version shown above the full text. */
export const MEMBERSHIP_AGREEMENT_SUMMARY = [
  "Self-serve: you pick the plan, the days and the weights. No coach writes or reviews your program.",
  "Plans, nutrition targets and app tools are general guides, not medical advice.",
  "Training carries risk. You train within your limits and accept that risk.",
  "Crew is a community: be decent, and what you post is seen by the audience you pick.",
  "Monthly billing until you cancel from Membership in the app. Cancelling keeps access to the end of the period.",
] as const;

export function membershipAckText(ids: readonly string[]): string | null {
  const all = MEMBERSHIP_AGREEMENT_ACKS.map((a) => a.id as string);
  if (all.some((id) => !ids.includes(id))) return null;
  return MEMBERSHIP_AGREEMENT_ACKS.map((a) => `[x] ${a.text}`).join("\n");
}
