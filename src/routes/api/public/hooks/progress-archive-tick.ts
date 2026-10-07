import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * pg_cron-triggered tick that copies any pending progress media from primary
 * storage (Supabase Storage) into Google Drive as an archive. Gated by a
 * shared `x-worker-secret` header matching SCHEDULED_WORKER_SECRET, same as
 * the lift-archive worker.
 */
export const Route = createFileRoute("/api/public/hooks/progress-archive-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeWorker(request))) return json({ error: "Unauthorized" }, { status: 401 });
        try {
          const { runProgressArchiveTick } = await import("@/lib/progress-archive.server");
          const result = await runProgressArchiveTick(5);
          return json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[progress-archive-tick] failed", err?.message ?? err);
          return json({ ok: false, error: err?.message ?? "Tick failed" }, { status: 500 });
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
