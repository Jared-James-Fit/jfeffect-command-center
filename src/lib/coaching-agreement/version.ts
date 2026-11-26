/**
 * Version numbers for the Coaching Agreement, kept apart from the agreement text so code
 * that only compares versions (the status rules and the launch popup, which load on every
 * signed-in page) doesn't pull the whole text into the app's main bundle.
 */
export const AGREEMENT_VERSION = "3.2";

/**
 * Clients whose latest signed version is below this must sign again. Raise it only
 * for material changes; a wording-only fix can bump AGREEMENT_VERSION without
 * forcing every client to re-sign.
 *
 * 2.1 changed only how the Coach is named (the individual, Jared McIntyre, carrying on
 * business as JF Effect, instead of the "Jared James Fit" trade name). The signed 2.0
 * text already named him personally as the operator and in the release, so it stays
 * valid and nobody who signed 2.0 is asked again.
 *
 * 2.2 names each client's coach (filled in per client and saved with the signature), and adds
 * the app, Community and in-person session rules. New signers get it; everyone who already
 * signed 2.0 or 2.1 stays signed on the version they agreed to and is never asked again for it.
 * Their signed versions already cover in-person training, the app and the release.
 *
 * 2.3 says in the agreement itself that messages are kept as coaching records, including the
 * original of one a client edits or deletes (only admins see it). That is already covered for
 * everyone who signed earlier by their privacy section, which collects messages and defers to the
 * Privacy Policy (updated the same day, with notice), so earlier signers are not asked again.
 *
 * 2.4 changes only where written notices go: cancellations, freezes and billing questions now go
 * to coaching@jfeffect.com (the JF Effect business inbox) instead of a personal Gmail address. Nothing
 * else changes, so nobody is asked to sign again. Earlier signers keep the address in their signed
 * copy, and that inbox stays monitored.
 *
 * 3.0 (Nov 24 2026) says how plans work in the app: a monthly plan is cancelled or changed in the
 * app (or by email), upgrades start now and are prorated, downgrades and cancellations take effect when
 * the paid period ends, coaching is bought only after the Coach approves it, a special (grandfathered)
 * price is kept until the client switches or cancels and is never changed without consent, and billing
 * details are updated through Stripe from the app. Nobody who signed earlier is asked to sign again
 * (their signed copy stays theirs); signing 3.0 is asked before a coaching purchase or a self-service
 * plan switch (plan-engine.ts PLAN_AGREEMENT_VERSION), because 3.0 is the text that describes it.
 *
 * 3.1 (Nov 25 2026) makes AI tools optional in the words too: sending a client's information to
 * outside AI services (OpenAI, Google) is a separate permission (src/lib/ai-consent), never part of
 * signing, so the required privacy acknowledgement no longer consents to AI tools and the privacy
 * section says how that permission is given and withdrawn. Nothing else changes; nobody re-signs.
 *
 * 3.2 removes the duplicate AI permission from signing; no change to consent scope or re-signing.
 *
 * This must stay "2.0" (the database view coaching_agreement_resign_below_version() says the
 * same, and a test checks it).
 */
export const RESIGN_REQUIRED_BELOW_VERSION = "2.0";

/** Compares dotted numeric versions ("2.0" < "2.1" < "10.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
