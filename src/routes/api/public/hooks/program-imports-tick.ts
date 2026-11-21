import { createFileRoute } from "@tanstack/react-router";

/**
 * Program imports read by AI, in the background (src/lib/program-import):
 * called by the database the moment an import is queued
 * (`program_imports_queue_run` with `{ importId }`) and by pg_cron every 3
 * minutes (no id: the oldest waiting or cut-off read, else the clean-up of old
 * files and imports). One step per call. See runQueuedImport.
 */
export const Route = createFileRoute("/api/public/hooks/program-imports-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let importId: string | null = null;
        try {
          const body = (await request.json()) as { importId?: unknown };
          importId = typeof body?.importId === "string" && /^[0-9a-f-]{36}$/i.test(body.importId) ? body.importId : null;
        } catch {
          // no body: the next waiting import, else clean-up
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { runQueuedImport } = await import("@/lib/program-import/import.server");
          return Response.json(await runQueuedImport(supabaseAdmin as any, importId));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
