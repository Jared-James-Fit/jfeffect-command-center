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
        // Can Cleo's models take a tool-calling chat request? (What answerSummer sends.)
        const chatModels: Array<{ model: string; api: string; status: number; detail: string }> = [];
        if (key) {
          const { CLEO_PRIMARY_MODEL } = await import("@/lib/summer.server");
          const tools = [{ type: "function", function: { name: "lookup", description: "Look something up.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } }];
          for (const model of [process.env.CLEO_AI_MODEL || CLEO_PRIMARY_MODEL]) {
            try {
              const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
                body: JSON.stringify({ model, max_tokens: 40, tools, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Say hi." }] }),
              });
              chatModels.push({ model, api: "chat", status: res.status, detail: (await res.text()).slice(0, 240) });
            } catch (e: any) {
              chatModels.push({ model, api: "chat", status: 0, detail: String(e?.message ?? e).slice(0, 200) });
            }
          }
        }
        // The same path answerSummer takes: the AI SDK, a tool call, then an answer.
        let cleoRun: { model: string; ok: boolean; steps?: number; text?: string; error?: string } | null = null;
        if (key) {
          const { CLEO_PRIMARY_MODEL } = await import("@/lib/summer.server");
          const model = process.env.CLEO_AI_MODEL || CLEO_PRIMARY_MODEL;
          try {
            const { generateText, stepCountIs, tool } = await import("ai");
            const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
            const { z } = await import("zod");
            const gateway = createOpenAICompatible({ name: "google", baseURL: "https://ai.gateway.lovable.dev/v1", headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
            const r = await generateText({
              model: gateway(model),
              system: "Use the tool to answer.",
              messages: [{ role: "user", content: "What is the client's bodyweight? Use body_weight." }],
              tools: { body_weight: tool({ description: "The client's latest bodyweight.", inputSchema: z.object({}), execute: async () => "181 lb" }) },
              stopWhen: stepCountIs(3),
              abortSignal: AbortSignal.timeout(45_000),
            });
            cleoRun = { model, ok: /181/.test(r.text), steps: r.steps.length, text: r.text.slice(0, 160) };
          } catch (e: any) {
            cleoRun = { model, ok: false, error: String(e?.message ?? e).slice(0, 300) };
          }
        }
        // Which attachment formats each model takes (images, PDFs, video).
        let attachments: unknown = null;
        if (key && new URL(request.url).searchParams.get("attachments") === "1") {
          const { probeAttachmentFormats } = await import("@/lib/cleo-attachment-probe.server");
          attachments = await probeAttachmentFormats(key);
        }
        // Gemini voices through the speech endpoint (the chat endpoint refuses TTS models).
        let speech: unknown = null;
        if (key && new URL(request.url).searchParams.get("speech") === "1") {
          const sample = "Hi, it's Cleo. You've got two check-ins waiting, and Marc hit a new squat PR.";
          const tries: Array<{ model: string; voice: string; format: string }> = [
            { model: "google/gemini-3.1-flash-tts-preview", voice: "Despina", format: "mp3" },
            { model: "google/gemini-2.5-flash-tts", voice: "Despina", format: "mp3" },
            { model: "google/gemini-2.5-pro-tts", voice: "Despina", format: "mp3" },
            { model: "google/gemini-2.5-flash-tts", voice: "Despina", format: "wav" },
            { model: "openai/gpt-4o-mini-tts", voice: "marin", format: "mp3" },
          ];
          speech = await Promise.all(
            tries.map(async (t) => {
              const started = Date.now();
              try {
                const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
                  body: JSON.stringify({ model: t.model, voice: t.voice, input: sample, response_format: t.format }),
                  signal: AbortSignal.timeout(45_000),
                });
                const type = res.headers.get("content-type") ?? "";
                const bytes = type.startsWith("audio") ? (await res.arrayBuffer()).byteLength : 0;
                const detail = bytes ? "" : (await res.text().catch(() => "")).slice(0, 240);
                return { ...t, status: res.status, type, bytes, ms: Date.now() - started, detail };
              } catch (e: any) {
                return { ...t, status: 0, type: "", bytes: 0, ms: Date.now() - started, detail: String(e?.message ?? e).slice(0, 200) };
              }
            }),
          );
        }
        return Response.json({ ok: attempts.some((a) => a.ok), attempts, gatewayModels, chatModels, cleoRun, attachments, speech });
      },
    },
  },
});
