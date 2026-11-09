/**
 * One way for the app's coaching AI to call a model, whatever serves it.
 *
 * A model is named by where it's reached:
 *   "openai:gpt-6-astra"                OpenAI directly (OPENAI_API_KEY), Responses API;
 *                                       long calls run in background mode (submit, then poll),
 *                                       so no request has to stay open while the model thinks
 *   "gateway:openai/gpt-5.5"            the Lovable AI gateway, OpenAI-compatible chat
 *   "gateway:google/gemini-3-flash-preview"
 *   "gateway:anthropic/claude-opus-5-5" the gateway's Anthropic Messages endpoint (Claude)
 *
 * Every call returns the text, the tokens it used and how long it took, so cost
 * and speed can be measured per stage. Server only.
 */

export type Effort = "low" | "medium" | "high";
export type ModelUsage = { input: number | null; output: number | null; reasoning: number | null };
export type ModelReply = { text: string; model: string; usage: ModelUsage; ms: number };
export type ModelRequest = {
  system: string;
  prompt: string;
  /** Reasoning effort for models that take one (OpenAI reasoning models, Claude thinking). */
  effort?: Effort;
  maxOutputTokens?: number;
  /** Sync calls only: give up after this long. */
  timeoutMs?: number;
  temperature?: number;
};

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const OPENAI = "https://api.openai.com/v1";

export class ModelHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parseModelRef(ref: string): { via: "openai" | "gateway"; family: "openai" | "anthropic" | "google" | "other"; id: string } {
  const [via, ...rest] = ref.split(":");
  const id = rest.join(":");
  if (via === "openai") return { via: "openai", family: "openai", id };
  const family = id.startsWith("anthropic/") ? "anthropic" : id.startsWith("openai/") ? "openai" : id.startsWith("google/") ? "google" : "other";
  return { via: "gateway", family, id };
}

const isReasoning = (id: string) => /(^|\/)(gpt-5|gpt-6|o\d)/.test(id);

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new ModelHttpError(res.status, `${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function gatewayHeaders(): Record<string, string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured.");
  return { "Lovable-API-Key": key, Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "vercel-ai-sdk" };
}
function openaiHeaders(): Record<string, string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  return { Authorization: `Bearer ${key}` };
}

/** Thinking budget for Claude by effort (tokens it may think before answering). */
async function gatewayChat(id: string, r: ModelRequest): Promise<Omit<ModelReply, "model" | "ms">> {
  const body: Record<string, unknown> = { model: id, messages: [{ role: "system", content: r.system }, { role: "user", content: r.prompt }] };
  if (isReasoning(id)) {
    if (r.effort) body.reasoning_effort = r.effort;
  } else if (r.temperature != null) body.temperature = r.temperature;
  if (r.maxOutputTokens) body[isReasoning(id) ? "max_completion_tokens" : "max_tokens"] = r.maxOutputTokens;
  const j = await post(`${GATEWAY}/chat/completions`, gatewayHeaders(), body, r.timeoutMs ?? 170_000);
  const text = String(j?.choices?.[0]?.message?.content ?? "");
  return { text, usage: { input: j?.usage?.prompt_tokens ?? null, output: j?.usage?.completion_tokens ?? null, reasoning: j?.usage?.completion_tokens_details?.reasoning_tokens ?? null } };
}

/**
 * Claude (Opus 5.5, Sonnet 5) through the gateway's native Messages route. Thinking is adaptive
 * and its depth is `output_config.effort`: a thinking budget (`budget_tokens`) and any sampling
 * setting (temperature) are refused with a 400 on these models, so neither is ever sent.
 */
async function gatewayMessages(id: string, r: ModelRequest): Promise<Omit<ModelReply, "model" | "ms">> {
  const body: Record<string, unknown> = { model: id, max_tokens: r.maxOutputTokens ?? 32_000, system: r.system, messages: [{ role: "user", content: r.prompt }], thinking: { type: "adaptive" } };
  if (r.effort) body.output_config = { effort: r.effort };
  const j = await post(`${GATEWAY}/messages`, { ...gatewayHeaders(), "anthropic-version": "2023-06-01" }, body, r.timeoutMs ?? 170_000);
  if (j?.stop_reason === "refusal") throw new Error(`${id} declined the request${j?.stop_details?.category ? ` (${j.stop_details.category})` : ""}`);
  const text = (Array.isArray(j?.content) ? j.content : []).filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "").join("");
  if (j?.stop_reason === "max_tokens" && !text.trim()) throw new Error(`${id} ran out of room before answering`);
  return { text, usage: { input: j?.usage?.input_tokens ?? null, output: j?.usage?.output_tokens ?? null, reasoning: null } };
}

function responseText(j: any): string {
  if (typeof j?.output_text === "string" && j.output_text) return j.output_text;
  return (Array.isArray(j?.output) ? j.output : [])
    .flatMap((o: any) => (Array.isArray(o?.content) ? o.content : []))
    .filter((c: any) => c?.type === "output_text" || typeof c?.text === "string")
    .map((c: any) => c.text ?? "")
    .join("");
}
function responseUsage(j: any): ModelUsage {
  return { input: j?.usage?.input_tokens ?? null, output: j?.usage?.output_tokens ?? null, reasoning: j?.usage?.output_tokens_details?.reasoning_tokens ?? null };
}
function openaiBody(id: string, r: ModelRequest, background: boolean): Record<string, unknown> {
  return {
    model: id,
    instructions: r.system,
    input: r.prompt,
    ...(isReasoning(id) ? { reasoning: { effort: r.effort ?? "medium" } } : r.temperature != null ? { temperature: r.temperature } : {}),
    ...(r.maxOutputTokens ? { max_output_tokens: r.maxOutputTokens } : {}),
    ...(background ? { background: true, store: true } : {}),
  };
}

/** Start a long OpenAI call that runs on OpenAI's side; poll it with `pollBackground`. */
export async function submitBackground(ref: string, r: ModelRequest): Promise<{ id: string }> {
  const m = parseModelRef(ref);
  if (m.via !== "openai") throw new Error(`${ref} can't run in background mode.`);
  const j = await post(`${OPENAI}/responses`, openaiHeaders(), openaiBody(m.id, r, true), 30_000);
  if (!j?.id) throw new Error("OpenAI didn't return a response id.");
  return { id: String(j.id) };
}

export type BackgroundState = { status: "running" } | { status: "done"; reply: Omit<ModelReply, "model" | "ms"> } | { status: "failed"; error: string };

export async function pollBackground(id: string): Promise<BackgroundState> {
  const res = await fetch(`${OPENAI}/responses/${encodeURIComponent(id)}`, { headers: openaiHeaders(), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) return { status: "failed", error: `${res.status} ${text.slice(0, 300)}` };
  const j = JSON.parse(text);
  if (j.status === "completed") return { status: "done", reply: { text: responseText(j), usage: responseUsage(j) } };
  if (j.status === "failed" || j.status === "cancelled" || j.status === "incomplete") return { status: "failed", error: `${j.status}: ${String(j.error?.message ?? j.incomplete_details?.reason ?? "").slice(0, 300)}` };
  return { status: "running" };
}

/** One synchronous call (OpenAI direct runs in background mode and is polled here, up to timeoutMs). */
export async function callModel(ref: string, r: ModelRequest): Promise<ModelReply> {
  const t0 = Date.now();
  const m = parseModelRef(ref);
  let out: Omit<ModelReply, "model" | "ms">;
  if (m.via === "openai") {
    const { id } = await submitBackground(ref, r);
    const limit = r.timeoutMs ?? 170_000;
    for (;;) {
      await new Promise((res) => setTimeout(res, 3000));
      const st = await pollBackground(id);
      if (st.status === "done") {
        out = st.reply;
        break;
      }
      if (st.status === "failed") throw new Error(`${ref}: ${st.error}`);
      if (Date.now() - t0 > limit) throw new Error(`${ref}: no answer within ${Math.round(limit / 1000)}s`);
    }
  } else if (m.family === "anthropic") out = await gatewayMessages(m.id, r);
  else out = await gatewayChat(m.id, r);
  return { ...out, model: ref, ms: Date.now() - t0 };
}

/**
 * Published list prices, US$ per million tokens (input, output), for the admin
 * panel's cost estimate: only rates with a source (Nov 2026: GPT-6 Astra from
 * OpenAI's rate card as reported, Claude Opus 5.5 from Anthropic's model docs).
 * Any other model shows its tokens without a price rather than a guess. Gateway
 * calls bill in Lovable credits.
 */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
};

export function priceKey(model: string): string {
  return model.replace(/^(openai|gateway):/, "").replace(/^(openai|anthropic|google)\//, "");
}

/** Estimated US$ for one call's tokens, or null when the model has no price on file. */
export function estimateCost(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const p = PRICE_PER_MTOK[priceKey(model)];
  if (!p || inputTokens == null || outputTokens == null) return null;
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * 1000) / 1000;
}
