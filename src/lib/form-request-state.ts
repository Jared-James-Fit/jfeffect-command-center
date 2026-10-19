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
