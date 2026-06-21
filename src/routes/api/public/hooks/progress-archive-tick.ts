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
        if (!authorizeWorker(request)) return json({ error: "Unauthorized" }, { status: 401 });
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

function authorizeWorker(request: Request): boolean {
  const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
  if (!expected) return false;
  const provided =
    request.headers.get("x-worker-secret") ?? "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}