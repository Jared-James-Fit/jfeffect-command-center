import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * pg_cron-triggered tick that copies any pending lift videos from primary
 * storage (Supabase Storage) into Google Drive as an archive. Public route
 * so pg_cron can hit it; gated by the project anon `apikey` header per the
 * documented scheduled-jobs pattern.
 */
export const Route = createFileRoute("/api/public/hooks/lift-archive-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return json({ error: "Unauthorized" }, { status: 401 });
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