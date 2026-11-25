/**
 * Coaching sessions, server side: what a session is prepared from, read once
 * with the coach's own login (RLS decides, as for a booked call's prep), and
 * the session's own rows, written by the server after the caller was checked
 * (assertStaffReachesClient). Nothing here reaches the client: a summary goes
 * to them only as a chat message the coach chose to send.
 */
import { loadClientPrepRecords, previousReview } from "@/lib/coaching-packages/call-prep.server";
import { detectEvents, generalEvent, type SessionEvent } from "./events";
import { ANSWER_WORDS } from "./questionnaire";
import {
  buildSessionPrep,
  planAgenda,
  recommendIntervention,
  type Commitment,
  type CompetitionContext,
  type Intervention,
  type SessionPrep,
  type Agenda,
} from "./prepare";

export const todayIn = (tz: string | null | undefined) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "America/Winnipeg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export async function assertReach(supabase: any, userId: string, clientId: string) {
  const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
  await assertStaffReachesClient(supabase, userId, clientId);
}

export async function logSessionEvent(
  sb: any,
  e: { sessionId: string; clientId: string; actorId?: string | null; actor: "coach" | "cleo" | "athlete" | "system"; action: string; detail?: Record<string, unknown> },
) {
  await sb.from("coaching_session_events").insert({
    session_id: e.sessionId,
    client_id: e.clientId,
    actor_id: e.actorId ?? null,
    actor: e.actor,
    action: e.action,
    detail: e.detail ?? {},
  });
}

const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/** What the competition read says, for a session about that meet. */
async function competitionContext(supabase: any, competitionId: string | null): Promise<CompetitionContext | null> {
  if (!competitionId) return null;
  return safe(async () => {
    const { data: a } = await supabase
      .from("competition_assessments")
      .select("kind, headline, internal, released_at, status")
      .eq("competition_id", competitionId)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(4);
    const rows = (a ?? []) as any[];
    const latest = rows[0];
    if (!latest) return null;
    const total = latest.internal?.strategy?.adjusted?.total ?? latest.internal?.engine?.forecast?.total ?? null;
    const brief = latest.internal?.engine ?? {};
    const inputs = brief.inputs ?? {};
    const recs = ((latest.internal?.narrative?.recommendations ?? []) as any[])
      .filter((r) => r?.needs_approval && r?.text)
      .map((r) => String(r.text))
      .slice(0, 3);
    return {
      expectedTotal: total?.expected ?? null,
      range: total ? { conservative: total.conservative, high: total.high } : null,
      place: brief.landscape?.place?.expected ?? null,
      gamePlanReleased: rows.some((r) => (r.kind === "game_plan" || r.kind === "confirm") && r.released_at),
      headline: latest.headline ?? null,
      openDecisions: recs,
      classGapKg:
        inputs.bodyweightAvg != null && inputs.classLimit != null
          ? Math.round((inputs.bodyweightAvg - inputs.classLimit) * 10) / 10
          : null,
    };
  }, null);
}

export type SessionContext = {
  today: string;
  clientId: string;
  firstName: string | null;
  events: SessionEvent[];
  commitments: Commitment[];
  intelligence: Array<{ id: string; kind: string; text: string; status: string; permanence: string; expires_on: string | null }>;
  bookedCallOn: string | null;
  lastCallOn: string | null;
  records: Awaited<ReturnType<typeof loadClientPrepRecords>>;
  /** competitions by id, for what the questionnaire still needs to ask */
  registration: Record<string, string>;
};

/**
 * The client's dated bodyweight goal in kg (clients.bodyweight_goal_*: a value
 * in its own unit), or null. A goal to maintain has no target to plan toward.
 */
export function bodyweightGoalOf(c: {
  bodyweight_goal_type?: string | null;
  bodyweight_goal_value?: number | string | null;
  bodyweight_goal_unit?: string | null;
  bodyweight_goal_date?: string | null;
}): { kg: number; date: string | null } | null {
  const v = c.bodyweight_goal_value == null ? NaN : Number(c.bodyweight_goal_value);
  if (!Number.isFinite(v) || v <= 0 || c.bodyweight_goal_type === "maintain") return null;
  const kg = c.bodyweight_goal_unit === "lb" ? v / 2.20462 : v;
  return { kg: Math.round(kg * 10) / 10, date: c.bodyweight_goal_date ?? null };
}

/** Everything a session for this client is prepared from, read with the coach's own login. */
export async function loadSessionContext(supabase: any, clientId: string, opts: { includeTests?: boolean } = {}): Promise<SessionContext> {
  const { data: c, error } = await supabase
    .from("clients")
    .select("id, first_name, preferred_name, timezone, bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_unit, bodyweight_goal_date")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) throw new Error("You can't see this client.");
  const today = todayIn((c as any).timezone);
  const isMine = opts.includeTests ?? await safe(async () => {
    const { data } = await supabase.auth.getUser();
    const { data: link } = await supabase
      .from("community_profiles")
      .select("user_id")
      .eq("same_person_as", data?.user?.id ?? "")
      .limit(1);
    return !!link?.length;
  }, false);
  const [competitions, preps, plan, goal, commitments, intelligence, booked, records, done] = await Promise.all([
    safe(async () => (await supabase.from("competitions").select("id, name, meet_date, location, weight_class, status, prep_id, internal_test, registration").eq("client_id", clientId)).data ?? [], [] as any[]),
    safe(async () => (await supabase.from("pl_preps").select("id, title, event_name, event_date, weight_class, status, archived").eq("client_id", clientId)).data ?? [], [] as any[]),
    safe(async () => {
      const { data } = await supabase
        .from("athlete_competition_plans")
        .select("plan")
        .eq("client_id", clientId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1);
      const p = (data?.[0] as any)?.plan?.primary;
      return p?.date ? { name: p.name ?? null, date: String(p.date) } : null;
    }, null),
    safe(async () => {
      const { data } = await supabase.from("program_intel_profiles").select("long_term_goal").eq("client_id", clientId).maybeSingle();
      const g = (data as any)?.long_term_goal;
      return g?.date ? { label: g.label ?? g.goal ?? null, date: String(g.date) } : null;
    }, null),
    safe(async () => (await supabase.from("coaching_session_commitments").select("id, session_id, owner, text, due_on, status, created_at, coaching_sessions(scheduled_at, created_at)").eq("client_id", clientId).eq("status", "open").eq("confirmed", true).order("created_at", { ascending: false }).limit(30)).data ?? [], [] as any[]),
    safe(async () => (await supabase.from("client_intelligence").select("id, kind, text, status, permanence, expires_on, source_quote, source_session_id").eq("client_id", clientId).neq("status", "archived").order("updated_at", { ascending: false }).limit(60)).data ?? [], [] as any[]),
    safe(async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("session_date, status")
        .eq("client_id", clientId)
        .eq("status", "Scheduled")
        .gte("session_date", today)
        .order("session_date")
        .limit(1);
      return (data?.[0] as any)?.session_date ?? null;
    }, null),
    loadClientPrepRecords(supabase, clientId, today),
    safe(async () => {
      const { data } = await supabase
        .from("coaching_sessions")
        .select("scheduled_at, created_at, format")
        .eq("client_id", clientId)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1);
      const s = data?.[0] as any;
      return s ? String(s.scheduled_at ?? s.created_at).slice(0, 10) : null;
    }, null),
  ]);
  const lastReview = records.reviews[0]?.date ?? null;
  return {
    today,
    clientId,
    firstName: (c as any).preferred_name || (c as any).first_name || null,
    events: detectEvents({
      today,
      competitions,
      preps,
      plan,
      longTermGoal: goal,
      bodyweightGoal: bodyweightGoalOf(c),
      includeTests: isMine,
    }),
    commitments: (commitments as any[]).map((m) => ({
      id: m.id,
      sessionId: m.session_id ?? null,
      owner: m.owner,
      text: m.text,
      dueOn: m.due_on ?? null,
      status: m.status,
      sessionDate: String(m.coaching_sessions?.scheduled_at ?? m.coaching_sessions?.created_at ?? m.created_at).slice(0, 10),
    })),
    intelligence: intelligence as any[],
    bookedCallOn: booked,
    lastCallOn: [lastReview, done].filter(Boolean).sort().pop() ?? null,
    records,
    registration: Object.fromEntries((competitions as any[]).map((c) => [c.id, String(c.registration ?? "unknown")])),
  };
}

/**
 * Included calls left this billing period for a client on a package with them
 * (Coaching Plus), else null: the intervention says whether a call is covered
 * or would be a General Call. coaching_call_usage is the server's only, so this
 * reads it with the service role, after the caller was checked.
 */
async function includedCallsLeft(clientId: string, today: string): Promise<number | null> {
  return safe(async () => {
    const sb = await admin();
    const { data: e } = await sb
      .from("coaching_package_enrollments")
      .select("included_calls, coaching_packages!inner(included_calls, call_booking_card_id)")
      .eq("client_id", clientId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    const pkg = (e as any)?.coaching_packages;
    const n = e ? ((e as any).included_calls ?? pkg?.included_calls ?? 0) : 0;
    if (!e || n <= 0 || !pkg?.call_booking_card_id) return null;
    const { data: u } = await sb.rpc("coaching_call_usage", { _client: clientId, _card: pkg.call_booking_card_id, _on: today });
    return u ? Number((u as any).left) : null;
  }, null);
}

export type PreparedSession = { prep: SessionPrep; agenda: Agenda; intervention: Intervention };

/** The prep, the agenda and the intervention read, for an event (or none) and the coach's words. */
export async function prepareFor(
  supabase: any,
  ctx: SessionContext,
  opts: {
    event: SessionEvent | null;
    coachNotes?: string | null;
    priorities?: string[];
    minutes?: number | null;
    answers?: Record<string, string>;
    topics?: string | null;
    before?: string;
    /** questionnaire keys they answered: what's missing from the records is covered by their words */
    covered?: Set<string>;
  },
): Promise<PreparedSession> {
  const competition = await competitionContext(supabase, opts.event?.competitionId ?? null);
  const { reviews: _r, unit: _u, ...facts } = ctx.records;
  const prep = buildSessionPrep({
    ...facts,
    today: ctx.today,
    topics: opts.topics ?? null,
    bookingNote: null,
    previous: previousReview(ctx.records.reviews, opts.before ?? `${ctx.today}~`),
    calls: null,
    event: opts.event,
    competition,
    commitments: ctx.commitments,
    intelligence: ctx.intelligence.filter((i) => i.status === "confirmed").map((i) => i.text),
    coachNotes: opts.coachNotes ?? null,
    coachPriorities: opts.priorities ?? [],
    answers: opts.answers ?? {},
  });
  if (opts.covered?.size) {
    const c = opts.covered;
    prep.missing = prep.missing.filter(
      (m) => !((c.has("bodyweight") && /weigh-in/i.test(m.text)) || (c.has("training_feel") && /check-in/i.test(m.text))),
    );
  }
  const agenda = planAgenda(prep, opts.minutes ? { minutes: opts.minutes } : {});
  const intervention = recommendIntervention({
    today: ctx.today,
    event: opts.event,
    prep,
    bookedCallOn: ctx.bookedCallOn,
    lastCallOn: ctx.lastCallOn,
    includedCallsLeft: await includedCallsLeft(ctx.clientId, ctx.today),
    athleteAsked: !!opts.topics,
    seriousConcern: ctx.records.pain.some((p) => p.reasons.length > 0) || prep.decisions.some((d) => /urgent|warning sign/i.test(d.text)),
  });
  return { prep, agenda, intervention };
}

/** The event a session is about: one the records hold, or the coach's own description. */
export function pickEvent(ctx: SessionContext, eventKey: string | null | undefined, custom: string | null | undefined): SessionEvent | null {
  if (eventKey) {
    const e = ctx.events.find((x) => x.key === eventKey);
    if (e) return e;
  }
  if (custom?.trim()) return generalEvent(custom);
  return null;
}

/* ------------------------------------------------------------------ */
/* The pre-call questions                                              */

/** What the questions would ask for this session, worked out from the records. */
export function questionsFor(ctx: SessionContext, event: SessionEvent | null, topicsKnown: boolean) {
  return import("./questionnaire").then(({ questionnaireFor }) =>
    questionnaireFor({
      today: ctx.today,
      lastCheckin: ctx.records.checkins?.latest ?? null,
      lastWeighIn: ctx.records.bodyweight?.latestDate ?? null,
      event: event ? { kind: event.kind, daysOut: event.daysOut } : null,
      registeredKnown: !!(event?.competitionId && ctx.registration[event.competitionId] === "registered"),
      topicsKnown,
    }),
  );
}

/**
 * Their answers, once they've sent them: the newest submission of the pre-call
 * form since it was sent for this session, read by session key. Returns the
 * questionnaire with the answers added, or null when nothing new came in.
 */
export async function syncQuestionnaire(sb: any, s: any): Promise<Record<string, unknown> | null> {
  const q = s.questionnaire;
  if (!q?.sent_at || q.submitted_at) return null;
  const { PRE_CALL_FORM_ID, answersByKey } = await import("./questionnaire");
  const { data: sub } = await sb
    .from("nf_submissions")
    .select("id, submitted_at, status")
    .eq("form_id", PRE_CALL_FORM_ID)
    .eq("client_id", s.client_id)
    .neq("status", "in_progress")
    .gte("submitted_at", q.sent_at)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return null;
  const [{ data: qs }, { data: answers }] = await Promise.all([
    sb.from("nf_questions").select("id, label, validation").eq("form_id", PRE_CALL_FORM_ID),
    sb.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", sub.id),
  ]);
  const { formAnswerText } = await import("@/lib/form-answer-text");
  const byQ = new Map(((answers ?? []) as any[]).map((a) => [a.question_id, a]));
  const keyed = answersByKey((qs ?? []) as any[], (id) => formAnswerText(byQ.get(id)) || null);
  return { ...q, submitted_at: sub.submitted_at, submission_id: sub.id, answers: keyed };
}

/** The questionnaire's answers as the prep reads them: a short label and their words. */
export function answersForPrep(q: any): { answers: Record<string, string>; topics: string | null; covered: Set<string> } {
  const a = (q?.answers ?? {}) as Record<string, { label: string; text: string }>;
  const answers: Record<string, string> = {};
  const covered = new Set<string>();
  for (const [k, v] of Object.entries(a)) {
    if (!v?.text) continue;
    covered.add(k);
    if (k === "topics") continue;
    // by session key (routeAnswers places each), a question the form didn't seed by its label
    answers[k in ANSWER_WORDS ? k : v.label] = v.text;
  }
  return { answers, topics: a.topics?.text ?? null, covered };
}

/** Cleo's parts are Cleo's: on for whoever has Cleo (cleo_allowed()), the prep itself for every coach. */
export async function hasCleo(supabase: any, userId: string): Promise<boolean> {
  try {
    const { cleoAllowed } = await import("@/lib/cleo-access.server");
    return (await cleoAllowed({ supabase, userId } as any)).allowed;
  } catch {
    return false;
  }
}
