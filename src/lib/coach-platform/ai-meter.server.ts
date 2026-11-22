/**
 * Metering AI for a coach workspace (server only). The wrapper every AI
 * feature a workspace can reach goes through, once Phase 4 opens one:
 *
 *   const r = await withWorkspaceAi(orgId, "program_edit", { userId, clientId }, async () => {
 *     const reply = await callModel(...);
 *     return { value: parse(reply.text), model: reply.model, usage: reply.usage };
 *   });
 *   if (!r.ok) return { aiPaused: r.reason, words: r.words };
 *
 * Credits and caps are decided by ai-allowance.ts and taken atomically by
 * public.org_ai_reserve under the business's lock before the model is called;
 * the real cost is kept by org_ai_settle whatever happens (a failed call gives
 * its credits back but its cost counts against the cap). A caller check (the
 * person may use AI in this business) comes first, in the server function.
 */
import {
  type CoachAiFeature,
  COACH_AI_FEATURES,
  DEFAULT_ALLOWANCE,
  callCostMicroUsd,
  featureEstimateMicroUsd,
  monthlyCredits,
  spendCapMicroUsd,
} from "./ai-allowance";
import { rowPricing } from "./coach-billing";

type Usage = { input?: number | null; cached?: number | null; output?: number | null } | null | undefined;
type Run<T> = () => Promise<{ value: T; model?: string | null; usage?: Usage }>;

export type WorkspaceAiResult<T> =
  | { ok: true; value: T; source: string }
  | { ok: false; reason: "out_of_credits" | "monthly_cap" | "daily_cap" | "workspace_off"; words: string };

const WORDS: Record<string, string> = {
  out_of_credits: "You've used this month's AI credits. They come back at the start of next month, or add more from Billing.",
  monthly_cap: "AI is paused for this workspace until next month. Your clients aren't affected.",
  daily_cap: "That's a lot of AI for one day. It's back tomorrow.",
  workspace_off: "This workspace can't use AI right now.",
};

export async function withWorkspaceAi<T>(
  orgId: string,
  feature: CoachAiFeature,
  who: { userId: string | null; clientId?: string | null },
  run: Run<T>,
): Promise<WorkspaceAiResult<T>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: bill, error: billErr } = await db.from("organization_billing").select("pricing, seats").eq("org_id", orgId).maybeSingle();
  if (billErr) throw new Error(billErr.message);
  if (!bill) return { ok: false, reason: "workspace_off", words: WORDS.workspace_off };

  const allowance = monthlyCredits(bill.seats ?? 0, rowPricing(bill));
  const { data: state } = await db.rpc("org_ai_state", { _org: orgId });
  const purchasedLeft = Math.max(0, Number(state?.purchased_left ?? 0));
  const cap = spendCapMicroUsd(allowance + purchasedLeft);
  const { data, error } = await db.rpc("org_ai_reserve", {
    _org: orgId,
    _feature: feature,
    _credits: COACH_AI_FEATURES[feature].credits,
    _estimate_micro_usd: featureEstimateMicroUsd(feature),
    _allowance: allowance,
    _cap_micro_usd: cap,
    _daily_cap_micro_usd: Math.round(cap * DEFAULT_ALLOWANCE.dailyCapShare),
    _user: who.userId,
    _client: who.clientId ?? null,
  });
  if (error) throw new Error(`Couldn't check AI credits: ${error.message}`);
  if (!data?.ok) {
    const reason = (data?.reason ?? "workspace_off") as Exclude<WorkspaceAiResult<T>, { ok: true }>["reason"];
    return { ok: false, reason, words: WORDS[reason] ?? WORDS.workspace_off };
  }
  const useId = String(data.use_id);
  const settle = async (ok: boolean, model: string | null | undefined, usage: Usage) => {
    const input = Number(usage?.input ?? 0);
    const cached = Number(usage?.cached ?? 0);
    const output = Number(usage?.output ?? 0);
    const cost = model ? callCostMicroUsd({ model, input, cached, output }) : null;
    // a model with no price on file is kept at the feature's estimate, never at zero
    await db.rpc("org_ai_settle", {
      _use: useId, _ok: ok, _model: model ?? "unknown", _input: input, _cached: cached, _output: output,
      _cost_micro_usd: cost ?? featureEstimateMicroUsd(feature),
    });
  };
  try {
    const r = await run();
    await settle(true, r.model, r.usage);
    return { ok: true, value: r.value, source: String(data.source) };
  } catch (e: any) {
    await settle(false, e?.model ?? null, e?.usage ?? null);
    throw e;
  }
}
