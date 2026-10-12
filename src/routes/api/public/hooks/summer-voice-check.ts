import { createFileRoute } from "@tanstack/react-router";
import { authorizeHookRequest } from "@/lib/hook-auth.server";

/**
 * Health check for Cleo's voice: tries every text-to-speech provider with a
 * short sample and reports which ones answer. Auth is the same as the
 * scheduled hooks (x-hook-secret from Vault, or x-worker-secret), so it can be
 * run from the database with net.http_post.
 */
export const Route = createFileRoute("/api/public/hooks/summer-voice-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeHookRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { probeSpeechProviders } = await import("@/lib/summer.server");
        const attempts = await probeSpeechProviders();
        // Which models the AI gateway accepts (its "invalid model" reply lists them).
        let gatewayModels: string | null = null;
        const key = process.env.LOVABLE_API_KEY;
        if (key) {
          try {
            const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
              body: JSON.stringify({ model: "list/models", messages: [{ role: "user", content: "hi" }] }),
            });
            gatewayModels = (await res.text()).slice(0, 4000);
          } catch (e: any) {
            gatewayModels = String(e?.message ?? e).slice(0, 200);
          }
        }
        return Response.json({ ok: attempts.some((a) => a.ok), attempts, gatewayModels });
      },
    },
  },
});
