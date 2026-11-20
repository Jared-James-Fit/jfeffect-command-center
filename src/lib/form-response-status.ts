/**
 * Who a form is out with and where each person stands (pure, tested): one
 * reading for the Forms library's numbers, the responses viewer and the chat
 * card, and the same rule as the database's nf_form_library_stats(), so a form
 * never reads "Sent to 14 · 8 answered · 7 waiting" (15 of 14).
 *
 * A person is anyone the form was asked of (an nf_assignments row, "asked" =
 * its updated_at, which every send and the monthly request move) or who sent
 * or started it. Their state is about the LATEST request:
 *   answered    a response came in at or after it was last asked for
 *               (or it was never asked for: they opened it themselves)
 *   in_progress a draft was touched (the row or any answer on it) since it
 *               was last asked for, nothing sent
 *   waiting     asked, and nothing since (answered before + asked again counts
 *               here, said as "Asked again")
 * A form they keep updating (a meet checklist, `allow_updates`) is one copy:
 * once they've sent it, sending it again is a nudge, not a new request, so
 * only a fresh copy (`settings.new_copy_since`, sent for another meet) asks
 * again (`effectiveAsk`).
 * Someone archived or deactivated isn't waiting on anything: they leave the
 * people count unless they answered (`counted`), and their answers stay in
 * the responses either way.
 * answered + in_progress + waiting = people, always.
 */

/** A send and the answer can be stamped a moment apart: one minute's grace. */
export const ASK_GRACE_MS = 60_000;

/** An unreviewed response counts as "to review" only this fresh (TO_REVIEW_DAYS in form-submissions.ts). */
export const RESPONSE_REVIEW_DAYS = 30;

export type PersonState = "answered" | "in_progress" | "waiting";

export type AssignmentRow = {
  client_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  last_sent_at?: string | null;
  /** `new_copy_since`: a form they keep updating was sent for something new (another meet). */
  settings?: { new_copy_since?: string | null } | null;
  client?: { full_name?: string | null; archived?: boolean | null } | null;
};

export type SubmissionRow = {
  id: string;
  client_id: string;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  answers_updated_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  /** A draft's latest answer change (nf_answers.updated_at): saving an answer never moves the submission's own row. */
  answers_touched_at?: string | null;
  client?: { full_name?: string | null; archived?: boolean | null } | null;
};

export type ResponseSummary = {
  id: string;
  /** When it was sent (submitted_at, else created_at). */
  at: string;
  reviewed: boolean;
  status: string;
  answersUpdatedAt: string | null;
};

export type FormPerson = {
  clientId: string;
  name: string;
  state: PersonState;
  /** When it was last asked for (null: never asked, they opened it themselves). */
  askedAt: string | null;
  lastSentAt: string | null;
  /** Their sent responses, newest first. */
  responses: ResponseSummary[];
  /** Their draft, when one was touched since the last ask. */
  draft: { id: string; at: string } | null;
  /** Answered once and was asked again since. */
  askedAgain: boolean;
  inactive: boolean;
  /** In the people counts: everyone but an archived / deactivated client who hadn't answered (they're not waiting on anything). */
  counted: boolean;
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const isSent = (s: Pick<SubmissionRow, "status">) => s.status !== "in_progress";
export const responseAt = (s: Pick<SubmissionRow, "submitted_at" | "created_at">) => s.submitted_at ?? s.created_at;
/** When a draft was last touched: the row itself, or its latest answer (the database's draft_at). */
const draftAt = (s: Pick<SubmissionRow, "updated_at" | "created_at" | "answers_touched_at">) => {
  const t = [s.created_at, s.updated_at, s.answers_touched_at].map(ms).filter(Number.isFinite);
  return new Date(Math.max(0, ...t)).toISOString();
};
export const isReviewed = (s: Pick<SubmissionRow, "status" | "reviewed_at">) => !!s.reviewed_at || s.status === "reviewed";

/** The rule itself (mirrored in nf_form_library_stats). */
export function personState(i: { askedAt: string | null; answeredAt: string | null; draftAt: string | null }): PersonState | null {
  const asked = ms(i.askedAt);
  const since = (iso: string | null) => !!iso && (!Number.isFinite(asked) || ms(iso) >= asked - ASK_GRACE_MS);
  if (since(i.answeredAt)) return "answered";
  if (since(i.draftAt)) return "in_progress";
  if (Number.isFinite(asked)) return "waiting";
  return null;
}

/**
 * When it was last asked for, as far as answering goes: the send itself, except
 * that a form they keep updating which they've already sent is only asked again
 * by a fresh copy (`new_copy_since`), never by a nudge.
 */
export function effectiveAsk(a: AssignmentRow | null | undefined, opts: { keepsUpdating?: boolean; hasSent?: boolean } = {}): string | null {
  if (!a) return null;
  if (opts.keepsUpdating && opts.hasSent) {
    const fresh = a.settings?.new_copy_since;
    return typeof fresh === "string" && Number.isFinite(Date.parse(fresh)) ? fresh : null;
  }
  return a.updated_at ?? a.created_at ?? null;
}

/** Everyone a form is out with, one row each, from its assignments and submissions. */
export function formPeople(assignments: AssignmentRow[], submissions: SubmissionRow[], opts: { keepsUpdating?: boolean } = {}): FormPerson[] {
  const byClient = new Map<string, { asg?: AssignmentRow; subs: SubmissionRow[]; name: string; inactive: boolean }>();
  const entry = (id: string, client: { full_name?: string | null; archived?: boolean | null } | null | undefined) => {
    let e = byClient.get(id);
    if (!e) {
      e = { subs: [], name: client?.full_name?.trim() || "Client", inactive: !!client?.archived };
      byClient.set(id, e);
    } else if (client) {
      if (e.name === "Client" && client.full_name?.trim()) e.name = client.full_name.trim();
      if (client.archived) e.inactive = true;
    }
    return e;
  };
  for (const a of assignments) entry(a.client_id, a.client).asg = a;
  for (const s of submissions) entry(s.client_id, s.client).subs.push(s);

  const out: FormPerson[] = [];
  for (const [clientId, e] of byClient) {
    const sent = e.subs.filter(isSent).sort((a, b) => ms(responseAt(b)) - ms(responseAt(a)));
    const askedAt = effectiveAsk(e.asg, { keepsUpdating: opts.keepsUpdating, hasSent: sent.length > 0 });
    const drafts = e.subs.filter((s) => !isSent(s)).sort((a, b) => ms(draftAt(b)) - ms(draftAt(a)));
    const answeredAt = sent[0] ? responseAt(sent[0]) : null;
    const latestDraft = drafts[0] ? draftAt(drafts[0]) : null;
    const state = personState({ askedAt, answeredAt, draftAt: latestDraft });
    if (!state) continue;
    out.push({
      clientId,
      name: e.name,
      state,
      askedAt,
      lastSentAt: e.asg?.last_sent_at ?? null,
      responses: sent.map((s) => ({ id: s.id, at: responseAt(s), reviewed: isReviewed(s), status: s.status, answersUpdatedAt: s.answers_updated_at ?? null })),
      draft: state === "in_progress" && drafts[0] ? { id: drafts[0].id, at: latestDraft! } : null,
      askedAgain: state === "waiting" && sent.length > 0,
      inactive: e.inactive,
      counted: state === "answered" || !e.inactive,
    });
  }
  return out;
}

export type ResponseCounts = {
  people: number;
  answered: number;
  inProgress: number;
  waiting: number;
  /** Every response sent in, all people, all requests. */
  responses: number;
  /** Responses not reviewed yet, from the last RESPONSE_REVIEW_DAYS. */
  toReview: number;
  /** Archived / deactivated clients shown for their past answers but out of the people counts. */
  archived: number;
};

export function responseCounts(people: FormPerson[], now = Date.now()): ResponseCounts {
  const c: ResponseCounts = { people: people.length, answered: 0, inProgress: 0, waiting: 0, responses: 0, toReview: 0, archived: 0 };
  c.people = 0;
  for (const p of people) {
    c.responses += p.responses.length;
    c.toReview += p.responses.filter((r) => !r.reviewed && now - ms(r.at) <= RESPONSE_REVIEW_DAYS * 86_400_000).length;
    if (!p.counted) {
      c.archived++;
      continue;
    }
    c.people++;
    if (p.state === "answered") c.answered++;
    else if (p.state === "in_progress") c.inProgress++;
    else c.waiting++;
  }
  return c;
}

/** "8 answered · 1 in progress · 5 waiting", only the parts that aren't zero; null when it's out with nobody. */
export function countsLine(c: Pick<ResponseCounts, "people" | "answered" | "inProgress" | "waiting">): string | null {
  if (!c.people) return null;
  const parts = [
    c.answered ? `${c.answered} answered` : null,
    c.inProgress ? `${c.inProgress} in progress` : null,
    c.waiting ? `${c.waiting} waiting` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export const STATE_LABEL: Record<PersonState, string> = {
  answered: "Answered",
  in_progress: "In progress",
  waiting: "Waiting",
};

/** People in the order a coach works them: waiting on you first (to review), then waiting on them, then the rest, newest first. */
export function sortPeople(people: FormPerson[]): FormPerson[] {
  const rank = (p: FormPerson) => (p.responses[0] && !p.responses[0].reviewed && p.state === "answered" ? 0 : p.state === "in_progress" ? 2 : p.state === "waiting" ? 3 : 1);
  const when = (p: FormPerson) => ms(p.responses[0]?.at ?? p.draft?.at ?? p.askedAt ?? null) || 0;
  return [...people].sort((a, b) => rank(a) - rank(b) || when(b) - when(a) || a.name.localeCompare(b.name));
}
