import { createFileRoute } from "@tanstack/react-router";

/**
 * Which AI models this deployment can reach, checked live (checkModels in
 * src/lib/ai/model-check.server.ts). Called by the database (the cron hook
 * secret) and by the admin AI panel's "Check now"; the last result is kept in
 * app_settings.ai_models_check for the panel.
 */
export const Route = createFileRoute("/api/public/hooks/ai-models-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let probe = true;
        let extra: string[] = [];
        try {
          const body = (await request.json()) as { probe?: unknown; extra?: unknown };
          if (body?.probe === false) probe = false;
          if (Array.isArray(body?.extra)) extra = body.extra.filter((m): m is string => typeof m === "string" && /^[\w./:-]{2,80}$/.test(m)).slice(0, 8);
        } catch {
          // no body: a full check
        }
        const { checkModels } = await import("@/lib/ai/model-check.server");
        const { saveModelCheck } = await import("@/lib/ai/model-status.server");
        try {
          const result = await checkModels({ probe, extra });
          await saveModelCheck(result);
          return Response.json(result);
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
