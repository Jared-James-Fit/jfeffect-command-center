import { createFileRoute } from "@tanstack/react-router";
import { runReminderSweep } from "@/lib/sms.functions";

export const Route = createFileRoute("/api/public/hooks/sms-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return new Response("Unauthorized", { status: 401 });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await runReminderSweep(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});

function authorizeWorker(request: Request): boolean {
  const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
  if (!expected) return false;
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-worker-secret") ?? url.searchParams.get("secret") ?? "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}