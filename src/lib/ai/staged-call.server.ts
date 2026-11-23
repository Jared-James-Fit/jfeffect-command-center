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
import type { Effort, ModelFile, ModelUsage } from "./model-client.server";

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

/**
 * A background call in flight on OpenAI's side. `phase` is OpenAI's own status at the last poll
 * ("queued": not started; "in_progress": thinking), and `startedAt` when it was first seen thinking,
 * so a run says honestly whether it's waiting in OpenAI's queue or the model is at work.
 */
export type LiveCall = { id: string; model: string; at: number; phase?: "queued" | "in_progress"; startedAt?: number };

export type CallState = {
  calls?: Record<string, { text: string; model: string }>;
  /**
   * The call in flight (`id`, `model`, `at`), the models already given up on (`failed`), and a
   * backup started because the first was far slower than usual (`hedge`): whichever answers first
   * is used and the other is stopped.
   */
  pending?: Record<string, { id?: string; model?: string; at?: number; phase?: LiveCall["phase"]; startedAt?: number; failed?: string[]; hedge?: LiveCall }>;
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
    /** Files the model reads (OpenAI direct only); built only when a call is about to be submitted. */
    files?: ModelFile[] | (() => Promise<ModelFile[]>);
  };
  /** Saves `state` (after every change). */
  save: () => Promise<void>;
  /** What the call is for, on its ai_call_log row (default: the route's task, then the key). */
  tag?: string;
  log?: (x: CallLog) => Promise<void>;
  poll: { ms: number; every: number };
  backgroundLimitMs: number;
  /**
   * A background call still running after this long gets a backup: the route's next OpenAI model
   * is started beside it and whichever answers first is used (the other is stopped). For a slow
   * tail (a strong model that normally answers in ~9 min still thinking at 30), so the run never
   * waits out the whole `backgroundLimitMs` and then starts from scratch. Off when not given.
   */
  hedgeAfterMs?: number;
  /**
   * How long the route's last model (no other left to take over, no backup running) is waited on.
   * Cutting it off at `backgroundLimitMs` only guarantees a failed run (Dwayne's Nov 23 2026
   * strategy: GPT-5.5 took over after Astra's 25 min and would have been cut off with nothing
   * after it). A hard cap all the same, so nothing runs forever. Defaults to `backgroundLimitMs`.
   */
  finalLimitMs?: number;
  /** A gateway (synchronous) call's limit. */
  syncTimeoutMs: number;
}): Promise<{ text: string; model: string }> {
  const { state, key, route, req, save, poll } = opts;
  const log = opts.log ?? (async () => undefined);
  state.calls = state.calls ?? {};
  state.pending = state.pending ?? {};
  if (state.calls[key]) return state.calls[key];
  const mc = await import("./model-client.server");
  const { submitBackground, pollBackground, callModel, parseModelRef, ModelHttpError } = mc;
  // best effort: a response nobody will read is stopped so it isn't billed
  const cancelBackground = async (id: string) => {
    try {
      await mc.cancelBackground(id);
    } catch {
      // nothing to do
    }
  };
  const { classifyAiError, isAccountFailure, isProviderFailure, AiUnavailableError } = await import("./ai-errors");
  const { recordAiCall } = await import("./ai-health.server");
  const tag = opts.tag ?? opts.route.task ?? key.split(":")[0];
  const keyOf = (m: string) => (m.startsWith("gateway:") ? "gateway" : "openai");
  // a key out of credits (or refused, or paused) answers for none of its models: never asked twice
  const deadKeys = new Set<string>();
  let paused: unknown = null;
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
  const done = async (text: string, model: string, usage: any, ms: number, background = true) => {
    state.calls![key] = { text, model };
    delete state.pending![key];
    // a synchronous (gateway) call is on record already (callModel); a background one is recorded here
    if (background) await recordAiCall({ model, task: tag, feature: key, ok: true, usage, ms });
    await log({ model, ok: true, ms, response: text, usage });
    await save();
    return { text, model };
  };
  /** A model failed: on record, and (unless it was the provider's fault) never asked again this call. */
  const noteFailure = async (model: string, ms: number, error: string, background = true) => {
    const kind = classifyAiError(error);
    lastErrors.push(error);
    if (background) await recordAiCall({ model, task: tag, feature: key, ok: false, error, ms });
    await log({ model, ok: false, ms, response: null, error: error.slice(0, 500) });
    if (isProviderFailure(kind)) {
      // the provider's failure, not this model's: nothing kept, so a run after AI is back
      // tries it again; the key's other models aren't asked this run
      if (isAccountFailure(kind) || kind === "paused") deadKeys.add(keyOf(model));
      return;
    }
    tried.push(model);
  };
  const failed = async (model: string, ms: number, error: string, background = true) => {
    await noteFailure(model, ms, error, background);
    state.pending![key] = { failed: tried };
    // kept at once: if this request is cut off trying the next model, the next one skips this
    await save();
  };
  /** The one that lost the race: stopped (so it isn't billed for nothing) and noted on the job's log. */
  const letGo = async (call: LiveCall, winner: string) => {
    await cancelBackground(call.id);
    await log({ model: call.model, ok: false, ms: Date.now() - call.at, response: null, error: `stopped: ${winner} answered first` });
  };
  /** Poll the call in flight (and its backup) until one of them settles or this request's turn is up. */
  const pollBoth = async (a: LiveCall, b?: LiveCall) => {
    const t0 = Date.now();
    for (;;) {
      const p = await pollBackground(a.id);
      const h = b ? await pollBackground(b.id) : undefined;
      if (p.status !== "running" || (h && h.status !== "running") || Date.now() - t0 >= poll.ms) return { p, h };
      await new Promise((r) => setTimeout(r, poll.every));
    }
  };
  /** What OpenAI said about a call still running, kept on it (true when that changed). */
  const notePhase = (call: LiveCall, st: { status: string; phase?: LiveCall["phase"] } | undefined): boolean => {
    if (!st || st.status !== "running" || !st.phase || st.phase === call.phase) return false;
    // first seen thinking a while after it was sent (a call from before this was recorded): it's
    // been at it since it was sent as far as anyone can tell, never "just started"
    if (st.phase === "in_progress" && !call.startedAt) call.startedAt = !call.phase && Date.now() - call.at > 120_000 ? call.at : Date.now();
    call.phase = st.phase;
    return true;
  };
  if (pending?.id && pending.model) {
    const live: LiveCall = { id: pending.id, model: pending.model, at: pending.at ?? Date.now(), phase: pending.phase, startedAt: pending.startedAt };
    let backup: LiveCall | undefined = pending.hedge ? { ...pending.hedge } : undefined;
    const hadBackup = !!backup;
    const { p, h } = await pollBoth(live, backup);
    const livePhase = notePhase(live, p);
    const backupPhase = backup ? notePhase(backup, h) : false;
    const phaseChanged = livePhase || backupPhase;
    if (p.status === "done") {
      if (backup) await letGo(backup, live.model);
      return done(p.reply.text, live.model, p.reply.usage, Date.now() - live.at);
    }
    if (h?.status === "done" && backup) {
      await letGo(live, backup.model);
      return done(h.reply.text, backup.model, h.reply.usage, Date.now() - backup.at);
    }
    if (h?.status === "failed" && backup) {
      await noteFailure(backup.model, Date.now() - backup.at, h.error);
      backup = undefined;
    }
    // stopped from outside (the run was discarded or ended): nothing is asked in its place
    if (p.status === "failed" && /^cancelled\b/i.test(p.error)) {
      if (backup) await cancelBackground(backup.id);
      throw new Error("The model call was stopped.");
    }
    // the limit is there to hand over to the next model: the last one is waited on longer
    const canHandOver = !!backup || route.models.some((m) => m !== live.model && !tried.includes(m) && !deadKeys.has(keyOf(m)));
    const overLimit = Date.now() - live.at >= (canHandOver ? opts.backgroundLimitMs : opts.finalLimitMs ?? opts.backgroundLimitMs);
    if (p.status === "running" && !overLimit) {
      // far slower than usual: start the next model beside it (whichever answers first is used)
      if (!backup && opts.hedgeAfterMs != null && Date.now() - live.at >= opts.hedgeAfterMs) {
        const next = route.models.find((m) => m !== live.model && !tried.includes(m) && parseModelRef(m).via === "openai" && !deadKeys.has(keyOf(m)));
        if (next) {
          try {
            const files = typeof req.files === "function" ? await req.files() : req.files;
            const { id } = await submitBackground(next, { ...req, files, tag });
            backup = { id, model: next, at: Date.now() };
          } catch (e: any) {
            await noteFailure(next, 0, String(e?.message ?? e));
          }
        }
      }
      if (phaseChanged || !!backup !== hadBackup || backup?.id !== pending.hedge?.id) {
        state.pending[key] = { ...live, failed: tried, ...(backup ? { hedge: backup } : {}) };
        await save();
      }
      throw new WaitingForModel();
    }
    // given up on: stop it on OpenAI's side too, or it finishes and is billed for nothing
    if (p.status === "running") await cancelBackground(live.id);
    await noteFailure(live.model, Date.now() - live.at, p.status === "failed" ? p.error : "no answer in time");
    if (backup) {
      // the backup carries on as the call in flight, on its own clock
      state.pending[key] = { ...backup, failed: tried };
      await save();
      throw new WaitingForModel();
    }
    state.pending[key] = { failed: tried };
    await save();
  }
  for (const model of route.models.filter((m) => !tried.includes(m))) {
    if (deadKeys.has(keyOf(model))) continue;
    const t0 = Date.now();
    try {
      if (parseModelRef(model).via === "openai") {
        const files = typeof req.files === "function" ? await req.files() : req.files;
        const { id } = await submitBackground(model, { ...req, files, tag });
        state.pending[key] = { id, model, at: t0, failed: tried };
        await save();
        const st = await pollFor(id);
        if (st.status === "running") {
          const call: LiveCall = { id, model, at: t0 };
          if (notePhase(call, st)) {
            state.pending[key] = { ...call, failed: tried };
            await save();
          }
          throw new WaitingForModel();
        }
        if (st.status === "done")
          return done(st.reply.text, model, st.reply.usage, Date.now() - t0);
        throw new Error(st.error);
      }
      const files = typeof req.files === "function" ? await req.files() : req.files;
      const r = await callModel(model, { ...req, files, timeoutMs: opts.syncTimeoutMs, tag });
      return done(r.text, model, r.usage, r.ms, false);
    } catch (e: any) {
      if (e instanceof WaitingForModel) throw e;
      if (e instanceof ModelHttpError && e.status === 402)
        throw new Error(
          "Lovable AI credits are used up. Add credits in Lovable (workspace settings, usage), then tap Try again: finished steps aren't redone.",
        );
      if (e instanceof AiUnavailableError) paused = paused ?? e;
      await failed(model, Date.now() - t0, String(e?.message ?? e), parseModelRef(model).via === "openai");
    }
  }
  await save();
  // every key was paused by the breaker: say so (the job parks and is redone once AI is back)
  if (paused && route.models.every((m) => deadKeys.has(keyOf(m)) || tried.includes(m))) throw paused;
  const noOpenAiCredits =
    /no credits remaining|insufficient_quota/i.test(JSON.stringify(state.pending?.[key] ?? "")) ||
    lastErrors.some((m) => /no credits remaining|insufficient_quota/i.test(m));
  throw new ModelsExhausted(tried, lastErrors, noOpenAiCredits);
}

/** " The OpenAI account has no credits left: …" when that's why, for any caller's message. */
export const OPENAI_CREDITS_HINT =
  " The OpenAI account has no credits left: add credits at platform.openai.com (billing).";
