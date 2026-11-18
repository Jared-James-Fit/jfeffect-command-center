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
        // Cleo's brain, the same path answerSummer takes: each model on her route (the OpenAI key by
        // default), the AI SDK, one tool call, then an answer.
        const cleoRuns: Array<{ model: string; ok: boolean; ms: number; steps?: number; text?: string; error?: string }> = [];
        {
          const { cleoRoute, cleoModel } = await import("@/lib/cleo-model.server");
          const { readRouteOverride } = await import("@/lib/ai/route-call.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const route = cleoRoute(await readRouteOverride(supabaseAdmin));
          const { generateText, stepCountIs, tool } = await import("ai");
          const { z } = await import("zod");
          for (const ref of route.models) {
            const started = Date.now();
            try {
              const m = await cleoModel(ref, { effort: route.effort, userId: "health-check" });
              const r = await generateText({
                model: m.model,
                system: "Use the tool to answer.",
                messages: [{ role: "user", content: "What is the client's bodyweight? Use body_weight." }],
                tools: { body_weight: tool({ description: "The client's latest bodyweight.", inputSchema: z.object({}), strict: false, execute: async () => "181 lb" }) },
                stopWhen: stepCountIs(3),
                abortSignal: AbortSignal.timeout(45_000),
                ...(m.providerOptions ? { providerOptions: m.providerOptions } : {}),
              });
              cleoRuns.push({ model: ref, ok: /181/.test(r.text), ms: Date.now() - started, steps: r.steps.length, text: r.text.slice(0, 160) });
            } catch (e: any) {
              cleoRuns.push({ model: ref, ok: false, ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 300) });
            }
          }
        }
        // Which attachment formats each model takes (images, PDFs, video).
        let attachments: unknown = null;
        if (key && new URL(request.url).searchParams.get("attachments") === "1") {
          const { probeAttachmentFormats } = await import("@/lib/cleo-attachment-probe.server");
          attachments = await probeAttachmentFormats(key);
        }
        // Google's voices, each model on its own (Cleo's voice tries them first).
        let speech: unknown = null;
        if (key && new URL(request.url).searchParams.get("speech") === "1") {
          const { probeGeminiVoices } = await import("@/lib/summer.server");
          speech = await probeGeminiVoices();
        }
        return Response.json({ ok: attempts.some((a) => a.ok), attempts, gatewayModels, cleoRuns, attachments, speech });
      },
    },
  },
});
