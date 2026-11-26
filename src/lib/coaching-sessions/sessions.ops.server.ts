/**
 * Coaching sessions' operations (docs/COACHING_SESSIONS.md): the body of every
 * server function in sessions.functions.ts, which only authenticates the
 * caller and hands over. Kept apart so the production self-check
 * (`coaching-sessions-selfcheck`) drives exactly the code the app's buttons
 * call, on an internal test client only (`trusted`: its own guard has checked
 * the client is a staff member's own linked account).
 */
import { admin, assertReach, hasCleo } from "./sessions.server";

export type Caller = { supabase: any; userId: string; trusted?: boolean; cleo?: boolean };

async function reachClient(c: Caller, clientId: string) {
  if (c.trusted) return;
  await assertReach(c.supabase, c.userId, clientId);
}

const cleoFor = async (c: Caller) => (c.cleo != null ? c.cleo : hasCleo(c.supabase, c.userId));

async function reachSession(c: Caller, sessionId: string) {
  const { supabase, userId } = c;
  const { data: s, error } = await supabase.from("coaching_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!s) throw new Error("You can't see this session.");
  await reachClient(c, (s as any).client_id);
  return { session: s as any, supabase, userId, sb: await admin() };
}

const ROUTE_FOR: Record<string, string> = {
  training: "program_ai_edit",
  nutrition: "nutrition_plan_edit",
  cardio: "cardio_proposal",
  communication: "message",
};

export async function getSessionsHome(c: Caller, data: any) {
  const { supabase, userId } = c;
  const { loadSessionContext, prepareFor } = await import("./sessions.server");
  const { autoPrepare, upcomingMeetings } = await import("./meetings.server");
  const { appointmentState, SELF_BOOKED_VIA } = await import("./lifecycle");
  await reachClient(c, data.clientId);
  const sb = await admin();
  // every booked call has a plan: one that doesn't yet gets it now (the worker does the same within a minute)
  const calls = await upcomingMeetings(supabase, data.clientId);
  const { data: linked } = calls.length
    ? await sb.from("coaching_sessions").select("id, pt_session_id").in("pt_session_id", calls.map((x: any) => x.id))
    : { data: [] as any[] };
  const byPt = new Map(((linked ?? []) as any[]).map((r) => [r.pt_session_id, r.id]));
  for (const call of calls.filter((x: any) => !byPt.has(x.id)).slice(0, 2)) {
    try {
      const id = await autoPrepare(supabase, sb, call, { coachUserId: null, includeTests: !!c.trusted });
      if (id) byPt.set(call.id, id);
    } catch (e) {
      console.warn("[meetings] auto-prepare failed", e);
    }
  }
  const ctx = await loadSessionContext(supabase, data.clientId, c.trusted ? { includeTests: true } : {});
  const next = ctx.events.find((e) => e.daysOut == null || e.daysOut >= 0) ?? null;
  const { intervention, prep } = await prepareFor(supabase, ctx, { event: next });
  const [{ data: sessions }, { data: memories }, { data: openRecs }] = await Promise.all([
    supabase
      .from("coaching_sessions")
      .select("id, event, format, status, scheduled_at, minutes, created_at, analysis_status, shared_at, write_up_status, pt_session_id, coach_reviewed_at, changes, agenda, auto_prepared, analysis")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("client_intelligence").select("*").eq("client_id", data.clientId).neq("status", "archived").order("updated_at", { ascending: false }).limit(120),
    supabase.from("coaching_session_recommendations").select("id, session_id, status, applied_at").eq("client_id", data.clientId).in("status", ["proposed", "approved", "edited", "clarify"]),
  ]);
  const ptById = new Map(calls.map((x: any) => [x.id, x]));
  const list = ((sessions ?? []) as any[]).map((s) => {
    const pt = s.pt_session_id ? ptById.get(s.pt_session_id) : null;
    const { agenda, analysis, ...rest } = s;
    const changedSinceReview = ((s.changes ?? []) as any[]).filter((x) => !s.coach_reviewed_at || x.at > s.coach_reviewed_at).length;
    const recs = ((openRecs ?? []) as any[]).filter((r) => r.session_id === s.id && !r.applied_at);
    return {
      ...rest,
      changes: undefined,
      objective: agenda?.objective ?? null,
      summary: typeof analysis?.summary === "string" ? analysis.summary : null,
      changedSinceReview,
      openRecommendations: recs.length,
      appointment: pt
        ? {
            startsAt: pt.starts_at,
            endsAt: pt.ends_at,
            meetLink: pt.meet_link,
            location: pt.location,
            title: pt.title || pt.session_type,
            state: appointmentState({ status: pt.status, startsAt: pt.starts_at, clientConfirmedAt: pt.client_confirmed_at, confirmationRequestedAt: pt.confirmation_requested_at, bookedByClient: SELF_BOOKED_VIA.has(String(pt.booked_via ?? "")) }),
          }
        : null,
    };
  });
  return {
    today: ctx.today,
    firstName: ctx.firstName,
    events: ctx.events,
    nextEvent: next,
    intervention,
    missing: prep.missing,
    decisions: prep.decisions,
    sessions: list,
    commitments: ctx.commitments,
    intelligence: (memories ?? []) as any[],
    bookedCallOn: ctx.bookedCallOn,
    lastCallOn: ctx.lastCallOn,
    unit: ctx.extras.unit ?? "lb",
  };
}

export async function prepareSession(c: Caller, data: any) {
  const { supabase, userId } = c;
  const { assertReach, admin, loadSessionContext, prepareFor, pickEvent, logSessionEvent, hasCleo } = await import(
    "./sessions.server"
  );
  await reachClient(c, data.clientId);
  const sb = await admin();
  if (data.key) {
    const { data: same } = await sb
      .from("coaching_sessions")
      .select("id")
      .eq("client_id", data.clientId)
      .eq("created_by", userId)
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .contains("live", { key: data.key })
      .limit(1);
    if (same?.length) return { id: same[0].id as string, existing: true };
  }
  const ctx = await loadSessionContext(supabase, data.clientId, c.trusted ? { includeTests: true } : {});
  const event = pickEvent(ctx, data.eventKey, data.customTitle);
  let topics: string | null = null;
  if (data.ptSessionId) {
    // only this client's own booking, read with the coach's login (RLS), can be linked
    const { data: booking } = await supabase.from("pt_sessions").select("id, client_id").eq("id", data.ptSessionId).maybeSingle();
    if (!booking || (booking as any).client_id !== data.clientId) throw new Error("That booking isn't this client's.");
    const { data: t } = await supabase.from("coaching_call_topics").select("topics").eq("pt_session_id", data.ptSessionId).maybeSingle();
    topics = (t as any)?.topics ?? null;
  }
  const now = new Date().toISOString();
  const prepared = await prepareFor(supabase, ctx, {
    event,
    coachNotes: data.coachNotes,
    priorities: data.priorities,
    minutes: data.format === "touch_base" ? Math.min(data.minutes ?? 10, 10) : data.minutes,
    topics,
    format: data.format,
    now,
  });
  const { prepHash } = await import("./sessions.server");
  const { data: row, error } = await sb
    .from("coaching_sessions")
    .insert({
      client_id: data.clientId,
      coach_user_id: userId,
      pt_session_id: data.ptSessionId ?? null,
      competition_id: event?.competitionId ?? null,
      event: event ?? {},
      format: data.format,
      status: data.format === "retrospective" ? "done" : "ready",
      scheduled_at: data.scheduledAt ?? null,
      minutes: prepared.agenda.minutes,
      coach_notes: data.coachNotes ?? null,
      coach_priorities: data.priorities,
      prep: prepared.prep,
      agenda: prepared.agenda,
      prep_hash: prepHash(prepared.prep),
      prep_refreshed_at: now,
      coach_reviewed_at: now,
      live: data.key ? { key: data.key } : {},
      write_up_status: data.format !== "retrospective" && (await cleoFor(c)) ? "queued" : "none",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) {
    if (/coaching_sessions_one_per_booking/.test(error.message)) throw new Error("That call already has a session.");
    throw new Error(error.message);
  }
  await logSessionEvent(sb, {
    sessionId: row.id,
    clientId: data.clientId,
    actorId: userId,
    actor: "coach",
    action: data.format === "retrospective" ? "added_after" : "prepared",
    detail: { event: event?.key ?? null, format: data.format },
  });
  return { id: row.id as string, existing: false };
}

export async function getSession(c: Caller, data: any) {
  const { session, supabase, sb, userId } = await reachSession(c, data.sessionId);
  const { syncQuestionnaire, logSessionEvent, loadSessionContext, questionsFor } = await import("./sessions.server");
  const { refreshMeeting, appointmentFor } = await import("./meetings.server");
  const { meetingReadiness } = await import("./lifecycle");
  const { normalizeAgenda } = await import("./prepare");
  let s = session;
  const cleo = await cleoFor(c);
  let questions: Awaited<ReturnType<typeof questionsFor>> | null = null;
  if (data.refresh && (s.status === "ready" || s.status === "preparing")) {
    const r = await refreshMeeting(supabase, sb, s, { includeTests: !!c.trusted });
    s = r.session;
    if (!s.questionnaire?.sent_at) {
      const ctx = await loadSessionContext(supabase, s.client_id, c.trusted ? { includeTests: true } : {});
      questions = await questionsFor(ctx, s.event?.title ? s.event : null, false);
    }
  } else {
    // their pre-call answers, once sent, become part of the prep (a done meeting keeps them for the record)
    const answered = await syncQuestionnaire(sb, s);
    if (answered) {
      const { data: u } = await sb.from("coaching_sessions").update({ questionnaire: answered, questionnaire_submission_id: (answered as any).submission_id }).eq("id", s.id).select("*").single();
      s = u ?? s;
      await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actor: "athlete", action: "questions_answered", detail: { submission_id: (answered as any).submission_id } });
    }
  }
  // what's new since the coach last looked (then this look counts)
  const reviewedBefore: string | null = s.coach_reviewed_at ?? null;
  if (data.review) {
    await sb.from("coaching_sessions").update({ coach_reviewed_at: new Date().toISOString() }).eq("id", s.id);
  }
  const [{ data: commitments }, { data: recs }, { data: client }, { data: intel }, { data: audio }, appointment] = await Promise.all([
    supabase.from("coaching_session_commitments").select("*").eq("client_id", s.client_id).or(`and(status.eq.open,confirmed.eq.true),session_id.eq.${s.id}`).order("created_at"),
    supabase.from("coaching_session_recommendations").select("*").eq("session_id", s.id).order("created_at"),
    supabase.from("clients").select("first_name, preferred_name, full_name, user_id, preferred_weight_unit").eq("id", s.client_id).maybeSingle(),
    supabase.from("client_intelligence").select("*").eq("client_id", s.client_id).neq("status", "archived").order("updated_at", { ascending: false }).limit(120),
    supabase.from("coaching_session_audio").select("id, seq, status, offset_ms, duration_ms, transcript, model, error, created_at").eq("session_id", s.id).order("seq"),
    appointmentFor(sb, s.pt_session_id ?? null),
  ]);
  const agenda = normalizeAgenda(s.agenda);
  const newSince = (at: string | undefined) => !!at && !!reviewedBefore && at > reviewedBefore;
  const changesSinceReview = ((s.changes ?? []) as any[]).filter((x) => newSince(x.at));
  const q = s.questionnaire;
  const readiness = meetingReadiness({
    state: appointment?.state ?? null,
    planReady: !!agenda,
    briefStatus: s.write_up_status,
    coachReviewed: !!reviewedBefore,
    changesSinceReview: changesSinceReview.length,
    questions: q?.submitted_at ? "answered" : q?.sent_at ? "sent" : questions && questions.useful ? "not_sent" : "not_needed",
    clarify: (agenda?.clarify ?? []).filter((x) => (x.status ?? "open") === "open").length,
    access: appointment?.meetLink
      ? { kind: "video", label: "Video link" }
      : appointment?.location && !/^(video|phone) call/i.test(appointment.location)
        ? { kind: "place", label: appointment.location.split(",")[0] ?? null }
        : { kind: s.format === "retrospective" ? "place" : "none", label: null },
    format: s.format,
  });
  return {
    session: { ...s, agenda: agenda ?? s.agenda },
    firstName: (client as any)?.preferred_name || (client as any)?.first_name || null,
    clientName: (client as any)?.full_name ?? null,
    hasApp: !!(client as any)?.user_id,
    unit: ((client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb") as "kg" | "lb",
    cleo,
    questions,
    reviewedBefore,
    changesSinceReview,
    appointment,
    readiness,
    audio: (audio ?? []) as any[],
    commitments: (commitments ?? []) as any[],
    recommendations: (recs ?? []) as any[],
    intelligence: ((intel ?? []) as any[]).filter((i) => i.source_session_id === s.id),
    memories: (intel ?? []) as any[],
  };
}

export async function updateSession(c: Caller, data: any) {
  const { session, sb, userId } = await reachSession(c, data.sessionId);
  const { writeFresh } = await import("./fresh-write.server");
  let before = session.status as string;
  // worked out from the row as it is when written, so a tap never undoes another (or a refresh)
  const res = await writeFresh(
    sb,
    session.id,
    async (row) => {
      before = row.status;
      const patch: Record<string, unknown> = {};
      if (data.coachNotes !== undefined) patch.coach_notes = data.coachNotes;
      if (data.priorities) patch.coach_priorities = data.priorities;
      if (data.minutes) patch.minutes = data.minutes;
      const was = row.live ?? {};
      let live = was;
      if (data.live) live = { ...live, ...data.live };
      // the meeting's clock: when it went live (kept if it's restarted), when it ended
      if (data.status === "live" && !live.started_at) live = { ...live, started_at: new Date().toISOString() };
      if (data.status === "done" && row.status === "live") live = { ...live, ended_at: new Date().toISOString() };
      if (live !== was) patch.live = live;
      if (data.status) patch.status = data.status;
      if (data.gamePlan) patch.game_plan = data.gamePlan;
      if (data.outcome) patch.outcome = { ...(row.outcome ?? {}), ...data.outcome };
      if (data.agendaOps?.length) {
        const { applyAgendaOp } = await import("./prepare");
        const now = new Date().toISOString();
        let agenda: any = row.agenda;
        for (const op of data.agendaOps) agenda = applyAgendaOp(agenda, op, now);
        patch.agenda = agenda;
      }
      return patch;
    },
    { first: session },
  );
  if (res?.wrote && data.status && data.status !== before) {
    const { logSessionEvent } = await import("./sessions.server");
    await logSessionEvent(sb, { sessionId: session.id, clientId: session.client_id, actorId: userId, actor: "coach", action: `status_${data.status}` });
  }
  return { ok: true };
}

export async function commitment(c: Caller, data: any) {
  const { session, sb } = await reachSession(c, data.sessionId);
  if (!data.id) {
    if (!data.owner || !data.text) throw new Error("Say who and what");
    const { data: row, error } = await sb
      .from("coaching_session_commitments")
      .insert({ client_id: session.client_id, session_id: session.id, owner: data.owner, text: data.text, due_on: data.dueOn ?? null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  }
  const patch: Record<string, unknown> = {};
  if (data.text) patch.text = data.text;
  if (data.owner) patch.owner = data.owner;
  if (data.dueOn !== undefined) patch.due_on = data.dueOn;
  if (data.confirmed !== undefined) patch.confirmed = data.confirmed;
  if (data.status) {
    patch.status = data.status;
    patch.closed_at = data.status === "open" ? null : new Date().toISOString();
  }
  const { error } = await sb.from("coaching_session_commitments").update(patch).eq("id", data.id).eq("client_id", session.client_id);
  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function sendSessionSummary(c: Caller, data: any) {
  const { session, sb, userId } = await reachSession(c, data.sessionId);
  if (session.shared_message_id) return { messageId: session.shared_message_id as string, already: true };
  const { data: client } = await sb.from("clients").select("user_id").eq("id", session.client_id).maybeSingle();
  if (!(client as any)?.user_id) throw new Error("They don't have the app yet: copy the summary instead.");
  // claim first, so a second tap never sends twice
  const { data: claimed } = await sb
    .from("coaching_sessions")
    .update({ shared_at: new Date().toISOString() })
    .eq("id", session.id)
    .is("shared_at", null)
    .select("id");
  if (!claimed?.length) return { messageId: null, already: true };
  const { data: msg, error } = await sb
    .from("messages")
    .insert({
      client_id: session.client_id,
      sender_id: userId,
      sender_role: "admin",
      body: data.text,
      message_type: "Coaching",
      is_automated: false,
      read_by_admin_at: new Date().toISOString(),
      attachments: [{ kind: "coaching_session_summary", session_id: session.id }],
    })
    .select("id")
    .single();
  if (error) {
    await sb.from("coaching_sessions").update({ shared_at: null }).eq("id", session.id);
    throw new Error(error.message);
  }
  await sb.from("coaching_sessions").update({ shared_message_id: msg.id }).eq("id", session.id);
  try {
    const { pushNewMessage } = await import("@/lib/push/message-push.server");
    await pushNewMessage(sb, { id: msg.id, client_id: session.client_id, sender_id: userId, sender_role: "admin", is_internal_note: false, body: data.text, attachments: [] } as any);
  } catch (e) {
    console.warn("[sessions] game plan push failed", e);
  }
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: session.id, clientId: session.client_id, actorId: userId, actor: "coach", action: "summary_sent", detail: { message_id: msg.id } });
  return { messageId: msg.id as string, already: false };
}

export async function getPresentation(c: Caller, data: any) {
  const { session, supabase } = await reachSession(c, data.sessionId);
  const { athleteView, SECTION_PROMPTS } = await import("./presentation");
  const { normalizeAgenda } = await import("./prepare");
  const plan = normalizeAgenda(session.agenda);
  const { data: client } = await supabase
    .from("clients")
    .select("first_name, preferred_name")
    .eq("id", session.client_id)
    .maybeSingle();
  const e = session.event ?? {};
  return {
    firstName: (client as any)?.preferred_name || (client as any)?.first_name || null,
    event: e.title
      ? { title: String(e.title), date: e.date ?? null, daysOut: e.daysOut ?? null, phase: e.phase ?? null, kind: e.kind ?? "general" }
      : null,
    minutes: session.minutes ?? null,
    // the objective only when it isn't the coach's private priority
    objective: plan && !plan.objectivePrivate ? plan.objective : null,
    sections: athleteView(session.agenda).map((s) => ({ ...s, prompt: SECTION_PROMPTS[s.key] })),
    agreed: ((session.live?.decisions ?? []) as string[]).slice(0, 12),
  };
}

/**
 * The shared screen's pictures, from the athlete's own records only (their
 * workouts, weigh-ins, all-time records and the meet's date), read with the
 * caller's own login. Each part is best effort: one that can't be read is
 * left out, never guessed.
 */
export async function getPresentationVisuals(c: Caller, data: any) {
  const { session, supabase } = await reachSession(c, data.sessionId);
  const { weekBuckets, classLimit } = await import("./visuals");
  const { todayIn } = await import("./sessions.server");
  const clientId = session.client_id as string;
  const { data: client } = await supabase
    .from("clients")
    .select("user_id, timezone, preferred_weight_unit")
    .eq("id", clientId)
    .maybeSingle();
  const today = todayIn((client as any)?.timezone);
  const unit: "kg" | "lb" = (client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb";
  const userId = (client as any)?.user_id ?? null;
  const LB = 2.20462;
  const inUnit = (kg: number) => Math.round((unit === "lb" ? kg * LB : kg) * 10) / 10;
  const toKg = (v: number, u: string | null) => (u === "kg" ? v : v / LB);
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const from28 = addDays(today, -27);
  const from42 = addDays(today, -41);
  const [dated, canonical, legacy, recent] = await Promise.all([
    safe(async () => {
      const { loadDatedWorkouts } = await import("@/lib/cleo-schedule.server");
      return (await loadDatedWorkouts(supabase, { clientIds: [clientId], from: from28, to: today })) as any[];
    }, null as any[] | null),
    userId
      ? safe(async () => {
          const { data: rows, error } = await supabase
            .from("progress_bodyweight")
            .select("id, logged_date, weight_value, weight_unit, note")
            .eq("user_id", userId)
            .gte("logged_date", from42)
            .order("logged_date");
          if (error) throw new Error(error.message);
          return (rows ?? []) as any[];
        }, [] as any[])
      : Promise.resolve([] as any[]),
    safe(async () => {
      const { data: rows, error } = await supabase
        .from("progress_metrics")
        .select("id, entry_date, bodyweight, bodyweight_unit, notes")
        .eq("client_id", clientId)
        .not("bodyweight", "is", null)
        .gte("entry_date", from42)
        .order("entry_date");
      if (error) throw new Error(error.message);
      return (rows ?? []) as any[];
    }, [] as any[]),
    safe(async () => {
      const { data: r, error } = await supabase.rpc("client_recent_records", { _client_id: clientId, _since: `${from28}T00:00:00Z` });
      if (error) throw new Error(error.message);
      const { prepRecords } = await import("@/lib/coaching-packages/call-prep.server");
      return await prepRecords(r);
    }, null as any),
  ]);

  const mine = (dated ?? []).filter((w) => w.clientId === clientId && w.visible);
  const training = dated ? weekBuckets(mine.map((w) => ({ date: w.date, done: !!w.done, optional: !!w.optional })), today) : null;

  const { mergeBodyweightSeries } = await import("@/lib/bodyweight");
  const points = mergeBodyweightSeries(canonical as any, legacy as any)
    .filter((p) => Number.isFinite(p.value) && p.value > 0 && p.date >= from42 && p.date <= today)
    .map((p) => ({ date: p.date, value: inUnit(toKg(p.value, p.unit as string)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const e = session.event ?? {};
  const limitKg = classLimit(e.weightClass ?? null);
  const bodyweight = points.length
    ? { points, limit: limitKg != null ? inUnit(limitKg) : null, classLabel: e.weightClass ? `${String(e.weightClass).replace(/\s*kg$/i, "")} kg class` : null }
    : null;

  const records = ((recent?.top ?? []) as any[]).map((r) => ({
    exercise: String(r.exercise),
    load: Math.round((unit === "lb" ? r.loadKg * LB : r.loadKg) * 2) / 2,
    reps: Number(r.reps),
    date: String(r.date),
  }));

  return {
    unit,
    training,
    bodyweight,
    records,
    countdown: e.title && e.daysOut != null && e.daysOut >= 0 ? { daysOut: Number(e.daysOut), date: e.date ?? null, title: String(e.title) } : null,
  };
}

export async function sendSessionQuestions(c: Caller, data: any) {
  const { session: s, supabase, sb, userId } = await reachSession(c, data.sessionId);
  const sentAt = s.questionnaire?.sent_at;
  if (sentAt && Date.now() - Date.parse(sentAt) < 10 * 60_000) return { already: true, keys: (s.questionnaire.keys ?? []) as string[] };
  const { data: client } = await sb.from("clients").select("user_id").eq("id", s.client_id).maybeSingle();
  if (!(client as any)?.user_id) throw new Error("They don't have the app yet, so there's nowhere to send the questions.");
  const { loadSessionContext, questionsFor, logSessionEvent } = await import("./sessions.server");
  const { PRE_CALL_FORM_ID } = await import("./questionnaire");
  const ctx = await loadSessionContext(supabase, s.client_id, c.trusted ? { includeTests: true } : {});
  let topicsKnown = false;
  if (s.pt_session_id) {
    const { data: t } = await sb.from("coaching_call_topics").select("topics").eq("pt_session_id", s.pt_session_id).maybeSingle();
    topicsKnown = !!(t as any)?.topics?.trim();
  }
  const q = await questionsFor(ctx, s.event?.title ? s.event : null, topicsKnown);
  if (!q.keys.length) throw new Error("Nothing is missing: there's nothing to ask before this call.");
  const { data: form } = await sb.from("nf_forms").select("id, title, active, archived").eq("id", PRE_CALL_FORM_ID).maybeSingle();
  if (!form || (form as any).archived) throw new Error("The “Before our call” form isn't in your library.");
  if (!(form as any).active) await sb.from("nf_forms").update({ active: true }).eq("id", PRE_CALL_FORM_ID);
  const now = new Date().toISOString();
  // claimed before anything goes: a second tap finds it sent and sends nothing
  const { writeFresh } = await import("./fresh-write.server");
  let before: any = null;
  const claim = await writeFresh(
    sb,
    s.id,
    (row) => {
      const at = row.questionnaire?.sent_at;
      if (at && Date.now() - Date.parse(at) < 10 * 60_000) return null;
      before = row.questionnaire ?? null;
      return { questionnaire: { ...(row.questionnaire ?? {}), sent_at: now, sending: true } };
    },
    { first: s },
  );
  if (!claim?.wrote) return { already: true, keys: ((claim?.row as any)?.questionnaire?.keys ?? []) as string[] };
  const giveBack = () =>
    sb.from("coaching_sessions").update({ questionnaire: before }).eq("id", s.id).eq("questionnaire->>sent_at", now);
  try {
    const { data: existing } = await sb.from("nf_assignments").select("settings").eq("form_id", PRE_CALL_FORM_ID).eq("client_id", s.client_id).maybeSingle();
    // this send's questions in this send's words (never an earlier send's wording)
    const settings = { ...(((existing as any)?.settings ?? {}) as Record<string, unknown>), ask_keys: q.keys, ask_labels: (q as any).labels ?? {}, session_id: s.id };
    const { error: aErr } = await sb
      .from("nf_assignments")
      .upsert({ form_id: PRE_CALL_FORM_ID, client_id: s.client_id, last_sent_by: userId, last_sent_at: now, settings }, { onConflict: "form_id,client_id" });
    if (aErr) throw new Error(aErr.message);
    const body = data.note?.trim() || `Before our call: a few quick questions so we can use our time well (about ${q.minutes} min).`;
    const { data: msg, error } = await sb
      .from("messages")
      .insert({
        client_id: s.client_id,
        sender_id: userId,
        sender_role: "admin",
        body,
        message_type: "Form",
        is_automated: false,
        read_by_admin_at: now,
        attachments: [
          {
            kind: "form_request",
            type: "link",
            url: `/portal/check-ins/${PRE_CALL_FORM_ID}`,
            form_id: PRE_CALL_FORM_ID,
            assignment_client_ids: [s.client_id],
            request_title: (form as any).title,
            request_note: data.note?.trim() || undefined,
          },
        ],
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    try {
      const { pushNewMessage } = await import("@/lib/push/message-push.server");
      await pushNewMessage(sb, { id: msg.id, client_id: s.client_id, sender_id: userId, sender_role: "admin", is_internal_note: false, body, attachments: [] } as any);
    } catch (e) {
      console.warn("[sessions] questions push failed", e);
    }
    await writeFresh(sb, s.id, () => ({ questionnaire: { sent_at: now, keys: q.keys, minutes: q.minutes, reasons: q.reasons, message_id: msg.id, answers: {} } }));
    await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "questions_sent", detail: { keys: q.keys, message_id: msg.id } });
    return { already: false, keys: q.keys as string[] };
  } catch (e) {
    await giveBack();
    throw e;
  }
}

export async function queueBrief(c: Caller, data: any) {
  const { session: s, supabase, sb, userId } = await reachSession(c, data.sessionId);
  const { hasCleo } = await import("./sessions.server");
  if (!(await cleoFor(c))) throw new Error("Cleo isn't switched on for your account.");
  if (s.write_up_status === "running" || s.write_up_status === "queued") return { queued: true };
  const p = { ...(s.progress ?? {}) };
  delete p.brief;
  await sb.from("coaching_sessions").update({ write_up_status: "queued", attempts: 0, progress: Object.keys(p).length ? p : null }).eq("id", s.id);
  return { queued: true };
}

export async function importTranscript(c: Caller, data: any) {
  const { session: s, supabase, sb, userId } = await reachSession(c, data.sessionId);
  const { hasCleo, logSessionEvent } = await import("./sessions.server");
  if (!(await cleoFor(c))) throw new Error("Cleo isn't switched on for your account.");
  if (data.source !== "notes" && !data.consent) throw new Error("Confirm they agreed to the call being recorded and used for their coaching.");
  if (s.analysis_status === "running") throw new Error("Cleo is already reading this meeting.");
  const path = `${s.client_id}/${s.id}.txt`;
  const { error: upErr } = await sb.storage
    .from("coaching-transcripts")
    .upload(path, new Blob([data.text], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
  if (upErr) throw new Error(upErr.message);
  const now = new Date();
  const retain = data.retainDays ? new Date(now.getTime() + data.retainDays * 86_400_000).toISOString().slice(0, 10) : null;
  const p = { ...(s.progress ?? {}) };
  delete p.analysis;
  const { error } = await sb
    .from("coaching_sessions")
    .update({
      transcript_path: path,
      transcript_source: data.source,
      transcript_consent_at: data.source === "notes" ? null : now.toISOString(),
      transcript_retain_until: retain,
      transcript_deleted_at: null,
      analysis_status: "queued",
      analysis_error: null,
      attempts: 0,
      progress: Object.keys(p).length ? p : null,
      status: s.status === "cancelled" ? s.status : "done",
    })
    .eq("id", s.id);
  if (error) throw new Error(error.message);
  await logSessionEvent(sb, {
    sessionId: s.id,
    clientId: s.client_id,
    actorId: userId,
    actor: "coach",
    action: "transcript_added",
    detail: { source: data.source, consent: data.source !== "notes", retain_until: retain, chars: data.text.length },
  });
  return { queued: true, retainUntil: retain };
}

export async function analyseNotes(c: Caller, data: any) {
  const { session: s, supabase, sb, userId } = await reachSession(c, data.sessionId);
  const { hasCleo } = await import("./sessions.server");
  if (!(await cleoFor(c))) throw new Error("Cleo isn't switched on for your account.");
  const words = [s.live?.notes ?? "", ...((s.live?.decisions ?? []) as string[])].join(" ").trim();
  if (!s.transcript_path && words.length < 40) throw new Error("Add a few lines of notes first.");
  if (s.analysis_status === "running") return { queued: true };
  const p = { ...(s.progress ?? {}) };
  delete p.analysis;
  await sb.from("coaching_sessions").update({ analysis_status: "queued", analysis_error: null, attempts: 0, progress: Object.keys(p).length ? p : null }).eq("id", s.id);
  return { queued: true };
}

export async function deleteTranscript(c: Caller, data: any) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  if (s.transcript_path) {
    const { error } = await sb.storage.from("coaching-transcripts").remove([s.transcript_path]);
    if (error) throw new Error(error.message);
  }
  const { deleteRecordingAudio } = await import("./audio.server");
  await deleteRecordingAudio(sb, s.id).catch(() => 0);
  const patch: Record<string, unknown> = { transcript_path: null, transcript_deleted_at: new Date().toISOString() };
  // a reading still waiting or under way stops: there's nothing left to read (the worker drops what it found)
  if (s.analysis_status === "queued" || s.analysis_status === "running") {
    patch.analysis_status = "none";
    patch.analysis_error = null;
  }
  if (data.derived !== "none") {
    patch.analysis = null;
    patch.analysis_status = "none";
    patch.analysis_error = null;
    await Promise.all([
      sb.from("coaching_session_recommendations").delete().eq("session_id", s.id).in("status", data.derived === "all" ? ["proposed", "approved", "edited", "kept", "rejected", "deferred", "clarify"] : ["proposed"]),
      sb.from("client_intelligence").delete().eq("source_session_id", s.id).in("status", data.derived === "all" ? ["proposed", "confirmed", "archived"] : ["proposed"]),
      sb.from("coaching_session_commitments").delete().eq("session_id", s.id).eq("confirmed", false),
    ]);
  }
  await sb.from("coaching_sessions").update(patch).eq("id", s.id);
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "transcript_deleted", detail: { derived: data.derived } });
  return { ok: true };
}

export async function decideRecommendation(c: Caller, data: any) {
  const { supabase, userId } = c;
  const { data: r, error } = await supabase.from("coaching_session_recommendations").select("*").eq("id", data.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!r) throw new Error("You can't see this recommendation.");
  const { assertReach, admin, logSessionEvent } = await import("./sessions.server");
  await reachClient(c, (r as any).client_id);
  const sb = await admin();
  const going = data.status === "approved" || data.status === "edited";
  const routed = going ? ROUTE_FOR[(r as any).area] ?? "manual" : null;
  const proposed = data.status === "edited" && data.proposed ? data.proposed : (r as any).proposed_text;
  const decided = data.status !== "proposed";
  const { error: uErr } = await sb
    .from("coaching_session_recommendations")
    .update({
      status: data.status,
      decision_note: data.note ?? null,
      proposed_text: proposed,
      routed_kind: routed,
      decided_by: decided ? userId : null,
      decided_at: decided ? new Date().toISOString() : null,
    })
    .eq("id", data.id);
  if (uErr) throw new Error(uErr.message);
  await logSessionEvent(sb, {
    sessionId: (r as any).session_id,
    clientId: (r as any).client_id,
    actorId: userId,
    actor: "coach",
    action: `recommendation_${data.status}`,
    // an edit keeps what Cleo proposed, so the record shows what the coach changed
    detail: { id: data.id, area: (r as any).area, routed, ...(data.status === "edited" ? { original: (r as any).proposed_text ?? null, approved: proposed } : {}) },
  });
  const ask = going
    ? [`From our call: ${(r as any).title}.`, proposed ? `Change: ${proposed}` : null, (r as any).reason ? `Why: ${(r as any).reason}` : null].filter(Boolean).join(" ")
    : null;
  return { routed, area: (r as any).area as string, ask };
}

export async function intelligence(c: Caller, data: any) {
  const { supabase, userId } = c;
  const { assertReach, admin } = await import("./sessions.server");
  await reachClient(c, data.clientId);
  const sb = await admin();
  const now = new Date().toISOString();
  const shape = () => {
    const p: Record<string, unknown> = {};
    if (data.text) p.text = data.text;
    if (data.kind) p.kind = data.kind;
    if (data.permanence) {
      p.permanence = data.permanence;
      p.expires_on = data.permanence === "temporary" ? data.expiresOn ?? new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10) : null;
    } else if (data.expiresOn !== undefined) p.expires_on = data.expiresOn;
    if (data.visibility) p.visibility = data.visibility;
    return p;
  };
  if (data.action === "add") {
    if (!data.text) throw new Error("Say what to remember");
    const { data: row, error } = await sb
      .from("client_intelligence")
      .insert({ client_id: data.clientId, kind: data.kind ?? "other", status: "confirmed", confirmed_by: userId, confirmed_at: now, source_session_id: data.sessionId ?? null, permanence: "lasting", ...shape() })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  }
  if (!data.id) throw new Error("Which one?");
  const scoped = (q: any) => q.eq("id", data.id).eq("client_id", data.clientId);
  if (data.action === "remove") {
    const { error } = await scoped(sb.from("client_intelligence").delete());
    if (error) throw new Error(error.message);
    return { id: data.id };
  }
  const patch: Record<string, unknown> =
    data.action === "confirm"
      ? { status: "confirmed", confirmed_by: userId, confirmed_at: now, ...shape() }
      : data.action === "archive"
        ? { status: "archived" }
        : data.action === "restore"
          ? { status: "confirmed", confirmed_by: userId, confirmed_at: now }
          : shape();
  const { error } = await scoped(sb.from("client_intelligence").update(patch));
  if (error) throw new Error(error.message);
  return { id: data.id };
}

/**
 * A recommendation the coach applied through its own editor (or by hand):
 * Applied is its own fact, never implied by Approve. Undo clears it.
 */
export async function markRecommendationApplied(c: Caller, data: { id: string; applied: boolean }) {
  const { supabase, userId } = c;
  const { data: r, error } = await supabase.from("coaching_session_recommendations").select("id, client_id, session_id, status").eq("id", data.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!r) throw new Error("You can't see this recommendation.");
  await reachClient(c, (r as any).client_id);
  if (data.applied && !["approved", "edited"].includes((r as any).status)) throw new Error("Approve it first.");
  const sb = await admin();
  const { error: uErr } = await sb
    .from("coaching_session_recommendations")
    .update(data.applied ? { applied_at: new Date().toISOString(), applied_by: userId } : { applied_at: null, applied_by: null })
    .eq("id", data.id);
  if (uErr) throw new Error(uErr.message);
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: (r as any).session_id, clientId: (r as any).client_id, actorId: userId, actor: "coach", action: data.applied ? "recommendation_applied" : "recommendation_unapplied", detail: { id: data.id } });
  return { ok: true };
}

const MEMORY_FIELDS = "id, client_id, kind, text, status, permanence, expires_on, visibility, auto_kept, event_key, event_title, event_date, review_reason, duplicate_of, conflicts_with, merged_count, confirmed_by, confirmed_at";

/**
 * Many memories at once (keep, let go, archive), returning exactly what they
 * were so one Undo puts every one back.
 */
export async function intelligenceBulk(c: Caller, data: { clientId: string; ids: string[]; action: "confirm" | "remove" | "archive" | "dismiss_conflict" }) {
  const { userId } = c;
  await reachClient(c, data.clientId);
  const sb = await admin();
  const { data: before, error } = await sb.from("client_intelligence").select("*").eq("client_id", data.clientId).in("id", data.ids);
  if (error) throw new Error(error.message);
  const rows = (before ?? []) as any[];
  if (!rows.length) return { snapshot: [] as any[] };
  const ids = rows.map((r) => r.id);
  const now = new Date().toISOString();
  if (data.action === "remove") {
    const { error: e } = await sb.from("client_intelligence").delete().eq("client_id", data.clientId).in("id", ids);
    if (e) throw new Error(e.message);
  } else {
    const patch =
      data.action === "confirm"
        ? { status: "confirmed", confirmed_by: userId, confirmed_at: now, review_reason: null, auto_kept: false }
        : data.action === "archive"
          ? { status: "archived" }
          : { conflicts_with: null, review_reason: null };
    const { error: e } = await sb.from("client_intelligence").update(patch).eq("client_id", data.clientId).in("id", ids);
    if (e) throw new Error(e.message);
  }
  return { snapshot: rows };
}

/** Undo for a bulk change: the rows exactly as they were (re-created when they were let go). */
export async function intelligenceRestore(c: Caller, data: { clientId: string; rows: any[] }) {
  await reachClient(c, data.clientId);
  const sb = await admin();
  const rows = (data.rows ?? []).filter((r) => r && r.client_id === data.clientId && typeof r.id === "string");
  if (!rows.length) return { ok: true };
  const allowed = MEMORY_FIELDS.split(", ").concat(["source_session_id", "source_quote", "created_at"]);
  // Undo puts back this client's memories only: an id that's another client's is never touched,
  // and a source meeting must be one of theirs
  const ids = rows.map((r) => r.id);
  const sessionIds = [...new Set(rows.map((r) => r.source_session_id).filter(Boolean))];
  const [{ data: taken }, { data: theirs }] = await Promise.all([
    sb.from("client_intelligence").select("id, client_id").in("id", ids),
    sessionIds.length
      ? sb.from("coaching_sessions").select("id").eq("client_id", data.clientId).in("id", sessionIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const elsewhere = new Set(((taken ?? []) as any[]).filter((t) => t.client_id !== data.clientId).map((t) => t.id));
  const okSessions = new Set(((theirs ?? []) as any[]).map((t) => t.id));
  const clean = rows
    .filter((r) => !elsewhere.has(r.id))
    .map((r) => ({
      ...Object.fromEntries(Object.entries(r).filter(([k]) => allowed.includes(k))),
      client_id: data.clientId,
      source_session_id: r.source_session_id && okSessions.has(r.source_session_id) ? r.source_session_id : null,
    }));
  if (!clean.length) return { ok: true };
  const { error } = await sb.from("client_intelligence").upsert(clean, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Open times to move a call to, from the coach's own availability for that
 * booking type (the booking engine's slots), for the client asking. Only
 * their own booked call; the coach still approves the time they pick.
 */
export async function rescheduleSlots(c: Caller, data: { ptSessionId: string }) {
  const { supabase } = c;
  // RLS: a client reads only their own sessions
  const { data: pt, error } = await supabase
    .from("pt_sessions")
    .select("id, client_id, booking_card_id, session_type, start_time, end_time, status, timezone")
    .eq("id", data.ptSessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pt || (pt as any).status !== "Scheduled") return { slots: [] as string[], timezone: null };
  const sb = await admin();
  const { data: own } = await sb.from("clients").select("user_id").eq("id", (pt as any).client_id).maybeSingle();
  if ((own as any)?.user_id !== c.userId) return { slots: [] as string[], timezone: null };
  if (!(pt as any).booking_card_id) return { slots: [] as string[], timezone: (pt as any).timezone ?? null };
  const [sh, sm] = String((pt as any).start_time).slice(0, 5).split(":").map(Number);
  const [eh, em] = String((pt as any).end_time).slice(0, 5).split(":").map(Number);
  const minutes = eh! * 60 + em! - (sh! * 60 + sm!);
  try {
    const { loadBookingTypeById, openSlots } = await import("@/lib/booking.server");
    const { withDuration } = await import("@/lib/booking-types");
    const loaded = await loadBookingTypeById(sb, (pt as any).booking_card_id);
    if (!loaded) return { slots: [] as string[], timezone: (pt as any).timezone ?? null };
    const type = withDuration(loaded as any, minutes > 0 ? minutes : undefined);
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const slots = await openSlots(sb, type as any, today, to);
    const starts = (slots ?? []).map((x) => x.start).filter(Boolean).slice(0, 40);
    return { slots: starts as string[], timezone: (loaded as any).timezone ?? (pt as any).timezone ?? null };
  } catch (e) {
    console.warn("[meetings] reschedule slots", e);
    return { slots: [] as string[], timezone: (pt as any).timezone ?? null };
  }
}

/* ------------------------------------------------------------------ */
/* Recording a meeting (audio.server.ts, recording.ts)                 */

const AUDIO_BUCKET = "coaching-recordings";
const audioExt = (mime: string) => (/mp4|m4a|aac/i.test(mime) ? "m4a" : /ogg/i.test(mime) ? "ogg" : /wav/i.test(mime) ? "wav" : "webm");

/**
 * Start recording: only with everyone's consent, recorded with who's taking
 * part and how long the audio and words are kept. Nothing records before this.
 */
export async function recordingStart(c: Caller, data: { sessionId: string; mode: "room" | "call_tab"; participants: Array<{ role: "coach" | "client" | "other"; name: string | null }>; consent: boolean; retainDays: number }) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  if (!data.consent) throw new Error("Confirm everyone in the meeting agreed to it being recorded.");
  if (s.recording?.status === "recording") return { ok: true, already: true, parts: Number(s.recording.parts_uploaded ?? 0) };
  const now = new Date().toISOString();
  const recording = {
    status: "recording",
    mode: data.mode,
    started_at: now,
    retain_days: data.retainDays,
    participants: data.participants.slice(0, 8),
    consent: { at: now, by: userId, method: "verbal", participants: data.participants.map((p) => p.name || p.role) },
    speakers: s.recording?.speakers ?? {},
    speaker_refs: s.recording?.speaker_refs ?? [],
    // a second recording of the same meeting continues the parts' numbering
    first_seq: Number(s.recording?.parts ?? 0),
  };
  await sb.from("coaching_sessions").update({ recording, status: s.status === "ready" ? "live" : s.status }).eq("id", s.id);
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "recording_started", detail: { mode: data.mode, participants: recording.consent.participants, retain_days: data.retainDays } });
  return { ok: true, already: false, parts: recording.first_seq };
}

/** A signed link the recorder uploads one part (or a voice sample) to, after the caller was checked. */
export async function recordingUploadUrl(c: Caller, data: { sessionId: string; seq: number | null; mime: string; ref?: string | null }) {
  const { session: s, sb } = await reachSession(c, data.sessionId);
  if (!s.recording?.consent?.at) throw new Error("Start the recording with everyone's consent first.");
  const path = data.ref
    ? `${s.client_id}/${s.id}/ref-${data.ref.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)}.wav`
    : `${s.client_id}/${s.id}/${data.seq}.${audioExt(data.mime)}`;
  const { data: signed, error } = await sb.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error) throw new Error(error.message);
  return { path, token: signed.token as string, bucket: AUDIO_BUCKET };
}

/** A part is in the bucket: it's queued for its words. Idempotent per part. */
export async function recordingPartDone(c: Caller, data: { sessionId: string; seq: number; path: string; mime: string; bytes: number; offsetMs: number; durationMs: number }) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  if (!data.path.startsWith(`${s.client_id}/${s.id}/`)) throw new Error("That file isn't this meeting's.");
  const folder = `${s.client_id}/${s.id}`;
  const { data: listed } = await sb.storage.from(AUDIO_BUCKET).list(folder, { search: data.path.split("/").pop() });
  if (!(listed ?? []).some((f: any) => f.name === data.path.split("/").pop())) throw new Error("The part didn't upload. It will try again.");
  const { error } = await sb.from("coaching_session_audio").upsert(
    {
      session_id: s.id,
      client_id: s.client_id,
      seq: data.seq,
      path: data.path,
      mime: data.mime.slice(0, 60),
      bytes: data.bytes,
      offset_ms: Math.max(0, Math.round(data.offsetMs)),
      duration_ms: Math.max(0, Math.round(data.durationMs)),
      status: "uploaded",
      attempts: 0,
      error: null,
      created_by: userId,
    },
    { onConflict: "session_id,seq" },
  );
  if (error) throw new Error(error.message);
  const { writeFresh } = await import("./fresh-write.server");
  await writeFresh(sb, s.id, (row) => {
    const rec = row.recording ?? {};
    const uploaded = Math.max(Number(rec.parts_uploaded ?? 0), data.seq + 1);
    return uploaded === Number(rec.parts_uploaded ?? 0) ? null : { recording: { ...rec, parts_uploaded: uploaded } };
  }, { first: s });
  return { ok: true };
}

/** The voice samples from the first part, so later parts keep the same speakers. */
export async function recordingSpeakerRefs(c: Caller, data: { sessionId: string; refs: Array<{ name: string; path: string }> }) {
  const { session: s, sb } = await reachSession(c, data.sessionId);
  const refs = data.refs.filter((r) => r.path.startsWith(`${s.client_id}/${s.id}/ref-`)).slice(0, 4);
  const { writeFresh } = await import("./fresh-write.server");
  // onto the recording as it is (it may have been stopped meanwhile: its status is never undone)
  await writeFresh(sb, s.id, (row) => (row.recording ? { recording: { ...row.recording, speaker_refs: refs } } : null), { first: s });
  return { ok: true };
}

/** Recording stopped: `parts` were made; once each is transcribed the transcript is assembled and read. */
export async function recordingFinish(c: Caller, data: { sessionId: string; parts: number; durationMs: number }) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  const { writeFresh } = await import("./fresh-write.server");
  await writeFresh(sb, s.id, (row) => {
    const rec = row.recording ?? {};
    // already finished (a second Stop, or after a reload): the parts count only grows
    const done = rec.status === "processing" || rec.status === "ready";
    return {
      recording: {
        ...rec,
        status: rec.status === "ready" ? "ready" : "processing",
        parts: Math.max(Number(rec.parts ?? 0), data.parts),
        ...(done ? {} : { stopped_at: new Date().toISOString(), duration_ms: Math.round((Number(rec.duration_ms ?? 0) || 0) + data.durationMs) }),
      },
    };
  }, { first: s });
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "recording_stopped", detail: { parts: data.parts, duration_ms: data.durationMs } });
  const { assembleIfComplete } = await import("./audio.server");
  await assembleIfComplete(sb, s.id).catch(() => false);
  return { ok: true };
}

/**
 * Who's who: the coach names the speakers. The transcript is written again
 * with their names, and Cleo reads it again when the speakers were unnamed
 * when it last read it.
 */
export async function recordingSpeakers(c: Caller, data: { sessionId: string; speakers: Record<string, { role: "coach" | "client" | "other"; name?: string | null }> }) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  const { speakers: list, speakersConfirmed } = await import("./recording");
  const { data: parts } = await sb.from("coaching_session_audio").select("seq, offset_ms, duration_ms, status, transcript").eq("session_id", s.id).order("seq");
  const map = { ...(s.recording?.speakers ?? {}), ...data.speakers };
  const confirmed = speakersConfirmed(list((parts ?? []) as any[], map));
  const wasConfirmed = s.recording?.speakers_confirmed === true;
  const { writeFresh } = await import("./fresh-write.server");
  await writeFresh(sb, s.id, (row) => ({ recording: { ...(row.recording ?? {}), speakers: { ...(row.recording?.speakers ?? {}), ...data.speakers }, speakers_confirmed: confirmed } }), { first: s });
  if (s.recording?.transcript_ready) {
    const { assembleIfComplete } = await import("./audio.server");
    // re-assembled with the names; Cleo reads it again only the first time the speakers are settled
    if (confirmed && !wasConfirmed) await assembleIfComplete(sb, s.id, { force: true });
    else {
      const { assembleTranscript } = await import("./recording");
      const text = assembleTranscript((parts ?? []) as any[], map as any, s.recording?.participants ?? []);
      if (s.transcript_path) await sb.storage.from("coaching-transcripts").upload(s.transcript_path, new Blob([text], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
    }
  }
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "speakers_named", detail: { confirmed } });
  return { ok: true, confirmed };
}

/** Correct one line: its words or who said it. The transcript is written again. */
export async function recordingEditLine(c: Caller, data: { sessionId: string; seq: number; index: number; text?: string; speaker?: string | null }) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  const { data: part } = await sb.from("coaching_session_audio").select("id, transcript").eq("session_id", s.id).eq("seq", data.seq).maybeSingle();
  if (!part) throw new Error("That part isn't there.");
  const t = (part as any).transcript ?? { segments: [] };
  const segs = [...(t.segments ?? [])];
  const seg = segs[data.index];
  if (!seg) throw new Error("That line isn't there.");
  segs[data.index] = { ...seg, ...(data.text != null ? { text: data.text.trim().slice(0, 2000) } : {}), ...(data.speaker !== undefined ? { speaker: data.speaker } : {}), edited: true };
  await sb.from("coaching_session_audio").update({ transcript: { ...t, segments: segs } }).eq("id", (part as any).id);
  if (s.transcript_path && s.recording?.transcript_ready) {
    const { data: parts } = await sb.from("coaching_session_audio").select("seq, offset_ms, duration_ms, status, transcript").eq("session_id", s.id).order("seq");
    const { assembleTranscript } = await import("./recording");
    const text = assembleTranscript((parts ?? []) as any[], (s.recording?.speakers ?? {}) as any, s.recording?.participants ?? []);
    await sb.storage.from("coaching-transcripts").upload(s.transcript_path, new Blob([text], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
  }
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "transcript_line_edited", detail: { seq: data.seq, index: data.index } });
  return { ok: true };
}

/** Delete the recording's audio now (the transcript and what was kept from it stay unless deleted too). */
export async function recordingDeleteAudio(c: Caller, data: { sessionId: string }) {
  const { session: s, sb, userId } = await reachSession(c, data.sessionId);
  const { deleteRecordingAudio } = await import("./audio.server");
  const n = await deleteRecordingAudio(sb, s.id);
  const { logSessionEvent } = await import("./sessions.server");
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "recording_audio_deleted", detail: { parts: n } });
  return { ok: true, parts: n };
}

/* ------------------------------------------------------------------ */
/* Where meetings show up: the profile, the chat, the dashboard         */

/**
 * The client's next booked call, light (no prep is computed): its time,
 * state, how to join, and its meeting's id and readiness when it has one.
 */
export async function nextMeeting(c: Caller, data: { clientId: string }) {
  const { supabase } = c;
  await reachClient(c, data.clientId);
  const { upcomingMeetings } = await import("./meetings.server");
  const { appointmentState, SELF_BOOKED_VIA } = await import("./lifecycle");
  const calls = await upcomingMeetings(supabase, data.clientId);
  const call = calls[0] ?? null;
  const { data: live } = await supabase
    .from("coaching_sessions")
    .select("id, status, scheduled_at, event, pt_session_id, coach_reviewed_at, changes, write_up_status, format")
    .eq("client_id", data.clientId)
    .in("status", ["ready", "live", "preparing"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(5);
  const sessions = (live ?? []) as any[];
  const meeting = call ? sessions.find((s) => s.pt_session_id === call.id) ?? null : sessions.find((s) => s.status === "live") ?? null;
  const { data: after } = await supabase
    .from("coaching_session_recommendations")
    .select("id, status, applied_at")
    .eq("client_id", data.clientId)
    .in("status", ["proposed", "clarify", "approved", "edited"])
    .is("applied_at", null)
    .limit(30);
  return {
    call: call
      ? {
          id: call.id,
          title: call.title || call.session_type || "Call",
          startsAt: call.starts_at,
          endsAt: call.ends_at,
          timezone: call.timezone,
          location: call.location,
          meetLink: call.meet_link,
          sessionDate: call.session_date,
          startTime: call.start_time,
          endTime: call.end_time,
          status: call.status,
          state: appointmentState({ status: call.status, startsAt: call.starts_at, clientConfirmedAt: call.client_confirmed_at, confirmationRequestedAt: call.confirmation_requested_at, bookedByClient: SELF_BOOKED_VIA.has(String(call.booked_via ?? "")) }),
        }
      : null,
    meeting: meeting
      ? {
          id: meeting.id,
          status: meeting.status,
          title: meeting.event?.title ?? null,
          changes: ((meeting.changes ?? []) as any[]).filter((x) => !meeting.coach_reviewed_at || x.at > meeting.coach_reviewed_at).length,
          briefStatus: meeting.write_up_status,
        }
      : null,
    openAfter: ((after ?? []) as any[]).length,
  };
}

/** A booked call's meeting: its id, made now when the worker hasn't yet. */
export async function meetingForBooking(c: Caller, data: { ptSessionId: string }) {
  const { supabase } = c;
  const { data: pt, error } = await supabase
    .from("pt_sessions")
    .select("id, client_id, title, session_type, starts_at, ends_at, start_time, end_time, status")
    .eq("id", data.ptSessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pt) throw new Error("That booking isn't there.");
  await reachClient(c, (pt as any).client_id);
  const sb = await admin();
  const { data: existing } = await sb.from("coaching_sessions").select("id").eq("pt_session_id", data.ptSessionId).order("created_at", { ascending: false }).limit(1);
  if (existing?.length) return { id: existing[0].id as string, clientId: (pt as any).client_id as string };
  const { autoPrepare } = await import("./meetings.server");
  const id = await autoPrepare(supabase, sb, pt, { coachUserId: c.userId, includeTests: !!c.trusted });
  if (!id) throw new Error("This booking is training, not a meeting.");
  return { id, clientId: (pt as any).client_id as string };
}

/**
 * The coach's meetings at a glance (the dashboard): what's coming up in the
 * next week with how ready each is, and finished meetings that still need
 * the coach (recommendations to decide or apply, memories to review, a
 * recording to name). Read through RLS: a coach sees their own clients.
 */
export async function meetingsBoard(c: Caller) {
  const { supabase } = c;
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const since = new Date(now.getTime() - 21 * 86_400_000).toISOString();
  const [{ data: upcoming, error }, { data: recent }] = await Promise.all([
    supabase
      .from("coaching_sessions")
      .select("id, client_id, status, scheduled_at, event, format, coach_reviewed_at, changes, write_up_status, pt_session_id, clients(full_name, first_name, preferred_name)")
      .in("status", ["ready", "live", "preparing"])
      .gte("scheduled_at", new Date(now.getTime() - 2 * 3_600_000).toISOString())
      .lte("scheduled_at", soon)
      .order("scheduled_at")
      .limit(20),
    supabase
      .from("coaching_sessions")
      .select("id, client_id, status, scheduled_at, created_at, event, analysis_status, shared_at, recording, clients(full_name, first_name, preferred_name)")
      .eq("status", "done")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (error) throw new Error(error.message);
  const doneIds = ((recent ?? []) as any[]).map((r) => r.id);
  const [{ data: recs }, { data: mems }] = doneIds.length
    ? await Promise.all([
        supabase.from("coaching_session_recommendations").select("session_id, status, applied_at").in("session_id", doneIds),
        supabase.from("client_intelligence").select("source_session_id, status").in("source_session_id", doneIds).eq("status", "proposed"),
      ])
    : [{ data: [] }, { data: [] }];
  const ptIds = ((upcoming ?? []) as any[]).map((u) => u.pt_session_id).filter(Boolean);
  const { data: pts } = ptIds.length
    ? await supabase.from("pt_sessions").select("id, status, starts_at, meet_link, booked_via, client_confirmed_at, confirmation_requested_at").in("id", ptIds)
    : { data: [] };
  const ptBy = new Map(((pts ?? []) as any[]).map((p) => [p.id, p]));
  const { appointmentState, SELF_BOOKED_VIA } = await import("./lifecycle");
  const nameOf = (r: any) => r.clients?.preferred_name || r.clients?.first_name || r.clients?.full_name || "Client";
  return {
    upcoming: ((upcoming ?? []) as any[]).map((u) => {
      const pt = u.pt_session_id ? ptBy.get(u.pt_session_id) : null;
      return {
        id: u.id,
        clientId: u.client_id,
        name: nameOf(u),
        title: u.event?.title ?? null,
        at: u.scheduled_at,
        status: u.status,
        meetLink: pt?.meet_link ?? null,
        state: pt ? appointmentState({ status: pt.status, startsAt: pt.starts_at, clientConfirmedAt: pt.client_confirmed_at, confirmationRequestedAt: pt.confirmation_requested_at, bookedByClient: SELF_BOOKED_VIA.has(String(pt.booked_via ?? "")) }) : null,
        changes: ((u.changes ?? []) as any[]).filter((x) => !u.coach_reviewed_at || x.at > u.coach_reviewed_at).length,
        reviewed: !!u.coach_reviewed_at,
      };
    }),
    after: ((recent ?? []) as any[])
      .map((r) => {
        const rs = ((recs ?? []) as any[]).filter((x) => x.session_id === r.id);
        const decide = rs.filter((x) => x.status === "proposed" || x.status === "clarify").length;
        const apply = rs.filter((x) => (x.status === "approved" || x.status === "edited") && !x.applied_at).length;
        const memories = ((mems ?? []) as any[]).filter((x) => x.source_session_id === r.id).length;
        const speakers = r.recording?.transcript_ready && r.recording?.speakers_confirmed !== true ? 1 : 0;
        return { id: r.id, clientId: r.client_id, name: nameOf(r), title: r.event?.title ?? null, at: r.scheduled_at ?? r.created_at, decide, apply, memories, speakers, reading: r.analysis_status === "queued" || r.analysis_status === "running" };
      })
      .filter((r) => r.decide + r.apply + r.memories + r.speakers > 0 || r.reading),
  };
}
