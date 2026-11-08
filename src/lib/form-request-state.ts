/**
 * Where a one-off form request stands (pure, tested): the Nutrition Update
 * Request is asked for (nf_assignments, re-sent = updated), answered once, and
 * its AI plan written on the server.
 */

/** A one-off form's last submission answers its latest request (sent at or after it was asked for). */
export function sentSinceAsked(
  last: { submitted_at?: string | null; created_at: string },
  asked: { created_at: string; updated_at?: string | null } | null | undefined,
): boolean {
  if (!asked) return false;
  const askedAt = asked.updated_at ?? asked.created_at;
  return Date.parse(last.submitted_at ?? last.created_at) >= Date.parse(askedAt);
}

/** Two clocks stamp a request and its answer (the database, the phone): this much slack. */
export const REQUEST_CLOCK_SLACK_MS = 60_000;

/**
 * What a form request's chat card shows (`FormRequestChatCard`): the newest
 * submission SENT at or after the request, the same rule as the Forms
 * tracker and the inbox (`matchFormRequests`, `pickUnfilledFormRequests`),
 * else a draft still being filled in (opening the form continues it), else
 * nothing. Never by when the draft was started: Jared opened his Nutrition
 * Update on Oct 4, the monthly request came Oct 26, he sent it Nov 8, and a
 * card that only counted drafts started after Oct 26 kept saying "Start" to
 * him and "Waiting for client" to the coach, with no answers or plan shown.
 */
export function requestCardSubmission<S extends { status: string; submitted_at?: string | null; created_at: string }>(
  subs: S[],
  sentAt: string | null | undefined,
): S | null {
  const from = sentAt ? Date.parse(sentAt) - REQUEST_CLOCK_SLACK_MS : -Infinity;
  let sent: S | null = null;
  let sentT = -Infinity;
  for (const s of subs) {
    if (s.status === "in_progress") continue;
    const t = Date.parse(s.submitted_at ?? s.created_at);
    if (Number.isFinite(t) && t >= from && t > sentT) { sent = s; sentT = t; }
  }
  if (sent) return sent;
  return subs.find((s) => s.status === "in_progress") ?? null;
}

/**
 * The request the coach's panel is about: the newest one, except that a blank
 * form opened after they'd already answered the latest request isn't a new one.
 */
export function currentRequest<R extends { status: string; submitted_at?: string | null }>(requests: R[], requestedAt: string | null): R | null {
  const done = requests.find((r) => r.status !== "in_progress") ?? null;
  if (done && (!requestedAt || Date.parse(done.submitted_at ?? "") >= Date.parse(requestedAt))) return done;
  return requests[0] ?? null;
}

/** No plan for a sent request, or one stuck "generating" over 3 minutes. */
export function planMissing(plan: { status?: string | null; updated_at?: string | null } | null | undefined, now = Date.now()): boolean {
  if (!plan) return true;
  if (plan.status === "pending") return true;
  return plan.status === "generating" && !!plan.updated_at && now - Date.parse(plan.updated_at) > 3 * 60_000;
}
