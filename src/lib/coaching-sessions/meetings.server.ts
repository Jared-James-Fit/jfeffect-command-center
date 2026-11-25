/**
 * Meetings kept ready by themselves (server only): every booked call gets a
 * coach-led plan the moment it's booked (autoPrepare, from the worker or the
 * first read of the client's Meetings), and an upcoming plan is refreshed as
 * what's on file changes (refreshMeeting: a late answer, a check-in, a new log),
 * merged into the plan on file so the coach's own points, edits, skips and
 * order stay, with what changed since the coach last looked. A refresh that
 * changes nothing (the same prep fingerprint) writes nothing and never asks
 * Cleo again.
 */
import { isTrainingSessionType } from "@/lib/booking-types";
import { agendaChanges, mergeAgenda, normalizeAgenda } from "./prepare";
import { appointmentState, SELF_BOOKED_VIA, type AppointmentState } from "./lifecycle";

type Db = any;

/** Minutes between two "HH:MM" times. */
const span = (a: string, b: string) => {
  const [ah, am] = a.slice(0, 5).split(":").map(Number);
  const [bh, bm] = b.slice(0, 5).split(":").map(Number);
  return bh! * 60 + bm! - (ah! * 60 + am!);
};

/** The coach behind a client: their assigned coach's login, else the admin who's asking. */
export async function coachUserOf(db: Db, clientId: string): Promise<string | null> {
  const { data: c } = await db
    .from("clients")
    .select("assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!(c as any)?.assigned_coach_id) return null;
  const { data: coach } = await db
    .from("coaches")
    .select("user_id")
    .eq("id", (c as any).assigned_coach_id)
    .maybeSingle();
  return (coach as any)?.user_id ?? null;
}

/**
 * The plan for a booked call, made now (once: the unique booking index and
 * the existence check make a second call a no-op). Read with `db` (the
 * coach's own login from a screen, the service role from the worker).
 */
export async function autoPrepare(
  db: Db,
  sb: Db,
  pt: any,
  opts: { coachUserId?: string | null; includeTests?: boolean } = {},
): Promise<string | null> {
  if (!pt?.id || isTrainingSessionType(pt.session_type)) return null;
  const { data: existing } = await sb
    .from("coaching_sessions")
    .select("id")
    .eq("pt_session_id", pt.id)
    .limit(1);
  if (existing?.length) return existing[0].id as string;
  const { loadSessionContext, prepareFor, prepHash, cleoForUser, logSessionEvent } =
    await import("./sessions.server");
  const ctx = await loadSessionContext(db, pt.client_id, {
    includeTests: opts.includeTests ?? false,
  });
  const event = ctx.events.find((e) => e.daysOut == null || e.daysOut >= 0) ?? null;
  let topics: string | null = null;
  const { data: t } = await sb
    .from("coaching_call_topics")
    .select("topics")
    .eq("pt_session_id", pt.id)
    .maybeSingle();
  topics = (t as any)?.topics ?? null;
  const minutes =
    pt.start_time && pt.end_time
      ? Math.max(5, Math.min(120, span(String(pt.start_time), String(pt.end_time))))
      : null;
  const now = new Date().toISOString();
  const prepared = await prepareFor(db, ctx, {
    event,
    minutes,
    topics,
    format: minutes && minutes <= 10 ? "touch_base" : "call",
    now,
  });
  const coach = opts.coachUserId ?? (await coachUserOf(sb, pt.client_id));
  const { data: row, error } = await sb
    .from("coaching_sessions")
    .insert({
      client_id: pt.client_id,
      coach_user_id: coach,
      pt_session_id: pt.id,
      competition_id: event?.competitionId ?? null,
      event: event ?? {},
      format: minutes && minutes <= 10 ? "touch_base" : "call",
      status: "ready",
      scheduled_at: pt.starts_at ?? null,
      minutes: prepared.agenda.minutes,
      coach_priorities: [],
      prep: prepared.prep,
      agenda: prepared.agenda,
      prep_hash: prepHash(prepared.prep),
      prep_refreshed_at: now,
      auto_prepared: true,
      write_up_status: (await cleoForUser(sb, coach)) ? "queued" : "none",
      created_by: coach,
    })
    .select("id")
    .single();
  if (error) {
    if (/coaching_sessions_one_per_booking/.test(error.message)) return null;
    throw new Error(error.message);
  }
  await logSessionEvent(sb, {
    sessionId: row.id,
    clientId: pt.client_id,
    actor: "cleo",
    action: "auto_prepared",
    detail: { pt_session_id: pt.id },
  });
  return row.id as string;
}

/**
 * The plan refreshed from what's on file now, merged into the one on file.
 * Returns what changed (nothing when the prep is the same as last time).
 * Never touches a meeting that's live, done or cancelled.
 */
export async function refreshMeeting(
  db: Db,
  sb: Db,
  s: any,
  opts: { includeTests?: boolean; force?: boolean } = {},
): Promise<{ changed: string[]; session: any }> {
  if (!["ready", "preparing"].includes(s.status) || s.format === "retrospective")
    return { changed: [], session: s };
  const {
    loadSessionContext,
    prepareFor,
    prepHash,
    answersForPrep,
    syncQuestionnaire,
    cleoForUser,
    logSessionEvent,
  } = await import("./sessions.server");
  // their pre-call answers, once sent, become part of the prep
  const answered = await syncQuestionnaire(sb, s);
  if (answered) {
    s = {
      ...s,
      questionnaire: answered,
      questionnaire_submission_id: (answered as any).submission_id,
    };
    await logSessionEvent(sb, {
      sessionId: s.id,
      clientId: s.client_id,
      actor: "athlete",
      action: "questions_answered",
      detail: { submission_id: (answered as any).submission_id },
    });
  }
  // the booking: a moved call moves the meeting, a cancelled one cancels it
  let scheduledAt = s.scheduled_at;
  let status = s.status;
  if (s.pt_session_id) {
    const { data: pt } = await sb
      .from("pt_sessions")
      .select("starts_at, status")
      .eq("id", s.pt_session_id)
      .maybeSingle();
    if (pt) {
      scheduledAt = (pt as any).starts_at ?? scheduledAt;
      if ((pt as any).status === "Cancelled" || (pt as any).status === "Rescheduled")
        status = "cancelled";
    }
  }
  const ctx = await loadSessionContext(db, s.client_id, {
    includeTests: opts.includeTests ?? false,
  });
  const event = s.event?.key ? (ctx.events.find((e) => e.key === s.event.key) ?? s.event) : null;
  const a = answersForPrep(s.questionnaire);
  let topics = a.topics;
  if (!topics && s.pt_session_id) {
    const { data: t } = await sb
      .from("coaching_call_topics")
      .select("topics")
      .eq("pt_session_id", s.pt_session_id)
      .maybeSingle();
    topics = (t as any)?.topics ?? null;
  }
  const now = new Date().toISOString();
  const prepared = await prepareFor(db, ctx, {
    event,
    coachNotes: s.coach_notes,
    priorities: s.coach_priorities ?? [],
    minutes: s.minutes,
    answers: a.answers,
    topics,
    covered: a.covered,
    format: s.format,
    now,
  });
  const hash = prepHash(prepared.prep);
  const same = hash === s.prep_hash && !answered && !opts.force;
  const patch: Record<string, unknown> = { prep_refreshed_at: now };
  if (scheduledAt !== s.scheduled_at) patch.scheduled_at = scheduledAt;
  if (status !== s.status) patch.status = status;
  if (answered) {
    patch.questionnaire = s.questionnaire;
    patch.questionnaire_submission_id = s.questionnaire_submission_id;
  }
  let changed: string[] = [];
  if (!same) {
    const prev = normalizeAgenda(s.agenda);
    const merged = mergeAgenda(prev, prepared.agenda, now);
    changed = agendaChanges(prev, merged);
    patch.prep = prepared.prep;
    patch.agenda = merged;
    patch.prep_hash = hash;
    patch.event = event ?? s.event;
    if (changed.length) {
      const list = [
        ...changed.map((text) => ({ at: now, text })),
        ...((s.changes ?? []) as any[]),
      ].slice(0, 30);
      patch.changes = list;
      // Cleo refines the wording again only for a meaningful change, at most twice a day
      const last = s.write_up?.at ? Date.parse(s.write_up.at) : 0;
      const meaningful = changed.some((c) => c.startsWith("New in") || c.startsWith("Objective"));
      if (
        meaningful &&
        s.write_up_status !== "running" &&
        s.write_up_status !== "queued" &&
        Date.now() - last > 12 * 3_600_000 &&
        (await cleoForUser(sb, s.coach_user_id))
      )
        Object.assign(patch, { write_up_status: "queued", attempts: 0 });
    }
  }
  const { data: updated } = await sb
    .from("coaching_sessions")
    .update(patch)
    .eq("id", s.id)
    .select("*")
    .single();
  if (changed.length)
    await logSessionEvent(sb, {
      sessionId: s.id,
      clientId: s.client_id,
      actor: "cleo",
      action: "plan_refreshed",
      detail: { changes: changed.slice(0, 8) },
    });
  return { changed, session: updated ?? { ...s, ...patch } };
}

export type AppointmentInfo = {
  ptSessionId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  location: string | null;
  meetLink: string | null;
  status: string;
  state: AppointmentState;
  confirmedAt: string | null;
  confirmationRequestedAt: string | null;
  pendingChange: {
    id: string;
    kind: "move" | "cancel";
    proposedDate: string | null;
    proposedStart: string | null;
    note: string | null;
  } | null;
  bookedByClient: boolean;
  sessionType: string | null;
};

/** The booked call behind a meeting, as both sides see it. */
export async function appointmentFor(
  db: Db,
  ptSessionId: string | null,
): Promise<AppointmentInfo | null> {
  if (!ptSessionId) return null;
  const [{ data: p }, { data: req }] = await Promise.all([
    db
      .from("pt_sessions")
      .select(
        "id, title, session_type, starts_at, ends_at, timezone, location, meet_link, status, booked_via, client_confirmed_at, confirmation_requested_at",
      )
      .eq("id", ptSessionId)
      .maybeSingle(),
    db
      .from("pt_session_change_requests")
      .select("id, kind, proposed_date, proposed_start, note")
      .eq("pt_session_id", ptSessionId)
      .eq("status", "pending")
      .limit(1),
  ]);
  if (!p) return null;
  const r = (req ?? [])[0] as any;
  const bookedByClient = SELF_BOOKED_VIA.has(String((p as any).booked_via ?? ""));
  return {
    ptSessionId: (p as any).id,
    title: (p as any).title || (p as any).session_type || "Call",
    startsAt: (p as any).starts_at ?? null,
    endsAt: (p as any).ends_at ?? null,
    timezone: (p as any).timezone ?? null,
    location: (p as any).location ?? null,
    meetLink: (p as any).meet_link ?? null,
    status: (p as any).status,
    sessionType: (p as any).session_type ?? null,
    state: appointmentState({
      status: (p as any).status,
      startsAt: (p as any).starts_at,
      clientConfirmedAt: (p as any).client_confirmed_at,
      confirmationRequestedAt: (p as any).confirmation_requested_at,
      pendingChange: r?.kind ?? null,
      bookedByClient,
    }),
    confirmedAt: (p as any).client_confirmed_at ?? null,
    confirmationRequestedAt: (p as any).confirmation_requested_at ?? null,
    pendingChange: r
      ? {
          id: r.id,
          kind: r.kind,
          proposedDate: r.proposed_date ?? null,
          proposedStart: r.proposed_start ?? null,
          note: r.note ?? null,
        }
      : null,
    bookedByClient,
  };
}

/** A client's booked calls coming up (the next 21 days), each with its meeting when there is one. */
export async function upcomingMeetings(db: Db, clientId: string) {
  const now = new Date().toISOString();
  const to = new Date(Date.now() + 21 * 86_400_000).toISOString();
  const { data: rows } = await db
    .from("pt_sessions")
    .select(
      "id, client_id, title, session_type, session_date, start_time, end_time, starts_at, ends_at, timezone, location, meet_link, status, booked_via, client_confirmed_at, confirmation_requested_at",
    )
    .eq("client_id", clientId)
    .eq("status", "Scheduled")
    .gte("ends_at", now)
    .lte("starts_at", to)
    .order("starts_at")
    .limit(10);
  return ((rows ?? []) as any[]).filter((r) => !isTrainingSessionType(r.session_type));
}
