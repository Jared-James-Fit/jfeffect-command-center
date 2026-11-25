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
  const { assertReach, loadSessionContext, prepareFor } = await import("./sessions.server");
  await reachClient(c, data.clientId);
  const ctx = await loadSessionContext(supabase, data.clientId, c.trusted ? { includeTests: true } : {});
  const next = ctx.events.find((e) => e.daysOut == null || e.daysOut >= 0) ?? null;
  const { intervention, prep } = await prepareFor(supabase, ctx, { event: next });
  const { data: sessions } = await supabase
    .from("coaching_sessions")
    .select("id, event, format, status, scheduled_at, minutes, created_at, analysis_status, shared_at, write_up_status")
    .eq("client_id", data.clientId)
    .order("created_at", { ascending: false })
    .limit(30);
  return {
    today: ctx.today,
    firstName: ctx.firstName,
    events: ctx.events,
    nextEvent: next,
    intervention,
    missing: prep.missing,
    decisions: prep.decisions,
    sessions: (sessions ?? []) as any[],
    commitments: ctx.commitments,
    intelligence: ctx.intelligence,
    bookedCallOn: ctx.bookedCallOn,
    lastCallOn: ctx.lastCallOn,
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
    const { data: t } = await supabase.from("coaching_call_topics").select("topics").eq("pt_session_id", data.ptSessionId).maybeSingle();
    topics = (t as any)?.topics ?? null;
  }
  const prepared = await prepareFor(supabase, ctx, {
    event,
    coachNotes: data.coachNotes,
    priorities: data.priorities,
    minutes: data.format === "touch_base" ? Math.min(data.minutes ?? 10, 10) : data.minutes,
    topics,
  });
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
  const { syncQuestionnaire, answersForPrep, hasCleo, logSessionEvent } = await import("./sessions.server");
  let s = session;
  const cleo = await cleoFor(c);
  // their pre-call answers, once sent, become part of the prep
  const answered = await syncQuestionnaire(sb, s);
  if (answered) {
    const { data: u } = await sb.from("coaching_sessions").update({ questionnaire: answered, questionnaire_submission_id: (answered as any).submission_id }).eq("id", s.id).select("*").single();
    s = u ?? s;
    await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actor: "athlete", action: "questions_answered", detail: { submission_id: (answered as any).submission_id } });
  }
  let questions: Awaited<ReturnType<typeof import("./sessions.server").questionsFor>> | null = null;
  if ((data.refresh || answered) && (s.status === "ready" || s.status === "preparing")) {
    const { loadSessionContext, prepareFor, questionsFor } = await import("./sessions.server");
    const ctx = await loadSessionContext(supabase, s.client_id, c.trusted ? { includeTests: true } : {});
    const event = s.event?.key ? ctx.events.find((e) => e.key === s.event.key) ?? s.event : null;
    const a = answersForPrep(s.questionnaire);
    const prepared = await prepareFor(supabase, ctx, {
      event,
      coachNotes: s.coach_notes,
      priorities: s.coach_priorities ?? [],
      minutes: s.minutes,
      answers: a.answers,
      topics: a.topics,
      covered: a.covered,
    });
    const requeue = answered && cleo && s.write_up_status !== "running";
    const { data: updated } = await sb
      .from("coaching_sessions")
      .update({
        prep: prepared.prep,
        agenda: prepared.agenda,
        event: event ?? s.event,
        ...(requeue ? { write_up_status: "queued", attempts: 0 } : {}),
      })
      .eq("id", s.id)
      .select("*")
      .single();
    s = updated ?? s;
    if (!s.questionnaire?.sent_at) questions = await questionsFor(ctx, event, false);
  }
  const [{ data: commitments }, { data: recs }, { data: client }, { data: intel }] = await Promise.all([
    supabase.from("coaching_session_commitments").select("*").eq("client_id", s.client_id).or(`and(status.eq.open,confirmed.eq.true),session_id.eq.${s.id}`).order("created_at"),
    supabase.from("coaching_session_recommendations").select("*").eq("session_id", s.id).order("created_at"),
    supabase.from("clients").select("first_name, preferred_name, full_name, user_id").eq("id", s.client_id).maybeSingle(),
    supabase.from("client_intelligence").select("*").eq("source_session_id", s.id).neq("status", "archived").order("created_at"),
  ]);
  return {
    session: s,
    firstName: (client as any)?.preferred_name || (client as any)?.first_name || null,
    clientName: (client as any)?.full_name ?? null,
    hasApp: !!(client as any)?.user_id,
    cleo,
    questions,
    commitments: (commitments ?? []) as any[],
    recommendations: (recs ?? []) as any[],
    intelligence: (intel ?? []) as any[],
  };
}

export async function updateSession(c: Caller, data: any) {
  const { session, sb, userId } = await reachSession(c, data.sessionId);
  const patch: Record<string, unknown> = {};
  if (data.coachNotes !== undefined) patch.coach_notes = data.coachNotes;
  if (data.priorities) patch.coach_priorities = data.priorities;
  if (data.minutes) patch.minutes = data.minutes;
  if (data.live) patch.live = { ...(session.live ?? {}), ...data.live };
  if (data.status) patch.status = data.status;
  if (data.gamePlan) patch.game_plan = data.gamePlan;
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await sb.from("coaching_sessions").update(patch).eq("id", session.id);
  if (error) throw new Error(error.message);
  if (data.status && data.status !== session.status) {
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
  const { data: existing } = await sb.from("nf_assignments").select("settings").eq("form_id", PRE_CALL_FORM_ID).eq("client_id", s.client_id).maybeSingle();
  const settings = { ...(((existing as any)?.settings ?? {}) as Record<string, unknown>), ask_keys: q.keys, session_id: s.id };
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
  await sb
    .from("coaching_sessions")
    .update({ questionnaire: { sent_at: now, keys: q.keys, minutes: q.minutes, reasons: q.reasons, message_id: msg.id, answers: {} } })
    .eq("id", s.id);
  await logSessionEvent(sb, { sessionId: s.id, clientId: s.client_id, actorId: userId, actor: "coach", action: "questions_sent", detail: { keys: q.keys, message_id: msg.id } });
  return { already: false, keys: q.keys as string[] };
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
  const patch: Record<string, unknown> = { transcript_path: null, transcript_deleted_at: new Date().toISOString() };
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
