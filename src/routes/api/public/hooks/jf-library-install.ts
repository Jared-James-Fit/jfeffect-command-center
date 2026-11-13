import { createFileRoute } from "@tanstack/react-router";

/**
 * Adds the 12 JF Effect library programs (src/lib/jf-programs) to the program
 * library: a preview unless the body says { "apply": true }, and then only
 * what's missing (fixed ids, never an update). Called from the database with
 * the vault's cron_hook_secret. See installJfLibrary.
 */
export const Route = createFileRoute("/api/public/hooks/jf-library-install")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = await request.json().catch(() => ({}));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { installJfLibrary } = await import("@/lib/jf-programs/install.server");
        try {
          return Response.json(await installJfLibrary(supabaseAdmin, { apply: body?.apply === true }));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
