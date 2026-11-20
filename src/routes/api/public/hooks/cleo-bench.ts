import { createFileRoute } from "@tanstack/react-router";

/**
 * Cleo benchmark (cron hook secret only, Nov 18 2026): one question answered by Cleo's real answer
 * path (cleoAnswer: the same context, tools, cards and models), as the business owner, with the
 * models, effort and tone given. Nothing is saved: no chat or message is written, and any card Cleo set up
 * is deleted before this answers (its summary comes back so the answer can be judged). For picking
 * Cleo's route's models and effort on real data (docs/AI_ARCHITECTURE.md). One answer per request,
 * so no request runs long.
 */
export const Route = createFileRoute("/api/public/hooks/cleo-bench")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as any;
        const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
        if (!message) return Response.json({ ok: false, error: "message required" }, { status: 400 });
        const models = Array.isArray(body?.models) ? body.models.filter((m: unknown) => typeof m === "string" && /^(openai|gateway):[\w./-]+$/.test(m)).slice(0, 3) : [];
        // The benchmark never spends Lovable credits by itself.
        if (models.some((m: string) => m.startsWith("gateway:")) && body?.allowGateway !== true) return Response.json({ ok: false, error: "gateway models need allowGateway" }, { status: 400 });
        const effort = ["low", "medium", "high"].includes(body?.effort) ? body.effort : undefined;
        // A tone for this answer only (the owner's saved choice is never changed).
        const { isSummerTone } = await import("@/lib/summer-persona");
        const tone = isSummerTone(body?.tone) ? body.tone : undefined;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: owner } = await db.from("business_owners").select("user_id").limit(1).maybeSingle();
        if (!owner?.user_id) return Response.json({ ok: false, error: "no business owner" }, { status: 500 });
        const { cleoAnswer } = await import("@/lib/summer.server");
        const { discardProposals } = await import("@/lib/cleo-actions.server");
        const started = Date.now();
        try {
          const r = await cleoAnswer(db, owner.user_id, { message, voice: body?.voice === true, own: db }, { bench: { models: models.length ? models : undefined, effort, tone } });
          const { data: cards } = r.proposed.length ? await db.from("cleo_actions").select("kind, summary, params").in("id", r.proposed) : { data: [] };
          await discardProposals(owner.user_id, r.proposed);
          return Response.json({ ok: true, ms: Date.now() - started, text: r.text, choices: r.choices, cards, trace: r.trace });
        } catch (e: any) {
          return Response.json({ ok: false, ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 500) }, { status: 200 });
        }
      },
    },
  },
});
