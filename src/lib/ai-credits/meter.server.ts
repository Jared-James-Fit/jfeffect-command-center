/**
 * Metering an AI feature for the person who asked (server only).
 *
 *   const r = await withAiCredits(userId, "meal_estimate", async () => {
 *     const reply = await callModelNow(...);
 *     return { value: parse(reply.text), model: reply.model, usage: reply.usage };
 *   });
 *   if (!r.ok) return { outOfCredits: true, credits: r.credits };
 *
 * The credits are taken before the model is called (so two taps at once
 * can't both run on the last credit) and given back if the call throws, a
 * failed or unreadable answer included. The model, tokens and estimated
 * cost are kept on the use, so the coach sees what the AI really costs.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { estimateCost, type ModelUsage } from "@/lib/ai/model-client.server";
import type { AiFeature, CreditState } from "./packs";

type Run<T> = () => Promise<{ value: T; model?: string | null; usage?: ModelUsage | null }>;

export type MeteredResult<T> =
  | { ok: true; value: T; credits: CreditState }
  | { ok: false; reason: "out_of_credits"; credits: CreditState };

async function settle(
  useId: string,
  ok: boolean,
  model?: string | null,
  usage?: ModelUsage | null,
): Promise<CreditState | null> {
  const input = usage?.input ?? null;
  const output = usage?.output ?? null;
  const cost = model ? estimateCost(model, input, output) : null;
  const { data, error } = await (supabaseAdmin as any).rpc("ai_credits_settle", {
    _use_id: useId,
    _ok: ok,
    _model: model ?? null,
    _input_tokens: input,
    _output_tokens: output,
    _cost_usd: cost,
  });
  if (error) {
    console.error("[ai-credits] settle failed", { useId, ok, message: error.message });
    return null;
  }
  return (data ?? null) as CreditState | null;
}

/** Errors a failed call carries back: the model that was tried, when there was one. */
export class MeteredCallError extends Error {
  constructor(
    message: string,
    public model?: string | null,
    public usage?: ModelUsage | null,
  ) {
    super(message);
  }
}

export async function withAiCredits<T>(
  userId: string,
  feature: AiFeature,
  run: Run<T>,
  ref?: string,
): Promise<MeteredResult<T>> {
  const { data, error } = await (supabaseAdmin as any).rpc("ai_credits_use", {
    _user: userId,
    _feature: feature,
    _ref: ref ?? null,
  });
  if (error) throw new Error(`Couldn't check your AI credits: ${error.message}`);
  if (!data?.ok)
    return { ok: false, reason: "out_of_credits", credits: data?.state as CreditState };
  const useId = String(data.use_id);
  let result: Awaited<ReturnType<Run<T>>>;
  try {
    result = await run();
  } catch (e) {
    const err = e as MeteredCallError;
    await settle(useId, false, err?.model ?? null, err?.usage ?? null);
    throw e;
  }
  const after = await settle(useId, true, result.model, result.usage);
  return { ok: true, value: result.value, credits: after ?? (data.state as CreditState) };
}

/** A person's credits as the app shows them, read as the server (for a reply that carries them). */
export async function creditStateFor(userId: string): Promise<CreditState | null> {
  const { data, error } = await (supabaseAdmin as any).rpc("ai_credit_state", { _user: userId });
  if (error) return null;
  return (data ?? null) as CreditState | null;
}
