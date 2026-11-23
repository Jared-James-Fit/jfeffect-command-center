/**
 * Which model is Cleo's brain for one answer, and how it's called (Nov 18 2026).
 *
 * Cleo's models are the routing table's `assistant` route (src/lib/ai/routing.ts), with the admin's
 * override (app_settings.ai_routes) honoured like every other route:
 *   "openai:gpt-5.5"   the OpenAI key, Responses API: the model's reasoning is carried from one
 *                      look-up to the next (encrypted, nothing stored on OpenAI's side), and the
 *                      prompt is cached per person (promptCacheKey) so a follow-up starts faster;
 *   "gateway:…"        the Lovable gateway's chat completions (Lovable credits), only when an admin
 *                      names one. Its provider is called "google" so Gemini 3's thought signature is
 *                      sent back on every tool step.
 * Server only.
 */
import { resolveRoute, type Route } from "@/lib/ai/routing";
import type { Effort } from "@/lib/ai/model-client.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export type CleoModel = {
  ref: string;
  model: any;
  providerOptions?: Record<string, Record<string, any>>;
};

/** Cleo's models for this answer, best first. `asked` (a benchmark) replaces the route's list. */
export function cleoRoute(override: Partial<Record<string, string[]>> | null, asked?: { models?: string[]; effort?: Effort } | null): Route {
  const route = resolveRoute("assistant", override as any);
  const models = asked?.models?.filter((m) => /^(openai|gateway):[\w./-]+$/.test(m)) ?? [];
  return { ...route, models: models.length ? models : route.models, effort: asked?.effort ?? route.effort };
}

/** The AI SDK model for one ref, with the options that make it fast and keep its reasoning. */
export async function cleoModel(ref: string, opts: { effort: Effort; userId: string }): Promise<CleoModel> {
  const [via, ...rest] = ref.split(":");
  const id = rest.join(":");
  if (via === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("AI is not configured (OPENAI_API_KEY missing).");
    // while OpenAI is known to be down (credits, the key), Cleo says so at once instead of waiting
    const { assertProviderUp } = await import("@/lib/ai/ai-health.server");
    await assertProviderUp("openai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI({ apiKey: key });
    const reasoning = /^(gpt-5|gpt-6|o\d)/.test(id);
    return {
      ref,
      model: openai.responses(id),
      providerOptions: {
        openai: {
          // Client data stays off OpenAI's servers, as for every call answered in a request
          // (callModelNow); the reasoning still carries across tool steps, encrypted.
          store: false,
          ...(reasoning ? { reasoningEffort: opts.effort, include: ["reasoning.encrypted_content"] } : {}),
          // The same person's questions land on the same cache, so the instructions, the tools and
          // the chat so far are read from cache on a follow-up.
          promptCacheKey: `cleo:${opts.userId}`,
          parallelToolCalls: true,
        },
      },
    };
  }
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (LOVABLE_API_KEY missing).");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const gateway = createOpenAICompatible({ name: "google", baseURL: GATEWAY, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  return { ref, model: gateway(id) };
}

/** A failed model's error in one short line, and whether the next model is worth trying. */
export function cleoFailure(e: any): { status: number | null; timedOut: boolean; retry: boolean; quota: boolean } {
  const status = e?.statusCode ?? e?.status ?? e?.lastError?.statusCode ?? null;
  const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError" || /aborted|timed? ?out/i.test(String(e?.message ?? ""));
  const text = `${e?.message ?? ""} ${e?.responseBody ?? ""} ${e?.lastError?.responseBody ?? ""}`;
  const quota = /insufficient_quota|billing/i.test(text);
  // Refused (unknown model, a tool step it won't take), rate limited, down or too slow: the next model.
  const retry = timedOut || status === 400 || status === 404 || status === 422 || status === 429 || (status != null && status >= 500 && status < 600);
  return { status, timedOut, retry: retry && !quota, quota };
}
