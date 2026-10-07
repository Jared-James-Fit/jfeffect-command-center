/**
 * Version numbers for the Coaching Agreement, kept apart from the agreement text so code
 * that only compares versions (the status rules and the launch popup, which load on every
 * signed-in page) doesn't pull the whole text into the app's main bundle.
 */
export const AGREEMENT_VERSION = "2.1";

/**
 * Clients whose latest signed version is below this must sign again. Raise it only
 * for material changes; a wording-only fix can bump AGREEMENT_VERSION without
 * forcing every client to re-sign.
 *
 * 2.1 changed only how the Coach is named (the individual, Jared McIntyre, carrying on
 * business as JF Effect, instead of the "Jared James Fit" trade name). The signed 2.0
 * text already named him personally as the operator and in the release, so it stays
 * valid and nobody who signed 2.0 is asked again. This must stay "2.0" (the database
 * view coaching_agreement_resign_below_version() says the same, and a test checks it).
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
