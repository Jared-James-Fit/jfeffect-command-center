import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * pg_cron-triggered tick that copies any pending lift videos from primary
 * storage (Supabase Storage) into Google Drive as an archive. Public route
 * so pg_cron can hit it; gated by the shared hook auth (worker secret, or the
 * Vault-held cron secret the cron job sends as `x-hook-secret`).
 */
export const Route = createFileRoute("/api/public/hooks/lift-archive-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeWorker(request))) return json({ error: "Unauthorized" }, { status: 401 });
        try {
          const { runLiftArchiveTick } = await import("@/lib/lift-archive.server");
          const result = await runLiftArchiveTick(5);
          return json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[lift-archive-tick] failed", err?.message ?? err);
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
