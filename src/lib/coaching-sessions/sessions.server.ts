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
  type MeetingExtras,
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
  /** everything else on file a meeting can use (each part best effort) */
  extras: MeetingExtras;
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
  const [competitions, preps, plan, goal, commitments, intelligence, booked, records, done, extrasRaw] = await Promise.all([
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
    loadMeetingExtras(supabase, clientId, today, "lb"),
  ]);
  const lastReview = records.reviews[0]?.date ?? null;
  const extras: MeetingExtras = { ...extrasRaw, unit: records.unit };
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
    extras,
  };
}

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The rest of the client's file a meeting can use, read with the caller's own
 * login (RLS decides): the program on the calendar and what follows it, their
 * own recent words in the coach chat, set videos, cardio, the last meeting's
 * summary and the commitments closed since. Every part is best effort: one
 * that can't be read is left out, never guessed.
 */
export async function loadMeetingExtras(supabase: any, clientId: string, today: string, unit: "kg" | "lb"): Promise<MeetingExtras> {
  const from = addDaysIso(today, -28);
  const [blocks, msgs, videos, cardioT, cardioC, last, done, goalRows] = await Promise.all([
    safe(async () => {
      const { data, error } = await supabase
        .from("pl_blocks")
        .select("name, start_date, end_date, weeks, status, archived, client_visible")
        .eq("client_id", clientId)
        .eq("archived", false)
        .not("start_date", "is", null)
        .order("start_date");
      if (error) throw error;
      return (data ?? []) as any[];
    }, [] as any[]),
    safe(async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("body, created_at, sender_role, is_internal_note, deleted_at")
        .eq("client_id", clientId)
        .eq("sender_role", "client")
        .gte("created_at", `${addDaysIso(today, -10)}T00:00:00Z`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    }, [] as any[]),
    safe(async () => {
      const { data, error } = await supabase
        .from("pl_set_videos")
        .select("created_at")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .gte("created_at", `${from}T00:00:00Z`)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as any[];
    }, null as any[] | null),
    safe(async () => {
      const { data, error } = await supabase.from("cardio_targets").select("frequency_per_week, start_date, end_date").eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as any[];
    }, [] as any[]),
    safe(async () => {
      const { data, error } = await supabase
        .from("cardio_completions")
        .select("completed_date, completed, skipped")
        .eq("client_id", clientId)
        .gte("completed_date", from);
      if (error) throw error;
      return (data ?? []) as any[];
    }, null as any[] | null),
    safe(async () => {
      const { data } = await supabase
        .from("coaching_sessions")
        .select("scheduled_at, created_at, analysis, game_plan")
        .eq("client_id", clientId)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1);
      return (data?.[0] ?? null) as any;
    }, null),
    safe(async () => {
      const { data } = await supabase
        .from("coaching_session_commitments")
        .select("owner, text, closed_at")
        .eq("client_id", clientId)
        .eq("status", "done")
        .gte("closed_at", `${from}T00:00:00Z`)
        .order("closed_at", { ascending: false })
        .limit(6);
      return (data ?? []) as any[];
    }, [] as any[]),
    // the goal ledger (goal-intel): what they're working toward, approved or waiting on the coach
    safe(async () => {
      const { data } = await supabase
        .from("client_goals")
        .select("*")
        .eq("client_id", clientId)
        .in("status", ["proposed", "active"])
        .order("created_at", { ascending: true })
        .limit(20);
      return (data ?? []) as any[];
    }, [] as any[]),
  ]);
  // the program on the calendar today, and the one after it
  const live = (blocks as any[]).filter((b) => b.client_visible !== false && b.status !== "Draft");
  const now = live.find((b) => b.start_date <= today && (!b.end_date || b.end_date >= today)) ?? null;
  const next = live.find((b) => b.start_date > today) ?? null;
  const week = now?.start_date ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${now.start_date}T00:00:00Z`)) / (7 * 86_400_000)) + 1 : null;
  // their own words worth bringing to a meeting: a question, a worry, a request (never "ok" or "thanks")
  const worth = (t: string) => t.length >= 25 && (/\?/.test(t) || /\b(worried|concern|struggl|hurt|pain|can't|cant|help|confused|not sure|unsure|stress|tired|sore|want to|should i)\b/i.test(t));
  const recentMessages = (msgs as any[])
    .filter((m) => !m.is_internal_note && !m.deleted_at && typeof m.body === "string" && worth(m.body.trim()))
    .slice(0, 3)
    .map((m) => ({ date: String(m.created_at).slice(0, 10), text: m.body.trim().replace(/\s+/g, " ").slice(0, 220) }));
  const perWeek = (cardioT as any[])
    .filter((t) => (!t.end_date || t.end_date >= from) && (!t.start_date || t.start_date <= today))
    .reduce((a, t) => a + (Number(t.frequency_per_week) || 0), 0);
  const cardio = perWeek > 0 && cardioC ? { planned: Math.round(perWeek * 4), done: (cardioC as any[]).filter((c) => c.completed && !c.skipped).length } : null;
  return {
    unit,
    program: now
      ? {
          name: String(now.name),
          week: week && now.weeks ? Math.min(week, Number(now.weeks)) : week,
          weeks: now.weeks ? Number(now.weeks) : null,
          endsOn: now.end_date ?? null,
          nextName: next ? String(next.name) : null,
          nextStarts: next?.start_date ?? null,
        }
      : null,
    recentMessages,
    videos: videos ? { count: videos.length, lastDate: videos[0] ? String(videos[0].created_at).slice(0, 10) : null } : null,
    cardio,
    lastMeeting: last ? { date: String(last.scheduled_at ?? last.created_at).slice(0, 10), summary: last.analysis?.summary ? String(last.analysis.summary).slice(0, 280) : null } : null,
    doneCommitments: (done as any[]).map((d) => ({ owner: d.owner, text: d.text, closedOn: d.closed_at ? String(d.closed_at).slice(0, 10) : null })),
    goals: await meetingGoals(goalRows as any[]),
  };
}

/** The goal ledger as the meeting prep reads it: each target already in words, the three numbers apart. */
async function meetingGoals(rows: any[]): Promise<NonNullable<MeetingExtras["goals"]>> {
  if (!rows.length) return [];
  const { fmtClientTarget, fmtWeight } = await import("@/lib/goal-intel/types");
  return rows.map((g) => {
    const unit = (g.feasibility?.unit ?? g.approved_unit ?? g.client_unit ?? "kg") as "kg" | "lb";
    const f = g.feasibility;
    return {
      id: g.id,
      title: g.title,
      status: g.status,
      clientTarget: fmtClientTarget(g),
      unitInferred: g.client_unit_source === "inferred",
      tentative: !!g.tentative,
      approved: g.approved_kg != null ? fmtWeight(Number(g.approved_kg), unit) : g.approved_text ?? null,
      projection: f?.projection ? `${fmtWeight(f.projection.expectedKg, unit)} (${fmtWeight(f.projection.lowKg, unit)}–${fmtWeight(f.projection.highKg, unit)})` : null,
      score: f?.score ?? null,
      action: f?.action && !["none", "approve", "maintain"].includes(f.action.kind) ? f.action.line : null,
      clientFacing: g.client_facing !== false,
    };
  });
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
    format?: string | null;
    now?: string;
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
    firstName: ctx.firstName,
    ...ctx.extras,
  });
  if (opts.covered?.size) {
    const c = opts.covered;
    prep.missing = prep.missing.filter(
      (m) => !((c.has("bodyweight") && /weigh-in/i.test(m.text)) || (c.has("training_feel") && /check-in/i.test(m.text))),
    );
  }
  const agenda = planAgenda(prep, { minutes: opts.minutes ?? undefined, format: opts.format ?? "call", now: opts.now, firstName: ctx.firstName });
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

/** What the questions would ask for this session, worked out from the records (only what they can't tell). */
export function questionsFor(ctx: SessionContext, event: SessionEvent | null, topicsKnown: boolean) {
  return import("./questionnaire").then(({ questionnaireFor }) => {
    const pain = ctx.records.pain.find((p) => p.reasons.length > 0 && !/better|improv/i.test(p.trend ?? ""));
    const wk = ctx.records.workouts;
    const unlogged = wk && wk.planned >= 4 && wk.done / wk.planned < 0.75 ? wk.planned - wk.done : 0;
    return questionnaireFor({
      today: ctx.today,
      lastCheckin: ctx.records.checkins?.latest ?? null,
      lastWeighIn: ctx.records.bodyweight?.latestDate ?? null,
      event: event ? { kind: event.kind, daysOut: event.daysOut, title: event.title } : null,
      registeredKnown: !!(event?.competitionId && ctx.registration[event.competitionId] === "registered"),
      topicsKnown,
      painOpen: pain ? { label: pain.label, since: null } : null,
      unlogged,
      bodyweightMatters: !!(event?.weightClass || ctx.records.bodyweight?.goalKg),
    });
  });
}

/** A short fingerprint of a prep: a refresh that produces the same one changes nothing. */
export function prepHash(prep: SessionPrep): string {
  const text = JSON.stringify(prep, (k, v) => (k === "addedAt" ? undefined : v));
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Whether the coach behind a meeting has Cleo, read by the server (the worker
 * has no login of theirs): the admin always, a coach while coaches are on.
 */
export async function cleoForUser(sb: any, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return safe(async () => {
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    const r = new Set(((roles ?? []) as any[]).map((x) => String(x.role)));
    if (r.has("admin")) return true;
    if (!r.has("coach")) return false;
    const { data } = await sb.rpc("cleo_access_settings");
    return (data as any)?.coach === true || (data as any)?.coach === "true";
  }, false);
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
