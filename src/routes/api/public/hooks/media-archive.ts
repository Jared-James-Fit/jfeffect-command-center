import { createFileRoute } from "@tanstack/react-router";
import { runAutoArchiveInternal } from "@/lib/media-archive.functions";

// Cron entry point — pg_cron POSTs here daily with the Vault-held cron secret
// as `x-hook-secret` (or the worker secret as `x-worker-secret`). The
// /api/public/* prefix bypasses Lovable's published-site auth wall, so the
// shared hook auth is what stops drive-by triggers.
export const Route = createFileRoute("/api/public/hooks/media-archive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeWorker(request))) return new Response("Unauthorized", { status: 401 });
        try {
          const result = await runAutoArchiveInternal();
          return Response.json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[cron.media-archive]", err);
          return Response.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
        }
      },
    },
  },
});

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}
