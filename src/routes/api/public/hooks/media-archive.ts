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
        const key = request.headers.get("apikey") ?? request.headers.get("x-apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!expected || key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
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