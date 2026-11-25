/**
 * The coach's morning game plan: one push with everything about clients that's
 * waiting, instead of a push per thing (Nov 25 2026, T01). Pure and tested in
 * coach-digest.test.ts; scheduled-pushes.server.ts counts and sends it at 8 AM
 * local, once a day, only when something's there.
 */
export type CoachDigestCounts = {
  /** Today's sessions and calls, already said as one line ("2 sessions · 1 call, first at 7:00 AM (Sam)"). */
  today?: string | null;
  checkInsToReview: number;
  programsEnding: number;
  onboardingIncomplete: number;
  failedPayments: number;
  unansweredMessages: number;
  nutritionDue: number;
  nutritionPlansToApply: number;
  liftVideos: number;
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Most urgent first: money and people waiting on a reply, then reviews, then planning. */
export function coachDigestLines(c: CoachDigestCounts): string[] {
  return [
    c.today ? `Today: ${c.today}` : null,
    c.failedPayments > 0 ? `${n(c.failedPayments, "failed payment")}` : null,
    c.unansweredMessages > 0 ? `${n(c.unansweredMessages, "client")} waiting on a reply` : null,
    c.checkInsToReview > 0 ? `${n(c.checkInsToReview, "check-in")} to review` : null,
    c.onboardingIncomplete > 0 ? `${n(c.onboardingIncomplete, "new client")} still onboarding` : null,
    c.programsEnding > 0 ? `${n(c.programsEnding, "program")} ending this week` : null,
    c.nutritionDue > 0 ? `${n(c.nutritionDue, "nutrition update")} due` : null,
    c.nutritionPlansToApply > 0 ? `${n(c.nutritionPlansToApply, "nutrition plan")} to apply` : null,
    c.liftVideos > 0 ? `${n(c.liftVideos, "lift video")} to review` : null,
  ].filter((l): l is string => !!l);
}

/** Where the push opens: the first thing that needs the coach. */
export function coachDigestUrl(c: CoachDigestCounts): string {
  if (c.failedPayments > 0) return "/admin/plans";
  if (c.unansweredMessages > 0) return "/admin/messages";
  if (c.checkInsToReview > 0) return "/admin/check-in-reviews";
  if (c.onboardingIncomplete > 0 || c.programsEnding > 0) return "/admin/clients?sort=attention";
  if (c.nutritionDue > 0 || c.nutritionPlansToApply > 0) return "/admin/nutrition-targets";
  if (c.liftVideos > 0) return "/admin/lift-videos";
  return "/admin/calendar?tab=upcoming";
}

/** The push: a title, at most four lines (the rest counted), or null when nothing's waiting. */
export function coachDigest(c: CoachDigestCounts): { title: string; body: string; url: string } | null {
  const lines = coachDigestLines(c);
  if (!lines.length) return null;
  const shown = lines.slice(0, 4);
  const more = lines.length - shown.length;
  return { title: "Coach Game Plan", body: shown.join(" · ") + (more > 0 ? ` · +${more} more` : ""), url: coachDigestUrl(c) };
}

/** A client is waiting on a reply when the last message in their chat is theirs and older than this. */
export const UNANSWERED_HOURS = 12;

/** From each chat's last message: how many clients are waiting on the coach. */
export function unansweredCount(lastByClient: Iterable<{ sender_role: string | null; created_at: string }>, now: Date, hours = UNANSWERED_HOURS): number {
  let count = 0;
  for (const m of lastByClient) {
    if (m.sender_role === "client" && now.getTime() - Date.parse(m.created_at) >= hours * 3_600_000) count++;
  }
  return count;
}

/** Clients whose latest program ends within `days` (and nothing later is planned). */
export function programsEndingCount(blocks: Iterable<{ client_id: string; end_date: string | null }>, today: string, days = 7): number {
  const latest = new Map<string, string>();
  for (const b of blocks) {
    if (!b.end_date) continue;
    const cur = latest.get(b.client_id);
    if (!cur || b.end_date > cur) latest.set(b.client_id, b.end_date);
  }
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const until = limit.toISOString().slice(0, 10);
  let count = 0;
  for (const end of latest.values()) if (end >= today && end <= until) count++;
  return count;
}
