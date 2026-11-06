import { MEMBERSHIP_AGREEMENT_SLUG } from "@/lib/membership-agreement/acks";

/**
 * Which published legal documents a person is asked about in Account →
 * Privacy & legal (listMyLegalStatus, which also feeds the acceptance gate).
 * Pure, tested.
 *
 * The JF Membership Agreement and its Recurring Billing Disclosure belong to
 * JF members: a coaching client signs the Coaching Agreement instead. A member
 * is asked about the agreement only from the version the app has them sign
 * (IN_APP_SIGNING_FROM_VERSION; earlier versions were accepted at checkout and
 * describe the old paid plan), and about the billing disclosure only with a
 * paid membership (a Stripe subscription). Every other document applies to
 * everyone, as before.
 */
export const RECURRING_BILLING_SLUG = "recurring-billing-disclosure";
export const MEMBER_LEGAL_SLUGS: readonly string[] = [MEMBERSHIP_AGREEMENT_SLUG, RECURRING_BILLING_SLUG];

export type LegalViewer = {
  /** clients.service_tier of the person's own client row (null: none, e.g. staff) */
  tier: "coaching" | "self_serve" | null;
  /** they have (or had) a paid JF membership subscription */
  paidMembership: boolean;
};

export function legalDocApplies(
  doc: { slug: string; version_number: number },
  viewer: LegalViewer,
  memberSigningFromVersion: number,
): boolean {
  if (!MEMBER_LEGAL_SLUGS.includes(doc.slug)) return true;
  if (viewer.tier !== "self_serve") return false;
  if (doc.slug === MEMBERSHIP_AGREEMENT_SLUG) return doc.version_number >= memberSigningFromVersion;
  return viewer.paidMembership;
}
