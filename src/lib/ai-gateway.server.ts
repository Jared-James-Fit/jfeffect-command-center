import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Minimal Lovable AI Gateway provider for app-internal server fns.
 *
 * Streaming chat routes should use the fuller helper with run-id forwarding
 * (see knowledge://ai-sdk-lovable-gateway). For non-streaming `generateText`
 * inside `createServerFn` handlers, this lightweight version is sufficient.
 *
 * Server-only: imports `process.env.LOVABLE_API_KEY`. Never import this
 * module from `*.functions.ts` at module scope — require it inside the
 * handler so it never ships to client bundles.
 */

export function createLovableAiGateway(): ReturnType<typeof createOpenAICompatible> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    throw new Error(
      "LOVABLE_API_KEY is not configured. The AI gateway cannot be reached.",
    );
  }
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

/** Default chat/text model. Override by passing `model` to a server fn. */
export const DEFAULT_AI_MODEL = "google/gemini-3-flash-preview";