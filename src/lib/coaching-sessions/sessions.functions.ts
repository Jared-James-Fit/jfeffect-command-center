import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coaching sessions (docs/COACHING_SESSIONS.md). Every read goes through the
 * coach's own login (RLS: their own clients, an admin all), and every write is
 * the server's after the same check (assertReach). Nothing here sends anything
 * to the client except sendSessionSummaryFn, which only the coach's tap calls.
 */

const uuid = z.string().uuid();
const ctxOf = (context: unknown) => context as { supabase: any; userId: string };

async function reachSession(context: unknown, sessionId: string) {
  const { supabase, userId } = ctxOf(context);
  const { data: s, error } = await supabase.from("coaching_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!s) throw new Error("You can't see this session.");
  const { assertReach, admin } = await import("./sessions.server");
  await assertReach(supabase, userId, s.client_id);
  return { session: s as any, supabase, userId, sb: await admin() };
}

/** The Sessions tab: upcoming events, what Cleo recommends now, sessions, open commitments. */
export const getSessionsHomeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = ctxOf(context);
    const { assertReach, loadSessionContext, prepareFor } = await import("./sessions.server");
    await assertReach(supabase, userId, data.clientId);
    const ctx = await loadSessionContext(supabase, data.clientId);
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
  });

const prepareInput = z.object({
  clientId: uuid,
  eventKey: z.string().max(120).nullable().optional(),
  customTitle: z.string().trim().max(160).nullable().optional(),
  format: z.enum(["call", "touch_base", "retrospective"]).default("call"),
  minutes: z.number().int().min(5).max(120).nullable().optional(),
  coachNotes: z.string().max(4000).nullable().optional(),
  priorities: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  ptSessionId: uuid.nullable().optional(),
  scheduledAt: z.string().max(40).nullable().optional(),
  /** a key from the app, so a double tap prepares one session */
  key: z.string().max(80).nullable().optional(),
});

/** Prepare a session: the event, the coach's notes, the prep and the agenda, in one tap. */
export const prepareSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => prepareInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = ctxOf(context);
    const { assertReach, admin, loadSessionContext, prepareFor, pickEvent, logSessionEvent } = await import(
      "./sessions.server"
    );
    await assertReach(supabase, userId, data.clientId);
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
    const ctx = await loadSessionContext(supabase, data.clientId);
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
  });

/** One session: what it's about, the prep (read again while it's ahead), the agenda, commitments. */
export const getSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid, refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { session, supabase, sb } = await reachSession(context, data.sessionId);
    let s = session;
    if (data.refresh && (s.status === "ready" || s.status === "preparing")) {
      const { loadSessionContext, prepareFor } = await import("./sessions.server");
      const ctx = await loadSessionContext(supabase, s.client_id);
      const event = s.event?.key ? ctx.events.find((e) => e.key === s.event.key) ?? s.event : null;
      const prepared = await prepareFor(supabase, ctx, {
        event,
        coachNotes: s.coach_notes,
        priorities: s.coach_priorities ?? [],
        minutes: s.minutes,
        answers: s.questionnaire?.answers ?? {},
      });
      const { data: updated } = await sb
        .from("coaching_sessions")
        .update({ prep: prepared.prep, agenda: prepared.agenda, event: event ?? s.event })
        .eq("id", s.id)
        .select("*")
        .single();
      s = updated ?? s;
    }
    const [{ data: commitments }, { data: recs }, { data: client }] = await Promise.all([
      supabase.from("coaching_session_commitments").select("*").eq("client_id", s.client_id).or(`status.eq.open,session_id.eq.${s.id}`).order("created_at"),
      supabase.from("coaching_session_recommendations").select("*").eq("session_id", s.id).order("created_at"),
      supabase.from("clients").select("first_name, preferred_name, full_name").eq("id", s.client_id).maybeSingle(),
    ]);
    return {
      session: s,
      firstName: (client as any)?.preferred_name || (client as any)?.first_name || null,
      clientName: (client as any)?.full_name ?? null,
      commitments: (commitments ?? []) as any[],
      recommendations: (recs ?? []) as any[],
    };
  });

/** The coach's edits: notes, priorities, length, what's noted in the call, its status. Autosaved. */
export const updateSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: uuid,
        coachNotes: z.string().max(4000).nullable().optional(),
        priorities: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
        minutes: z.number().int().min(5).max(120).optional(),
        live: z
          .object({
            notes: z.string().max(8000).optional(),
            decisions: z.array(z.string().trim().min(1).max(400)).max(30).optional(),
            section: z.string().max(40).optional(),
          })
          .optional(),
        status: z.enum(["ready", "live", "done", "cancelled"]).optional(),
        gamePlan: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { session, sb, userId } = await reachSession(context, data.sessionId);
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
  });

/** Commitments: add one, mark it done or dropped, or edit it. */
export const commitmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: uuid,
        id: uuid.nullable().optional(),
        owner: z.enum(["coach", "athlete"]).optional(),
        text: z.string().trim().min(2).max(400).optional(),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        status: z.enum(["open", "done", "dropped"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { session, sb } = await reachSession(context, data.sessionId);
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
    if (data.status) {
      patch.status = data.status;
      patch.closed_at = data.status === "open" ? null : new Date().toISOString();
    }
    const { error } = await sb.from("coaching_session_commitments").update(patch).eq("id", data.id).eq("client_id", session.client_id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

/** Send the shared game plan to the athlete, only on the coach's tap, once. */
export const sendSessionSummaryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid, text: z.string().trim().min(10).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { session, sb, userId } = await reachSession(context, data.sessionId);
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
        attachments: [{ kind: "coaching_session_summary", session_id: session.id }],
      })
      .select("id")
      .single();
    if (error) {
      await sb.from("coaching_sessions").update({ shared_at: null }).eq("id", session.id);
      throw new Error(error.message);
    }
    await sb.from("coaching_sessions").update({ shared_message_id: msg.id }).eq("id", session.id);
    const { logSessionEvent } = await import("./sessions.server");
    await logSessionEvent(sb, { sessionId: session.id, clientId: session.client_id, actorId: userId, actor: "coach", action: "summary_sent", detail: { message_id: msg.id } });
    return { messageId: msg.id as string, already: false };
  });

/**
 * The shared screen's data: only what the athlete may see (presentation.ts
 * athleteView), never the coach's notes, priorities, Cleo's reads or earlier
 * follow-ups, so nothing private is even in the shared window's page.
 */
export const getPresentationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { session, supabase } = await reachSession(context, data.sessionId);
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
  });
