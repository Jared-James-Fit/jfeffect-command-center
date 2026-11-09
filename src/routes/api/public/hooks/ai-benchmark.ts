import { createFileRoute } from "@tanstack/react-router";

/**
 * Model benchmark runs (cron hook secret only): queues Generate Next Program for a
 * client with forced models (`models`, per task) and optional setup changes, as an
 * admin. A benchmark run never writes a draft and never shows in the coach's job
 * list; its calls are logged like any other run, for comparing models on real
 * athletes (docs/AI_ARCHITECTURE.md).
 */
export const Route = createFileRoute("/api/public/hooks/ai-benchmark")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as any;
        const uuid = /^[0-9a-f-]{36}$/i;
        // re-read benchmark runs' first strategy reply with the current parser (no model call):
        // kept as result.strategyReparsed beside what the run used
        if (Array.isArray(body?.reparse)) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { parseJsonReply } = await import("@/lib/program-intel/next-program");
          const { strategySchema } = await import("@/lib/program-intel/generator-schemas");
          const db = supabaseAdmin as any;
          const out: Array<{ id: string; ok: boolean; error?: string }> = [];
          for (const id of body.reparse.filter((x: unknown) => typeof x === "string" && uuid.test(x)).slice(0, 60)) {
            const { data: job } = await db.from("program_intel_jobs").select("id, result, options").eq("id", id).maybeSingle();
            if (!job?.options?.bench) {
              out.push({ id, ok: false, error: "not a benchmark run" });
              continue;
            }
            const { data: call } = await db.from("program_intel_job_calls").select("response").eq("job_id", id).eq("stage", "strategy").eq("ok", true).order("created_at").limit(1).maybeSingle();
            const parsed = call?.response ? parseJsonReply(call.response, strategySchema) : null;
            if (!parsed?.ok) {
              out.push({ id, ok: false, error: parsed ? parsed.error : "no strategy reply" });
              continue;
            }
            const { error } = await db.from("program_intel_jobs").update({ result: { ...(job.result ?? {}), strategyReparsed: parsed.value } }).eq("id", id);
            out.push({ id, ok: !error, error: error?.message });
          }
          return Response.json({ reparsed: out });
        }
        if (!body || !uuid.test(String(body.clientId ?? "")) || !uuid.test(String(body.createdBy ?? ""))) return Response.json({ error: "clientId and createdBy are required" }, { status: 400 });
        const kind = body.kind === "generate" ? "generate" : "strategy";
        const models = typeof body.models === "object" && body.models ? body.models : null;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: admin } = await db.rpc("has_role", { _user_id: body.createdBy, _role: "admin" });
        if (!admin) return Response.json({ error: "createdBy must be an admin" }, { status: 403 });
        // the program type the generator would pick (or the one asked for)
        const { loadIntelRecords } = await import("@/lib/program-intel/load");
        const { buildGeneratorIntel } = await import("@/lib/program-intel/intelligence");
        const { benchRecords } = await import("@/lib/program-intel/bench");
        const benchJob = { options: { bench: true, benchMeet: body.benchMeet, benchGoal: body.benchGoal } };
        const intel = buildGeneratorIntel(benchRecords(await loadIntelRecords(db, body.clientId, { kind: "history" }), benchJob));
        const brain = typeof body.brain === "string" ? body.brain : intel.brain;
        const options: Record<string, unknown> = { bench: true, label: String(body.label ?? "").slice(0, 120), models, setupPatch: body.setupPatch ?? null, skipReview: !!body.skipReview };
        if (body.strategy) options.strategy = body.strategy;
        if (body.benchMeet) options.benchMeet = body.benchMeet;
        if (body.effort && typeof body.effort === "object") options.effort = body.effort;
        if (body.benchGoal) options.benchGoal = body.benchGoal;
        const { data, error } = await db
          .from("program_intel_jobs")
          .insert({ client_id: body.clientId, kind, status: "pending", scope: { kind: "history" }, brain, options, created_by: body.createdBy })
          .select("id")
          .single();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ jobId: data.id });
      },
    },
  },
});
