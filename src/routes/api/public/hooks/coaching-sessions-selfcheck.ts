import { createFileRoute } from "@tanstack/react-router";

/**
 * Coaching sessions' production self-check (the cron hook secret only), like
 * competition-selfcheck: it drives the same operations the app's buttons call
 * (sessions.ops.server.ts) on a staff member's own linked athlete account only,
 * so the lifecycle can be proved in production without anyone's login and
 * without touching a real client:
 *
 *  { "client": id, "prepare": {...} }            prepare (optionally with a synthetic "event")
 *  { "session": id, "read": true }               the coach opening it (prep, questions preview)
 *  { "session": id, "questions": true }          send the pre-call questions
 *  { "session": id, "answers": { key: text } }   the athlete answering them
 *  { "session": id, "notes": "...", "decisions": [...] }
 *  { "session": id, "transcript": {...} }        import notes or an Otter transcript
 *  { "work": true }                              one run of the background worker
 *  { "recommendation": id, "decide": status }    a decision
 *  { "client": id, "intel": {...} }              keep / edit / remove intelligence
 *  { "session": id, "commitment": {...} }
 *  { "session": id, "summary": "..." }           send the game plan
 *  { "session": id, "deleteTranscript": "none" | "unkept" | "all" }
 *  { "session": id, "expire": true }             retention date in the past (the tick removes it)
 *  { "client": id, "intelText": true }           what Cleo's other work now reads
 *  { "session": id, "presentation": true }       what the shared screen gets
 */
export const Route = createFileRoute("/api/public/hooks/coaching-sessions-selfcheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        let body: any = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const ops = await import("@/lib/coaching-sessions/sessions.ops.server");

        /** The client must be a staff member's own linked athlete account; the coach is that staff login. */
        const testClient = async (clientId: string) => {
          const { data: c } = await sb.from("clients").select("id, user_id").eq("id", clientId).maybeSingle();
          if (!c?.user_id) throw new Error("No such client");
          const { data: link } = await sb.from("community_profiles").select("user_id").eq("same_person_as", c.user_id).limit(1);
          const staff = link?.[0]?.user_id;
          if (!staff) throw new Error("Only a staff member's own linked athlete account");
          return { clientId: c.id as string, coach: staff as string, athlete: c.user_id as string };
        };
        const ofSession = async (id: string) => {
          const { data } = await sb.from("coaching_sessions").select("id, client_id").eq("id", id).maybeSingle();
          if (!data) throw new Error("Session not found");
          return testClient(data.client_id);
        };
        const caller = (coach: string) => ({ supabase: sb, userId: coach, trusted: true, cleo: true });

        try {
          if (body.work) {
            const { runSessionWork } = await import("@/lib/coaching-sessions/worker.server");
            return Response.json({ ok: true, work: await runSessionWork(sb) });
          }
          if (body.client && body.prepare) {
            const t = await testClient(body.client);
            const c = caller(t.coach);
            const p = body.prepare;
            if (p.event) {
              // a synthetic event (a test scenario), prepared exactly as a detected one would be
              const { loadSessionContext, prepareFor, logSessionEvent } = await import("@/lib/coaching-sessions/sessions.server");
              const ctx = await loadSessionContext(sb, t.clientId, { includeTests: true });
              const event = { conflicts: [], source: "Test scenario", competitionId: null, weightClass: null, location: null, ...p.event };
              const prepared = await prepareFor(sb, ctx, { event, coachNotes: p.coachNotes ?? null, priorities: p.priorities ?? [], minutes: p.minutes ?? null });
              const { data: row, error } = await sb
                .from("coaching_sessions")
                .insert({
                  client_id: t.clientId,
                  coach_user_id: t.coach,
                  event,
                  format: p.format ?? "call",
                  status: p.format === "retrospective" ? "done" : "ready",
                  minutes: prepared.agenda.minutes,
                  coach_notes: p.coachNotes ?? null,
                  coach_priorities: p.priorities ?? [],
                  prep: prepared.prep,
                  agenda: prepared.agenda,
                  live: { selfcheck: true },
                  write_up_status: p.format === "retrospective" ? "none" : "queued",
                  created_by: t.coach,
                })
                .select("id")
                .single();
              if (error) throw new Error(error.message);
              await logSessionEvent(sb, { sessionId: row.id, clientId: t.clientId, actorId: t.coach, actor: "coach", action: "prepared", detail: { selfcheck: true, event: event.key ?? null } });
              return Response.json({ ok: true, id: row.id, intervention: prepared.intervention, agenda: prepared.agenda });
            }
            const r = await ops.prepareSession(c, { ...p, clientId: t.clientId, priorities: p.priorities ?? [], format: p.format ?? "call" });
            return Response.json({ ok: true, ...r });
          }
          if (body.client && body.home) {
            const t = await testClient(body.client);
            return Response.json({ ok: true, home: await ops.getSessionsHome(caller(t.coach), { clientId: t.clientId }) });
          }
          if (body.recommendation && body.decide) {
            const { data: r } = await sb.from("coaching_session_recommendations").select("session_id").eq("id", body.recommendation).maybeSingle();
            if (!r) throw new Error("Recommendation not found");
            const t = await ofSession(r.session_id);
            return Response.json({ ok: true, ...(await ops.decideRecommendation(caller(t.coach), { id: body.recommendation, status: body.decide, note: body.note ?? null, proposed: body.proposed ?? null })) });
          }
          if (body.client && body.intel) {
            const t = await testClient(body.client);
            return Response.json({ ok: true, ...(await ops.intelligence(caller(t.coach), { clientId: t.clientId, ...body.intel })) });
          }
          if (body.client && body.intelText) {
            const t = await testClient(body.client);
            const [{ loadWeightManagement }, { clientIntelText }] = await Promise.all([import("@/lib/weight-management/load.server"), import("@/lib/client-intel/brief.server")]);
            const loaded = await loadWeightManagement(sb, t.clientId);
            const text = await clientIntelText(sb, { clientId: t.clientId, loaded }, "training");
            const part = (h: string) => {
              const i = text.indexOf(h);
              if (i < 0) return null;
              const j = text.indexOf("\n\n", i);
              return text.slice(i, j < 0 ? undefined : j);
            };
            return Response.json({ ok: true, conversations: part("FROM COACHING CONVERSATIONS"), history: part("DECISION HISTORY") });
          }
          if (!body.session) return Response.json({ ok: false, error: "Nothing to do" }, { status: 400 });
          const t = await ofSession(body.session);
          const c = caller(t.coach);
          const sessionId = body.session;
          if (body.read) return Response.json({ ok: true, ...(await ops.getSession(c, { sessionId, refresh: body.refresh !== false })) });
          if (body.questions) return Response.json({ ok: true, ...(await ops.sendSessionQuestions(c, { sessionId, note: body.note ?? null })) });
          if (body.answers) {
            // the athlete answering, as the form would save it: one submission, answers by session key
            const { PRE_CALL_FORM_ID } = await import("@/lib/coaching-sessions/questionnaire");
            const { data: qs } = await sb.from("nf_questions").select("id, validation").eq("form_id", PRE_CALL_FORM_ID);
            const now = new Date().toISOString();
            const { data: sub, error } = await sb
              .from("nf_submissions")
              .insert({ form_id: PRE_CALL_FORM_ID, client_id: t.clientId, status: "pending_review", started_at: now, submitted_at: now })
              .select("id")
              .single();
            if (error) throw new Error(error.message);
            const rows = ((qs ?? []) as any[])
              .filter((q) => body.answers[q.validation?.session_key])
              .map((q) => ({ submission_id: sub.id, question_id: q.id, value_text: String(body.answers[q.validation.session_key]) }));
            if (rows.length) {
              const { error: aErr } = await sb.from("nf_answers").insert(rows);
              if (aErr) throw new Error(aErr.message);
            }
            return Response.json({ ok: true, submission: sub.id, answers: rows.length });
          }
          if (body.notes != null || body.decisions) {
            return Response.json({ ...(await ops.updateSession(c, { sessionId, live: { ...(body.notes != null ? { notes: body.notes } : {}), ...(body.decisions ? { decisions: body.decisions } : {}) }, ...(body.status ? { status: body.status } : {}) })), ok: true });
          }
          if (body.transcript) return Response.json({ ok: true, ...(await ops.importTranscript(c, { sessionId, ...body.transcript })) });
          if (body.analyseNotes) return Response.json({ ok: true, ...(await ops.analyseNotes(c, { sessionId })) });
          if (body.commitment) return Response.json({ ok: true, ...(await ops.commitment(c, { sessionId, ...body.commitment })) });
          if (body.summary) return Response.json({ ok: true, ...(await ops.sendSessionSummary(c, { sessionId, text: body.summary })) });
          if (body.deleteTranscript) return Response.json({ ...(await ops.deleteTranscript(c, { sessionId, derived: body.deleteTranscript })), ok: true });
          if (body.presentation) return Response.json({ ok: true, ...(await ops.getPresentation(c, { sessionId })) });
          if (body.expire) {
            await sb.from("coaching_sessions").update({ transcript_retain_until: "2026-01-01" }).eq("id", sessionId);
            return Response.json({ ok: true });
          }
          return Response.json({ ok: false, error: "Nothing to do" }, { status: 400 });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
