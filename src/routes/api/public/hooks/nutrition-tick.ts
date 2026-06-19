import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/nutrition-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: targets } = await supabaseAdmin
          .from("nutrition_targets")
          .select("id")
          .neq("status", "Archived");
        let processed = 0;
        for (const t of targets ?? []) {
          await supabaseAdmin.rpc("fn_recompute_nutrition_status", { _target_id: t.id });
          processed++;
        }
        return Response.json({ ok: true, processed });
      },
    },
  },
});

function authorizeWorker(request: Request): boolean {
  const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
  if (!expected) return false;
  const provided = request.headers.get("x-worker-secret") ?? "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}