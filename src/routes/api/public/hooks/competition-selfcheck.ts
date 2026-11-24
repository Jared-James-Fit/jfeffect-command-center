import { createFileRoute } from "@tanstack/react-router";

/**
 * Competition Intelligence's production self-check (the cron hook secret only),
 * like plan-lifecycle-check: it drives the real server code end to end on an
 * internal test competition (competitions.internal_test, on a staff member's
 * own linked athlete account; release() refuses anyone else), so the lifecycle
 * can be proved in production without anyone's login:
 *
 *  { "research": "<competition id>" }   the field from the rankings, the class question
 *  { "lifecycle": "<assessment id>" }   opened → reviewed → approved → released
 *                                        → released again (no second message) →
 *                                        the athlete opens it → acknowledges it
 *  { "revise": "<assessment id>", "note": "..." }  the coach asks for changes:
 *                                        a new version is written by the worker
 *  { "decide": "<assessment id>", "proposal": "P1", "use": "engine" | "cleo" }
 *
 * Every step is the same function the app's buttons call; each event is marked
 * `selfcheck` in the competition's record.
 */
export const Route = createFileRoute("/api/public/hooks/competition-selfcheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        let body: any = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const uuid = /^[0-9a-f-]{36}$/i;
        const testCompetition = async (competitionId: string) => {
          const { data } = await sb
            .from("competitions")
            .select("id, client_id, internal_test, created_by")
            .eq("id", competitionId)
            .maybeSingle();
          if (!data?.internal_test) throw new Error("Only an internal test competition");
          return data as { id: string; client_id: string; created_by: string | null };
        };
        const ofAssessment = async (id: string) => {
          const { data } = await sb
            .from("competition_assessments")
            .select("id, competition_id")
            .eq("id", id)
            .maybeSingle();
          if (!data) throw new Error("Assessment not found");
          return testCompetition((data as any).competition_id);
        };
        const snapshot = async (id: string) =>
          (
            await sb
              .from("competition_assessments")
              .select(
                "id, kind, version, status, coach_opened_at, reviewed_at, approved_at, released_at, release_kind, message_id, athlete_delivered_at, athlete_opened_at, athlete_acknowledged_at, superseded_at, superseded_by",
              )
              .eq("id", id)
              .maybeSingle()
          ).data;
        try {
          if (typeof body.research === "string" && uuid.test(body.research)) {
            const comp = await testCompetition(body.research);
            const { discoverField } = await import("@/lib/competition/research.server");
            const field = await discoverField(sb, comp.id, { budget: { left: 14 } });
            return Response.json({ ok: true, field });
          }
          if (typeof body.lifecycle === "string" && uuid.test(body.lifecycle)) {
            const comp = await ofAssessment(body.lifecycle);
            const coach = comp.created_by;
            if (!coach) throw new Error("The test competition needs created_by (the coach)");
            const r = await import("@/lib/competition/release.server");
            const steps: Array<{ step: string; state: unknown }> = [];
            await r.markOpened(sb, body.lifecycle, coach);
            steps.push({ step: "coach opened", state: await snapshot(body.lifecycle) });
            await r.markReviewed(sb, body.lifecycle, coach);
            steps.push({ step: "coach reviewed", state: await snapshot(body.lifecycle) });
            await r.approve(sb, body.lifecycle, coach);
            steps.push({ step: "approved", state: await snapshot(body.lifecycle) });
            await r.release(sb, body.lifecycle, { userId: coach, kind: "approved" });
            const first = await snapshot(body.lifecycle);
            steps.push({ step: "released", state: first });
            await r.release(sb, body.lifecycle, { userId: coach, kind: "approved" });
            const again = await snapshot(body.lifecycle);
            const { count } = await sb
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("client_id", comp.client_id)
              .contains(
                "attachments",
                JSON.stringify([{ kind: "competition_update", assessment_id: body.lifecycle }]),
              );
            steps.push({
              step: "released again",
              state: { same_message: again?.message_id === first?.message_id, messages: count },
            });
            const { data: client } = await sb
              .from("clients")
              .select("user_id")
              .eq("id", comp.client_id)
              .maybeSingle();
            await r.athleteMark(sb, body.lifecycle, comp.client_id, (client as any)?.user_id, "opened");
            steps.push({ step: "athlete opened", state: await snapshot(body.lifecycle) });
            await r.athleteMark(
              sb,
              body.lifecycle,
              comp.client_id,
              (client as any)?.user_id,
              "acknowledged",
            );
            steps.push({ step: "athlete acknowledged", state: await snapshot(body.lifecycle) });
            await r.logEvent(sb, {
              competitionId: comp.id,
              clientId: comp.client_id,
              assessmentId: body.lifecycle,
              actor: "system",
              action: "selfcheck",
              detail: { selfcheck: true, steps: steps.map((s) => s.step) },
            });
            return Response.json({ ok: true, steps });
          }
          if (typeof body.revise === "string" && uuid.test(body.revise)) {
            const comp = await ofAssessment(body.revise);
            const r = await import("@/lib/competition/release.server");
            await r.requestChanges(
              sb,
              body.revise,
              comp.created_by!,
              typeof body.note === "string" ? body.note.slice(0, 2000) : null,
            );
            return Response.json({ ok: true, state: await snapshot(body.revise) });
          }
          if (typeof body.decide === "string" && uuid.test(body.decide)) {
            const comp = await ofAssessment(body.decide);
            const r = await import("@/lib/competition/release.server");
            const out = await r.decideProposal(
              sb,
              body.decide,
              comp.created_by!,
              String(body.proposal ?? ""),
              body.use === "engine" ? "engine" : "cleo",
            );
            return Response.json({ ok: true, ...out });
          }
          return Response.json({ ok: false, error: "Nothing to do" }, { status: 400 });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
