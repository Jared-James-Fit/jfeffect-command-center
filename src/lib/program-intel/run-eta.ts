/**
 * How far along a Generate Next Program run is, and about how long is left (Nov 23 2026).
 *
 * Each stage has a usual length: the model on it's median from real runs
 * (program_intel_job_calls; the worker stores what it measured on the job's `progress.typical`
 * when the run starts, else `TYPICAL_MS` below), the strategy scaled a little by how long the
 * athlete's brief is. The bar is the share of the run's usual total that's behind it; the time
 * left is what's usually left. A step past its usual length is said to be slow, never given a
 * made-up time: the bar holds and the step says how long the model has been at it (and that a
 * backup model starts beside it at `HEDGE_AFTER_MS`, whichever answers first is used).
 *
 * Shared by the worker (pipeline.server.ts: the hedge timings, the measured medians) and the
 * workstation (draft-view.tsx, next-program-link.tsx). Pure.
 */
import { DEFAULT_ROUTES } from "@/lib/ai/routing";

export type EtaStep = "context" | "strategy" | "construct" | "audit" | "repair" | "review" | "save";
type ModelSteps = Partial<Record<EtaStep, number>>;

/**
 * Usual time per call (ms) when the database has no measurements for the model yet. From the
 * calls on file on Nov 23 2026 (the Nov 9 benchmark on real athletes): GPT-6 Astra writes a
 * strategy in a median 514 s (p90 786 s, the longest 867 s) for a ~164k-character brief, builds a
 * block in ~92 s and reviews in ~20 s; GPT-5.5 strategises in ~170 s through the gateway (a little
 * more polled in the background), builds in ~60 s and repairs in ~45 s.
 */
export const TYPICAL_MS: Record<string, ModelSteps> = {
  "openai:gpt-6-astra": { strategy: 514_000, construct: 92_000, repair: 92_000, review: 20_000 },
  "openai:gpt-5.5": { strategy: 200_000, construct: 65_000, repair: 50_000, review: 40_000 },
};
/** Steps no model answers (code only), and a model's step with nothing on file. */
const BASE_MS: Record<EtaStep, number> = { context: 20_000, strategy: 300_000, construct: 75_000, audit: 15_000, repair: 60_000, review: 40_000, save: 10_000 };
/** The brief the strategy medians were measured on (characters). */
export const TYPICAL_BRIEF_CHARS = 164_000;
/** The hand-over between requests (pg_net and a new worker) around each model step. */
const HANDOVER_MS = 6_000;

/**
 * A background call still running this long gets a backup (the route's next model, started beside
 * it; whichever answers first is used: staged-call.server.ts `hedgeAfterMs`). The strategy's is past
 * the longest Astra strategy on file (867 s); the others are several times their usual length.
 */
export const HEDGE_AFTER_MS: Partial<Record<EtaStep, number>> = {
  strategy: 15 * 60_000,
  construct: 6 * 60_000,
  repair: 6 * 60_000,
  review: 5 * 60_000,
};

/**
 * The quarter hours (hh:00, :15, :30, :45), when a dozen scheduled jobs reach the app's worker in
 * the same second: on Nov 23 2026 9 of the 13 worker errors in six hours (Cloudflare 1102 "over
 * its resource limits", 502) came at one, and every one of the three requests Dwayne's run lost
 * was cut off there. A run's worker doesn't pick a run up from `QUARTER_LEAD_MS` before a quarter
 * hour to `QUARTER_TAIL_MS` after it (the next minute's look takes it), and a poll ends before the
 * next one, so no request of a run is in flight through the rush.
 */
export const QUARTER_LEAD_MS = 10_000;
export const QUARTER_TAIL_MS = 25_000;
const QUARTER_MS = 15 * 60_000;

/** Within the rush around a quarter hour. */
export function inQuarterRush(now: number): boolean {
  const into = ((now % QUARTER_MS) + QUARTER_MS) % QUARTER_MS;
  return into < QUARTER_TAIL_MS || QUARTER_MS - into < QUARTER_LEAD_MS;
}

/** How long a request may poll from `now`: at most `maxMs`, ending before the next rush (never under 3 s). */
export function pollWindowMs(now: number, maxMs: number): number {
  const into = ((now % QUARTER_MS) + QUARTER_MS) % QUARTER_MS;
  const toRush = QUARTER_MS - into - QUARTER_LEAD_MS;
  return Math.max(3_000, Math.min(maxMs, toRush));
}

export type RunProgress = {
  stages?: Array<{ key: string; label?: string; status: string; detail?: string; startedAt?: number; doneAt?: number }>;
  current?: string | null;
  /** Measured medians per model and step (ms), written by the worker when the run starts. */
  typical?: Record<string, ModelSteps>;
  /** The first model on each step's route for this run. */
  models?: Partial<Record<EtaStep, string>>;
  /** The strategy's usual time scaled by this athlete's brief (see `briefScale`). */
  scale?: number;
};

export type RunJob = {
  status: string;
  kind: string;
  stage?: string | null;
  created_at: string;
  progress?: RunProgress | null;
  result?: any;
};

export type RunEta = {
  /** 1–99 while working. */
  pct: number;
  /** About how long is left; null when the step on now is past its usual length (no honest number). */
  remainingMs: number | null;
  /** The step on now is past its usual length. */
  slow: boolean;
  /** How long the step on now has been going, and how long it usually takes. */
  stepElapsedMs: number;
  stepTypicalMs: number;
  /** The model working on the step on now, when one is. */
  model: string | null;
  /** A backup model started beside a slow one, and since when (ms ago). */
  backup: { model: string; elapsedMs: number } | null;
  /** OpenAI hasn't started the call yet (it's waiting in their queue), and for how long. */
  queuedMs: number | null;
  /** A backup will start once the step has been going this long (ms), when the route has one. */
  backupAtMs: number | null;
};

export function stepOf(key: string): EtaStep {
  const k = key.split(/[:\s(]/)[0];
  return (["context", "strategy", "construct", "audit", "repair", "review", "save"] as EtaStep[]).includes(k as EtaStep) ? (k as EtaStep) : "audit";
}

/** A longer brief takes a strong model longer to read and weigh; never more than 1.5× or less than 0.8× the usual. */
export function briefScale(chars: number | null | undefined): number {
  if (!chars || chars <= 0) return 1;
  return Math.min(1.5, Math.max(0.8, Math.sqrt(chars / TYPICAL_BRIEF_CHARS)));
}

/** Median of a list (ms). */
export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

/** "gateway:openai/gpt-5.5" and "openai:gpt-5.5" are the same model (only the way in differs). */
export function sameModel(ref: string): string {
  const m = /^gateway:openai\/(.+)$/.exec(ref);
  return m ? `openai:${m[1]}` : ref;
}

/**
 * Medians per model and step from logged calls (program_intel_job_calls rows: stage, model, ok,
 * duration_ms). Only successful calls; the "(retry)" asks count as their step; at least 3 calls.
 */
export function measuredTypical(rows: Array<{ stage: string; model: string; ok: boolean; duration_ms: number | null }>): Record<string, ModelSteps> {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.ok || !r.duration_ms) continue;
    const step = stepOf(r.stage);
    if (step === "context" || step === "audit" || step === "save") continue;
    const k = `${sameModel(r.model)}|${step}`;
    by.set(k, [...(by.get(k) ?? []), r.duration_ms]);
  }
  const out: Record<string, ModelSteps> = {};
  for (const [k, xs] of by) {
    if (xs.length < 3) continue;
    const [model, step] = k.split("|");
    out[model] = { ...(out[model] ?? {}), [step]: median(xs)! };
  }
  return out;
}

/** The route's first model for a step (a run's own when it says, else the defaults). */
function modelFor(step: EtaStep, p: RunProgress | null | undefined): string | null {
  if (step === "context" || step === "audit" || step === "save") return null;
  return p?.models?.[step] ?? DEFAULT_ROUTES[step].models[0] ?? null;
}

/** How long a step usually takes with a model (ms), handover included. */
export function typicalMs(step: EtaStep, model: string | null, p: RunProgress | null | undefined): number {
  if (!model) return BASE_MS[step];
  const m = sameModel(model);
  const base = p?.typical?.[m]?.[step] ?? TYPICAL_MS[m]?.[step] ?? BASE_MS[step];
  const scaled = step === "strategy" ? base * (p?.scale ?? 1) : base;
  return Math.round(scaled + HANDOVER_MS);
}

/** The blocks a 12-week run usually ends up with before the strategy says (the strategy decides). */
function guessBlocks(weeks: number | null | undefined): number {
  return Math.min(4, Math.max(1, Math.round((weeks ?? 12) / 4)));
}

export function runEta(job: RunJob, now: number): RunEta | null {
  if (job.status !== "pending" && job.status !== "running") return null;
  const p = job.progress ?? null;
  const started = Date.parse(job.created_at) || now;
  let stages = (p?.stages ?? []).slice();
  if (!stages.length) stages = [{ key: "context", status: "running" }];
  // a run whose strategy hasn't said how many blocks yet: the usual number for its length
  const constructs = stages.filter((s) => stepOf(s.key) === "construct");
  if (job.kind === "generate" && constructs.length === 1 && constructs[0].status === "pending" && !job.result?.strategy) {
    const extra = guessBlocks(job.result?.setup?.weeks) - 1;
    const at = stages.indexOf(constructs[0]);
    for (let i = 0; i < extra; i++) stages.splice(at + 1, 0, { key: `construct:${i + 1}`, status: "pending" });
  }
  const est = (s: { key: string }) => {
    const step = stepOf(s.key);
    const ms = typicalMs(step, modelFor(step, p), p);
    // the audit stage holds the repairs: usually one round of one block
    return step === "audit" ? ms + typicalMs("repair", modelFor("repair", p), p) / 2 : ms;
  };
  const currentKey = p?.current ?? job.stage ?? stages.find((s) => s.status === "running")?.key ?? "context";
  const current = stages.find((s) => s.status === "running") ?? stages.find((s) => s.key === (currentKey.startsWith("repair") ? "audit" : currentKey));
  // the call in flight on the step on now (its model and when it was asked), and any backup beside it
  const pend = Object.values((job.result?.pending ?? {}) as Record<string, { id?: string; model?: string; at?: number; phase?: string; startedAt?: number; failed?: string[]; hedge?: { model: string; at: number; startedAt?: number } }>).find((x) => x?.id && x.model);
  const currentStep = stepOf(currentKey);
  const model = pend?.model ?? modelFor(currentStep, p);
  const stepTypical = current ? (pend?.model ? typicalMs(currentStep, pend.model, p) : est(current)) : 0;
  // the model's own time runs from when OpenAI started it (time waiting in their queue isn't thinking)
  const queued = pend?.phase === "queued" && pend.at ? now - pend.at : null;
  const stepStart = pend ? (pend.phase === "queued" ? now : pend.startedAt ?? pend.at ?? now) : current?.startedAt ?? (current?.key === stages[0].key ? started : now);
  const stepElapsed = Math.max(0, now - stepStart);
  const backup = pend?.hedge ? { model: pend.hedge.model, elapsedMs: Math.max(0, now - (pend.hedge.startedAt ?? pend.hedge.at)) } : null;

  let total = 0;
  let behind = 0;
  let ahead = 0;
  let afterCurrent = false;
  for (const s of stages) {
    if (s.status === "skipped") continue;
    const e = s === current ? stepTypical : est(s);
    total += e;
    if (s === current) {
      afterCurrent = true;
      continue;
    }
    if (s.status === "done" || s.status === "error") behind += e;
    else if (afterCurrent || s.status === "pending") ahead += e;
  }
  let slow = stepElapsed > stepTypical;
  let stepLeft = Math.max(0, stepTypical - stepElapsed);
  let stepDone = Math.min(stepElapsed, stepTypical * 0.95);
  if (backup) {
    // the backup is the one to wait on now (whichever answers first is used)
    const bTypical = typicalMs(currentStep, backup.model, p);
    slow = backup.elapsedMs > bTypical;
    stepLeft = Math.max(0, bTypical - backup.elapsedMs);
    stepDone = stepTypical * 0.95 * Math.min(1, 0.6 + (0.4 * backup.elapsedMs) / bTypical);
  }
  const pct = total ? Math.round((100 * (behind + stepDone)) / total) : 1;
  // a backup can only start while the route has another model that hasn't failed on this call
  const route = (DEFAULT_ROUTES as Record<string, { models: string[] }>)[currentStep]?.models ?? [];
  const another = !!pend?.model && route.some((m) => sameModel(m) !== sameModel(pend.model!) && !(pend.failed ?? []).includes(m));
  const hedge = another ? HEDGE_AFTER_MS[currentStep] : undefined;
  return {
    pct: Math.min(99, Math.max(1, pct)),
    // a call OpenAI hasn't started after a minute: no honest number until it does
    remainingMs: slow || (queued != null && queued > 60_000 && !backup) ? null : Math.round(stepLeft + ahead),
    slow,
    stepElapsedMs: stepElapsed,
    stepTypicalMs: stepTypical,
    model: model ?? null,
    backup,
    backupAtMs: !backup && hedge != null && pend?.model ? hedge : null,
    queuedMs: queued,
  };
}

/** "about 6 min", "under a minute", "about 1 h 5 min". */
export function durationWords(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return `about ${h} h${rest ? ` ${rest} min` : ""}`;
}

/** "12 min", "45 s", "1 h 5 min": how long something has been going. */
export function elapsedWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

const MODEL_NAMES: Record<string, string> = {
  "openai:gpt-6-astra": "GPT-6 Astra",
  "openai:gpt-5.5": "GPT-5.5",
  "openai:gpt-5-mini": "GPT-5 mini",
  "openai:gpt-5": "GPT-5",
};

/** "GPT-6 Astra", "GPT-5.5": a model ref as a coach reads it. */
export function modelName(ref: string | null | undefined): string {
  if (!ref) return "The model";
  const m = sameModel(ref);
  return MODEL_NAMES[m] ?? m.replace(/^(openai|gateway):/, "").replace(/^[a-z]+\//, "");
}

/**
 * Edit with AI's turn (program-ai/worker.server.ts), one request with its stages named as it goes:
 * reading the program, their history, the model thinking (GPT-5.5: a median 78 s, p90 90 s on the
 * edits logged to Nov 23 2026), a fix round when the engine refused something, checking. The bar
 * is the stage reached and, inside the model's step, the time against its usual length; past it,
 * no made-up time.
 */
const EDIT_STAGES: Array<{ match: RegExp; from: number; to: number }> = [
  { match: /^reading the program/i, from: 2, to: 8 },
  { match: /^reading their training/i, from: 8, to: 14 },
  { match: /^thinking/i, from: 14, to: 86 },
  { match: /^fixing/i, from: 86, to: 93 },
  { match: /^checking/i, from: 93, to: 98 },
];
export const EDIT_TYPICAL_MS = 90_000;

export function editEta(stage: string | null | undefined, createdAt: string, now: number): { pct: number; remainingMs: number | null; slow: boolean } {
  const elapsed = Math.max(0, now - (Date.parse(createdAt) || now));
  const s = EDIT_STAGES.find((x) => x.match.test(stage ?? "")) ?? { from: 1, to: 8 };
  const slow = elapsed > EDIT_TYPICAL_MS * 1.15;
  const share = Math.min(1, elapsed / EDIT_TYPICAL_MS);
  const pct = Math.round(Math.max(s.from, Math.min(s.to - 1, s.from + (s.to - s.from) * (/^thinking/i.test(stage ?? "") ? share : 0.5))));
  return { pct: Math.min(99, Math.max(1, pct)), remainingMs: slow ? null : Math.max(5_000, EDIT_TYPICAL_MS - elapsed), slow };
}
