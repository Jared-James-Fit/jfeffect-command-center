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
 * Nothing runs without the person's permission to send their data to AI
 * services (requireOwnAiConsent, src/lib/ai-consent): refused, it throws the
 * consent error the app turns into the question (withAiConsent).
 *
 * In the iPhone app a self-serve member spends only the month's free credits
 * (option B, native-purchases.ts): credits bought on the web are never spent
 * or shown there. Every spend goes through `spendAiCredits`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { estimateCost, type ModelUsage } from "@/lib/ai/model-client.server";
import { requireOwnAiConsent } from "@/lib/ai-consent/consent.server";
import { creditStateForShell, shellRefusesCreditSpend } from "@/lib/native-purchases";
import { digitalPaidAllowedFor } from "@/lib/native-purchases.server";
import { FEATURE_COSTS, type AiFeature, type CreditState } from "./packs";

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

type SpendReply = { ok: boolean; use_id?: string; reason?: string; state?: CreditState | null };

/**
 * Take a feature's credits (`ai_credits_use`), as the RPC answers. In the
 * iPhone app, for a self-serve member (option B), only the month's free
 * credits: refused when they don't cover it, and a use that dipped into bought
 * credits anyway (two at once on the last free one) is given back and refused.
 * The state it carries is the one the app may show (`creditStateForShell`).
 */
export async function spendAiCredits(
  userId: string,
  feature: AiFeature,
  ref?: string | null,
  allowedHere?: boolean,
  // `data` is the RPC's own reply (SpendReply), loosely typed like every other rpc() result
): Promise<{ data: any; error: { message: string } | null }> {
  const db = supabaseAdmin as any;
  const allowed = allowedHere ?? (await digitalPaidAllowedFor(userId));
  let before: CreditState | null = null;
  if (!allowed) {
    before = await rawState(userId);
    if (!before) return { data: null, error: { message: "couldn't read them" } };
    const cost = before?.costs?.[feature] ?? FEATURE_COSTS[feature];
    if (shellRefusesCreditSpend(before, cost, false))
      return { data: { ok: false, reason: "out_of_credits", state: creditStateForShell(before, false) }, error: null };
  }
  const { data, error } = await db.rpc("ai_credits_use", { _user: userId, _feature: feature, _ref: ref ?? null });
  if (error || allowed) return { data: (data ?? null) as SpendReply | null, error };
  const reply = (data ?? null) as SpendReply | null;
  const after = reply?.state ?? null;
  if (reply?.ok && reply.use_id && before && after && !after.unlimited && after.extra < before.extra) {
    const back = await settle(String(reply.use_id), false);
    return { data: { ok: false, reason: "out_of_credits", state: creditStateForShell(back ?? before, false) }, error: null };
  }
  return { data: reply && { ...reply, state: creditStateForShell(after, false) }, error: null };
}

export async function withAiCredits<T>(
  userId: string,
  feature: AiFeature,
  run: Run<T>,
  ref?: string,
): Promise<MeteredResult<T>> {
  // their data goes to an outside AI service: only with their permission (5.1.2(i)), before any credit is taken
  await requireOwnAiConsent(userId);
  const allowed = await digitalPaidAllowedFor(userId);
  const { data, error } = await spendAiCredits(userId, feature, ref, allowed);
  if (error) throw new Error(`Couldn't check your credits: ${error.message}`);
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
  return { ok: true, value: result.value, credits: creditStateForShell(after ?? (data.state as CreditState), allowed) };
}

async function rawState(userId: string): Promise<CreditState | null> {
  const { data, error } = await (supabaseAdmin as any).rpc("ai_credit_state", { _user: userId });
  if (error) return null;
  return (data ?? null) as CreditState | null;
}

/** A person's credits as the app shows them, read as the server (for a reply that carries them). */
export async function creditStateFor(userId: string): Promise<CreditState | null> {
  return creditStateForShell(await rawState(userId), await digitalPaidAllowedFor(userId));
}
