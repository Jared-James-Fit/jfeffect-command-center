import { createFileRoute } from "@tanstack/react-router";

/**
 * Edit with AI turns, written in the background: called by the database the
 * moment a coach asks (`program_ai_edits_queue_run`, with `{ editId }`) and
 * by pg_cron every 5 minutes (no id: the oldest waiting or cut-off turn).
 * One turn per call. See runProgramAiEdit in src/lib/program-ai/worker.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/program-ai-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let editId: string | null = null;
        try {
          const body = (await request.json()) as { editId?: unknown };
          if (typeof body?.editId === "string" && /^[0-9a-f-]{36}$/i.test(body.editId)) editId = body.editId;
        } catch {
          // no body: take the next waiting turn
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runProgramAiEdit } = await import("@/lib/program-ai/worker.server");
        try {
          return Response.json(await runProgramAiEdit(supabaseAdmin as any, editId));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
