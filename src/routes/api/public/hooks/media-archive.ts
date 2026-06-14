import { createFileRoute } from "@tanstack/react-router";
import { runAutoArchiveInternal } from "@/lib/media-archive.functions";

// Cron entry point — Supabase pg_cron should POST here daily with the project
// anon key as `apikey` header. The /api/public/* prefix bypasses Lovable's
// published-site auth wall; we additionally require the anon key match to
// stop drive-by triggers.
export const Route = createFileRoute("/api/public/hooks/media-archive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return new Response("Unauthorized", { status: 401 });
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