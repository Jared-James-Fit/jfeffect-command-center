/**
 * What's waiting on the coach's review: one rule for the dashboard's
 * "Check-ins to review", Forms → Submissions' "To review" and the Messages
 * inbox's "Forms to review" (pure, tested in review-queue.test.ts), so the
 * three never disagree.
 *
 * A submission waits on the coach while it's
 *  - not reviewed (a check-in's or form's own reviewed mark; a staff reply in
 *    the chat sets it by trigger, tg_staff_reply_closes_reviews),
 *  - not superseded,
 *  - sent in the last TO_REVIEW_DAYS (an old backlog never buries this week's),
 *  - and the client's newest of its type (a newer weekly check-in, or a newer
 *    response to the same form, replaces the older one, reviewed or not, so
 *    reviewing the newest never brings an older one back).
 * Something reviewed elsewhere (progress photos: `reviewed: null`) never waits.
 */

export const TO_REVIEW_DAYS = 30;

export type ReviewCandidate = {
  clientId: string | null;
  /** What "the same thing again" means: "checkin:weekly_checkin", "native:<form id>". */
  type: string;
  submittedAt: string | null;
  /** true / false where the coach marks it reviewed; null where review lives elsewhere. */
  reviewed: boolean | null;
  superseded?: boolean;
};

const DAY_MS = 86_400_000;

function fresh(submittedAt: string | null, now: number): number | null {
  if (!submittedAt) return null;
  const t = Date.parse(submittedAt);
  return Number.isFinite(t) && now - t <= TO_REVIEW_DAYS * DAY_MS ? t : null;
}

/** The candidates waiting on the coach, in the order given. */
export function waitingForReview<T extends ReviewCandidate>(rows: T[], now = Date.now()): T[] {
  const newest = new Map<string, number>();
  for (const r of rows) {
    if (!r.clientId || !r.submittedAt) continue;
    const t = Date.parse(r.submittedAt);
    if (!Number.isFinite(t)) continue;
    const k = `${r.clientId}|${r.type}`;
    if ((newest.get(k) ?? -Infinity) < t) newest.set(k, t);
  }
  return rows.filter((r) => {
    if (r.reviewed !== false || r.superseded) return false;
    const t = fresh(r.submittedAt, now);
    if (t == null) return false;
    return !r.clientId || newest.get(`${r.clientId}|${r.type}`) === t;
  });
}
