/**
 * One model call that can outlive the request asking for it.
 *
 * A direct OpenAI call (`openai:`) runs in background mode: it's submitted once,
 * its response id is kept in `state.pending[key]`, and this request polls it for
 * `poll.ms`; if it isn't done the caller gets `WaitingForModel`, saves nothing
 * else, hands the request back, and the next request polls the same id (never a
 * second submission) until it answers or `backgroundLimitMs` passes. A finished
 * answer is kept in `state.calls[key]`, so a resumed run never asks twice. A
 * `gateway:` model (only when an admin override names one) is called and waited
 * on in this request. A model that fails is saved at once, so a request cut off
 * trying the next model never retries it.
 *
 * Used by Generate Next Program (pipeline.server.ts, the job's `result`) and the
 * Nutrition Update AI (nutrition-ai-plans.server.ts, `nutrition_ai_plans.progress`).
 * Server only.
 */
import type { Route } from "./routing";
import type { Effort, ModelUsage } from "./model-client.server";

/** The model hasn't answered yet: save, hand the request back, and poll again on the next one. */
export class WaitingForModel extends Error {
  constructor() {
    super("Waiting for the model");
  }
}

/** Every model on the route failed. The caller words the message (`tried`, `errors`). */
export class ModelsExhausted extends Error {
  constructor(
    public tried: string[],
    public errors: string[],
    /** OpenAI said the account has no credits left. */
    public noOpenAiCredits: boolean,
  ) {
    super(`No model answered (tried ${tried.join(", ")})`);
  }
}

export type CallState = {
  calls?: Record<string, { text: string; model: string }>;
  pending?: Record<string, { id?: string; model?: string; at?: number; failed?: string[] }>;
};

export type CallLog = {
  model: string;
  ok: boolean;
  ms: number;
  response: string | null;
  error?: string;
  usage?: ModelUsage | any;
};

export async function stagedCall(opts: {
  state: CallState;
  key: string;
  route: Route;
  req: {
    system: string;
    prompt: string;
    effort: Effort;
    maxOutputTokens?: number;
    temperature?: number;
  };
  /** Saves `state` (after every change). */
  save: () => Promise<void>;
  log?: (x: CallLog) => Promise<void>;
  poll: { ms: number; every: number };
  backgroundLimitMs: number;
  /** A gateway (synchronous) call's limit. */
  syncTimeoutMs: number;
}): Promise<{ text: string; model: string }> {
  const { state, key, route, req, save, poll } = opts;
  const log = opts.log ?? (async () => undefined);
  state.calls = state.calls ?? {};
  state.pending = state.pending ?? {};
  if (state.calls[key]) return state.calls[key];
  const { submitBackground, pollBackground, callModel, parseModelRef, ModelHttpError } =
    await import("./model-client.server");
  const pollFor = async (id: string) => {
    const t0 = Date.now();
    for (;;) {
      const st = await pollBackground(id);
      if (st.status !== "running" || Date.now() - t0 >= poll.ms) return st;
      await new Promise((r) => setTimeout(r, poll.every));
    }
  };
  const pending = state.pending[key];
  const tried: string[] = [...(pending?.failed ?? [])];
  const lastErrors: string[] = [];
  const done = async (text: string, model: string, usage: any, ms: number) => {
    state.calls![key] = { text, model };
    delete state.pending![key];
    await log({ model, ok: true, ms, response: text, usage });
    await save();
    return { text, model };
  };
  const failed = async (model: string, ms: number, error: string) => {
    tried.push(model);
    lastErrors.push(error);
    state.pending![key] = { failed: tried };
    await log({ model, ok: false, ms, response: null, error: error.slice(0, 500) });
    // kept at once: if this request is cut off trying the next model, the next one skips this
    await save();
  };
  if (pending?.id && pending.model) {
    const st = await pollFor(pending.id);
    if (st.status === "running" && Date.now() - (pending.at ?? 0) < opts.backgroundLimitMs)
      throw new WaitingForModel();
    if (st.status === "done")
      return done(
        st.reply.text,
        pending.model,
        st.reply.usage,
        Date.now() - (pending.at ?? Date.now()),
      );
    await failed(
      pending.model,
      Date.now() - (pending.at ?? Date.now()),
      st.status === "failed" ? st.error : "no answer in time",
    );
  }
  for (const model of route.models.filter((m) => !tried.includes(m))) {
    const t0 = Date.now();
    try {
      if (parseModelRef(model).via === "openai") {
        const { id } = await submitBackground(model, req);
        state.pending[key] = { id, model, at: t0, failed: tried };
        await save();
        const st = await pollFor(id);
        if (st.status === "running") throw new WaitingForModel();
        if (st.status === "done")
          return done(st.reply.text, model, st.reply.usage, Date.now() - t0);
        throw new Error(st.error);
      }
      const r = await callModel(model, { ...req, timeoutMs: opts.syncTimeoutMs });
      return done(r.text, model, r.usage, r.ms);
    } catch (e: any) {
      if (e instanceof WaitingForModel) throw e;
      if (e instanceof ModelHttpError && e.status === 402)
        throw new Error(
          "Lovable AI credits are used up. Add credits in Lovable (workspace settings, usage), then tap Try again: finished steps aren't redone.",
        );
      await failed(model, Date.now() - t0, String(e?.message ?? e));
    }
  }
  await save();
  const noOpenAiCredits =
    /no credits remaining|insufficient_quota/i.test(JSON.stringify(state.pending?.[key] ?? "")) ||
    lastErrors.some((m) => /no credits remaining|insufficient_quota/i.test(m));
  throw new ModelsExhausted(tried, lastErrors, noOpenAiCredits);
}

/** " The OpenAI account has no credits left: …" when that's why, for any caller's message. */
export const OPENAI_CREDITS_HINT =
  " The OpenAI account has no credits left: add credits at platform.openai.com (billing).";
