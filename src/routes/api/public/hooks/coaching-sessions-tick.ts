import { createFileRoute } from "@tanstack/react-router";

/**
 * Coaching sessions' background work (pg_cron `coaching-sessions-tick`, every
 * minute, only while coaching_sessions_due()): Cleo's pre-call briefs and the
 * reading of meeting notes and transcripts (worker.server.ts), then a raw
 * transcript past its retention date is removed from the private bucket and
 * its row says so; the structured intelligence the coach kept from it stays.
 * Cron hook secret only.
 */
export const Route = createFileRoute("/api/public/hooks/coaching-sessions-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        const { runSessionWork } = await import("@/lib/coaching-sessions/worker.server");
        const work = await runSessionWork(sb).catch((e: any) => [{ error: String(e?.message ?? e) }]);
        const removed: string[] = [];
        const { data: due } = await sb.rpc("coaching_transcripts_due");
        for (const s of (due ?? []) as any[]) {
          if (!s.transcript_path) continue;
          const { error } = await sb.storage.from("coaching-transcripts").remove([s.transcript_path]);
          if (error) continue;
          await sb
            .from("coaching_sessions")
            .update({ transcript_path: null, transcript_deleted_at: new Date().toISOString() })
            .eq("id", s.id);
          await sb.from("coaching_session_events").insert({
            session_id: s.id,
            client_id: s.client_id,
            actor: "system",
            action: "transcript_removed",
            detail: { reason: "retention", retain_until: s.transcript_retain_until },
          });
          removed.push(s.id);
        }
        return Response.json({ ok: true, work, removed });
      },
    },
  },
});
