/**
 * Generate Next Program runs (Nov 23 2026): the progress bar and time left (run-eta.ts), the
 * backup model started beside a strong model that's far slower than usual (stagedCall's
 * `hedgeAfterMs`), never the Lovable gateway outside a benchmark, and a run whose request the host
 * cut off picked up again within minutes, not 10–15.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRoute } from "@/lib/ai/routing";
import {
  briefScale,
  durationWords,
  elapsedWords,
  HEDGE_AFTER_MS,
  inQuarterRush,
  measuredTypical,
  pollWindowMs,
  modelName,
  runEta,
  stepOf,
  typicalMs,
  type RunJob,
} from "@/lib/program-intel/run-eta";

const T0 = Date.parse("2026-11-23T16:37:03Z");
const min = 60_000;

function strategyJob(over: Partial<RunJob> & { pendingAt?: number; hedgeAt?: number } = {}): RunJob {
  const { pendingAt, hedgeAt, ...rest } = over;
  return {
    status: "running",
    kind: "strategy",
    stage: "strategy",
    created_at: new Date(T0).toISOString(),
    progress: {
      stages: [
        { key: "context", label: "Athlete data", status: "done", startedAt: T0, doneAt: T0 + 4000 },
        { key: "strategy", label: "Programming strategy", status: "running", startedAt: T0 + 4000 },
      ],
      current: "strategy",
    },
    result: pendingAt
      ? {
          pending: {
            strategy: {
              id: "resp_1",
              model: "openai:gpt-6-astra",
              at: pendingAt,
              ...(hedgeAt ? { hedge: { id: "resp_2", model: "openai:gpt-5.5", at: hedgeAt } } : {}),
            },
          },
        }
      : {},
    ...rest,
  };
}

describe("run-eta: how far along a run is", () => {
  it("a strategy just asked: nearly all of it ahead, about the model's usual time left", () => {
    const eta = runEta(strategyJob({ pendingAt: T0 + 4000 }), T0 + 5000)!;
    expect(eta.pct).toBeLessThan(10);
    expect(eta.slow).toBe(false);
    expect(eta.model).toBe("openai:gpt-6-astra");
    // Astra's usual strategy (514 s) plus the handover
    expect(eta.remainingMs).toBeGreaterThan(8 * min);
    expect(eta.remainingMs).toBeLessThan(10 * min);
  });

  it("half way through its usual time: about half the bar, the time left counts down", () => {
    const at = T0 + 4000;
    const a = runEta(strategyJob({ pendingAt: at }), at + 4 * min)!;
    const b = runEta(strategyJob({ pendingAt: at }), at + 6 * min)!;
    expect(a.pct).toBeGreaterThan(40);
    expect(b.pct).toBeGreaterThan(a.pct);
    expect(b.remainingMs!).toBeLessThan(a.remainingMs!);
  });

  it("past its usual time: says so, never a made-up time, and when a backup would start", () => {
    const at = T0 + 4000;
    const eta = runEta(strategyJob({ pendingAt: at }), at + 12 * min)!;
    expect(eta.slow).toBe(true);
    expect(eta.remainingMs).toBeNull();
    expect(eta.pct).toBeLessThan(100);
    expect(eta.backupAtMs).toBe(HEDGE_AFTER_MS.strategy);
  });

  it("with a backup running: the time left is the backup's", () => {
    const at = T0 + 4000;
    const eta = runEta(strategyJob({ pendingAt: at, hedgeAt: at + 15 * min }), at + 16 * min)!;
    expect(eta.backup).toEqual({ model: "openai:gpt-5.5", elapsedMs: min });
    expect(eta.slow).toBe(false);
    expect(eta.remainingMs!).toBeGreaterThan(min);
    expect(eta.remainingMs!).toBeLessThan(4 * min);
    expect(eta.backupAtMs).toBeNull();
  });

  it("a whole build: the blocks a 12-week run usually has before the strategy says, finished runs have none", () => {
    const job: RunJob = {
      status: "pending",
      kind: "generate",
      stage: "context",
      created_at: new Date(T0).toISOString(),
      progress: {
        stages: [
          { key: "context", status: "running" },
          { key: "strategy", status: "pending" },
          { key: "construct:0", status: "pending" },
          { key: "audit", status: "pending" },
          { key: "review", status: "pending" },
          { key: "save", status: "pending" },
        ],
        current: "context",
      },
      result: { setup: { weeks: 12 } },
    };
    const eta = runEta(job, T0 + 1000)!;
    // strategy + three blocks + audit + review + save: well over the strategy alone
    expect(eta.remainingMs!).toBeGreaterThan(13 * min);
    expect(runEta({ ...job, status: "ready" }, T0)).toBeNull();
  });

  it("a measured median wins over the defaults, and the strategy scales with the brief", () => {
    const typical = measuredTypical([
      { stage: "strategy", model: "openai:gpt-6-astra", ok: true, duration_ms: 400_000 },
      { stage: "strategy (retry)", model: "openai:gpt-6-astra", ok: true, duration_ms: 420_000 },
      { stage: "strategy", model: "openai:gpt-6-astra", ok: true, duration_ms: 440_000 },
      { stage: "strategy", model: "openai:gpt-6-astra", ok: false, duration_ms: 2_000_000 },
      { stage: "construct:0", model: "gateway:openai/gpt-5.5", ok: true, duration_ms: 50_000 },
      { stage: "construct:1", model: "gateway:openai/gpt-5.5", ok: true, duration_ms: 60_000 },
      { stage: "construct:2", model: "openai:gpt-5.5", ok: true, duration_ms: 70_000 },
    ]);
    expect(typical).toEqual({ "openai:gpt-6-astra": { strategy: 420_000 }, "openai:gpt-5.5": { construct: 60_000 } });
    expect(typicalMs("strategy", "openai:gpt-6-astra", { typical })).toBe(426_000);
    expect(typicalMs("strategy", "openai:gpt-6-astra", { typical, scale: 1.2 })).toBe(510_000);
    expect(briefScale(164_000)).toBe(1);
    expect(briefScale(1_000_000)).toBe(1.5);
    expect(briefScale(10_000)).toBe(0.8);
    expect(stepOf("repair:block 2:1")).toBe("repair");
  });

  it("words a coach reads", () => {
    expect(modelName("openai:gpt-6-astra")).toBe("GPT-6 Astra");
    expect(modelName("gateway:openai/gpt-5.5")).toBe("GPT-5.5");
    expect(durationWords(30_000)).toBe("under a minute");
    expect(durationWords(6 * min)).toBe("about 6 min");
    expect(durationWords(65 * min)).toBe("about 1 h 5 min");
    expect(elapsedWords(12 * min + 5000)).toBe("12 min");
  });
});

describe("routes never reach the Lovable gateway outside a benchmark", () => {
  it("an override naming a gateway model is dropped; the defaults (OpenAI) stand", () => {
    const override = { strategy: ["gateway:openai/gpt-5.5"], construct: ["gateway:google/gemini-3-flash-preview", "openai:gpt-5.5"] };
    expect(resolveRoute("strategy", override, { openaiOnly: true }).models).toEqual(["openai:gpt-6-astra", "openai:gpt-5.5"]);
    expect(resolveRoute("construct", override, { openaiOnly: true }).models).toEqual(["openai:gpt-5.5"]);
    for (const t of ["strategy", "construct", "repair", "review", "interpret"] as const)
      expect(resolveRoute(t, null, { openaiOnly: true }).models.every((m) => m.startsWith("openai:"))).toBe(true);
    // a benchmark compares models on purpose
    expect(resolveRoute("strategy", override, { anyModel: true }).models).toEqual(["gateway:openai/gpt-5.5"]);
  });

  it("the generator and the interpret job ask for it", () => {
    const pipeline = readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8");
    expect(pipeline).toContain("openaiOnly: !job.options?.bench");
    expect(pipeline).toContain("hedgeAfterMs: job.options?.bench ? undefined : HEDGE_AFTER_MS[stepOf(key)]");
    const jobs = readFileSync("src/lib/program-intel/jobs.server.ts", "utf8");
    expect(jobs).toContain('resolveRoute("interpret", override, { openaiOnly: true })');
  });
});

describe("a run whose request was cut off", () => {
  it("is picked up within minutes (2 on a model stage), looked for every minute", () => {
    const jobs = readFileSync("src/lib/program-intel/jobs.server.ts", "utf8");
    expect(jobs).toContain("const STALE_MODEL_STAGE_MS = 2 * 60_000;");
    expect(jobs).toContain("if (workerGuards.quarterRush && inQuarterRush(Date.now())) return null;");
    // a run cut off at its last attempt stops with Try again instead of spinning forever
    expect(jobs).toContain("await stopStuckRuns(admin)");
    // a run discarded meanwhile stays discarded
    expect(jobs).toContain('.eq("id", job.id).eq("status", "running");');
    const sql = readFileSync("supabase/migrations/20270516090000_program_runs_never_stranded.sql", "utf8");
    expect(sql).toContain("'* * * * *'");
    expect(sql).toContain("updated_at < now() - interval '2 minutes'");
  });

  it("never holds a request through the quarter-hour rush", () => {
    const at = (hms: string) => Date.parse(`2026-11-23T${hms}Z`);
    expect(inQuarterRush(at("17:14:55"))).toBe(true);
    expect(inQuarterRush(at("17:15:20"))).toBe(true);
    expect(inQuarterRush(at("17:15:30"))).toBe(false);
    expect(inQuarterRush(at("17:14:40"))).toBe(false);
    expect(inQuarterRush(at("16:59:59"))).toBe(true);
    // a poll ends before the next rush, never past 45 s, never under 3 s
    expect(pollWindowMs(at("17:10:00"), 45_000)).toBe(45_000);
    expect(pollWindowMs(at("17:14:20"), 45_000)).toBe(30_000);
    expect(pollWindowMs(at("17:14:48"), 45_000)).toBe(3_000);
  });
});

describe("a backup beside a strong model that's far slower than usual", () => {
  type St = { status: "running" } | { status: "done"; reply: { text: string; usage: any } } | { status: "failed"; error: string };
  let statuses: Record<string, St>;
  let submitted: string[];
  let cancelled: string[];
  beforeEach(() => {
    vi.resetModules();
    statuses = {};
    submitted = [];
    cancelled = [];
    vi.doMock("@/lib/ai/model-client.server", () => ({
      ModelHttpError: class extends Error {},
      parseModelRef: (m: string) => ({ via: m.split(":")[0], id: m.split(":")[1] }),
      submitBackground: async (m: string) => {
        submitted.push(m);
        return { id: `resp-${m}` };
      },
      pollBackground: async (id: string) => statuses[id] ?? { status: "running" },
      cancelBackground: async (id: string) => {
        cancelled.push(id);
      },
      callModel: async () => {
        throw new Error("not used");
      },
    }));
    vi.doMock("@/lib/ai/ai-health.server", () => ({ recordAiCall: async () => undefined }));
  });
  const route = { models: ["openai:gpt-6-astra", "openai:gpt-5.5"], effort: "high", strongOnly: true, task: "strategy" } as any;
  const opts = (state: any) => ({
    state,
    key: "strategy",
    route,
    req: { system: "s", prompt: "p", effort: "high" as const },
    save: async () => undefined,
    poll: { ms: 5, every: 1 },
    backgroundLimitMs: 25 * min,
    hedgeAfterMs: 15 * min,
    syncTimeoutMs: 1_000,
  });
  const done = (text: string): St => ({ status: "done", reply: { text, usage: { input: 1, output: 1 } } });

  it("before the hedge time: keeps waiting, nothing else is asked", async () => {
    const { stagedCall, WaitingForModel } = await import("@/lib/ai/staged-call.server");
    const state: any = { pending: { strategy: { id: "resp-openai:gpt-6-astra", model: "openai:gpt-6-astra", at: Date.now() - 10 * min, failed: [] } } };
    await expect(stagedCall(opts(state))).rejects.toBeInstanceOf(WaitingForModel);
    expect(submitted).toEqual([]);
    expect(state.pending.strategy.hedge).toBeUndefined();
  });

  it("past it: starts the next model beside it and keeps both", async () => {
    const { stagedCall, WaitingForModel } = await import("@/lib/ai/staged-call.server");
    const state: any = { pending: { strategy: { id: "resp-openai:gpt-6-astra", model: "openai:gpt-6-astra", at: Date.now() - 16 * min, failed: [] } } };
    await expect(stagedCall(opts(state))).rejects.toBeInstanceOf(WaitingForModel);
    expect(submitted).toEqual(["openai:gpt-5.5"]);
    expect(state.pending.strategy).toMatchObject({ id: "resp-openai:gpt-6-astra", hedge: { id: "resp-openai:gpt-5.5", model: "openai:gpt-5.5" } });
    expect(cancelled).toEqual([]);
  });

  it("the backup answers first: it's used and the slow one is stopped", async () => {
    const { stagedCall } = await import("@/lib/ai/staged-call.server");
    statuses["resp-b"] = done("backup answer");
    const state: any = { pending: { strategy: { id: "resp-a", model: "openai:gpt-6-astra", at: Date.now() - 18 * min, failed: [], hedge: { id: "resp-b", model: "openai:gpt-5.5", at: Date.now() - 3 * min } } } };
    const r = await stagedCall(opts(state));
    expect(r).toEqual({ text: "backup answer", model: "openai:gpt-5.5" });
    expect(cancelled).toEqual(["resp-a"]);
    expect(state.pending.strategy).toBeUndefined();
    expect(state.calls.strategy.model).toBe("openai:gpt-5.5");
  });

  it("the strong model answers first after all: it's used and the backup is stopped", async () => {
    const { stagedCall } = await import("@/lib/ai/staged-call.server");
    statuses["resp-a"] = done("astra answer");
    const state: any = { pending: { strategy: { id: "resp-a", model: "openai:gpt-6-astra", at: Date.now() - 18 * min, failed: [], hedge: { id: "resp-b", model: "openai:gpt-5.5", at: Date.now() - 3 * min } } } };
    const r = await stagedCall(opts(state));
    expect(r.model).toBe("openai:gpt-6-astra");
    expect(cancelled).toEqual(["resp-b"]);
  });

  it("past the limit with a backup running: the backup carries on as the call, nothing new is asked", async () => {
    const { stagedCall, WaitingForModel } = await import("@/lib/ai/staged-call.server");
    const state: any = { pending: { strategy: { id: "resp-a", model: "openai:gpt-6-astra", at: Date.now() - 26 * min, failed: [], hedge: { id: "resp-b", model: "openai:gpt-5.5", at: Date.now() - 11 * min } } } };
    await expect(stagedCall(opts(state))).rejects.toBeInstanceOf(WaitingForModel);
    expect(cancelled).toEqual(["resp-a"]);
    expect(submitted).toEqual([]);
    expect(state.pending.strategy).toMatchObject({ id: "resp-b", model: "openai:gpt-5.5", failed: ["openai:gpt-6-astra"] });
    expect(state.pending.strategy.hedge).toBeUndefined();
  });

  it("a call stopped from outside (the run discarded) is never replaced by the next model", async () => {
    const { stagedCall } = await import("@/lib/ai/staged-call.server");
    statuses["resp-a"] = { status: "failed", error: "cancelled: " };
    const state: any = { pending: { strategy: { id: "resp-a", model: "openai:gpt-6-astra", at: Date.now() - 2 * min, failed: [] } } };
    await expect(stagedCall(opts(state))).rejects.toThrow("stopped");
    expect(submitted).toEqual([]);
  });

  it("without a hedge time (the Nutrition Update AI): unchanged, it waits out the limit", async () => {
    const { stagedCall, WaitingForModel } = await import("@/lib/ai/staged-call.server");
    const state: any = { pending: { strategy: { id: "resp-a", model: "openai:gpt-6-astra", at: Date.now() - 20 * min, failed: [] } } };
    await expect(stagedCall({ ...opts(state), hedgeAfterMs: undefined })).rejects.toBeInstanceOf(WaitingForModel);
    expect(submitted).toEqual([]);
  });
});

describe("a call OpenAI hasn't started yet", () => {
  it("says it's waiting in their queue, with no made-up time once it's been a minute", () => {
    const at = T0 + 4000;
    const job = strategyJob({ pendingAt: at });
    job.result.pending.strategy.phase = "queued";
    const early = runEta(job, at + 20_000)!;
    expect(early.queuedMs).toBe(20_000);
    expect(early.remainingMs).not.toBeNull();
    const late = runEta(job, at + 3 * min)!;
    expect(late.queuedMs).toBe(3 * min);
    expect(late.remainingMs).toBeNull();
    // once OpenAI starts it, the model's own time runs from then
    job.result.pending.strategy.phase = "in_progress";
    job.result.pending.strategy.startedAt = at + 3 * min;
    const thinking = runEta(job, at + 4 * min)!;
    expect(thinking.queuedMs).toBeNull();
    expect(thinking.stepElapsedMs).toBe(min);
  });
});

describe("the route's last model", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/ai/model-client.server", () => ({
      ModelHttpError: class extends Error {},
      parseModelRef: (m: string) => ({ via: m.split(":")[0], id: m.split(":")[1] }),
      submitBackground: async () => {
        throw new Error("nothing should be submitted");
      },
      pollBackground: async () => ({ status: "running", phase: "in_progress" }),
      cancelBackground: async () => undefined,
      callModel: async () => {
        throw new Error("not used");
      },
    }));
    vi.doMock("@/lib/ai/ai-health.server", () => ({ recordAiCall: async () => undefined }));
  });
  const route = { models: ["openai:gpt-6-astra", "openai:gpt-5.5"], effort: "high", strongOnly: true, task: "strategy" } as any;
  const base = (state: any) => ({
    state,
    key: "strategy",
    route,
    req: { system: "s", prompt: "p", effort: "high" as const },
    save: async () => undefined,
    poll: { ms: 5, every: 1 },
    backgroundLimitMs: 25 * min,
    finalLimitMs: 45 * min,
    hedgeAfterMs: 15 * min,
    syncTimeoutMs: 1_000,
  });
  it("is waited on past the usual limit when nothing could take over (giving up would only fail the run)", async () => {
    const { stagedCall, WaitingForModel } = await import("@/lib/ai/staged-call.server");
    const state: any = { pending: { strategy: { id: "resp-b", model: "openai:gpt-5.5", at: Date.now() - 30 * min, failed: ["openai:gpt-6-astra"] } } };
    await expect(stagedCall(base(state))).rejects.toBeInstanceOf(WaitingForModel);
    expect(state.pending.strategy.id).toBe("resp-b");
    // and keeps what OpenAI says it's doing
    expect(state.pending.strategy.phase).toBe("in_progress");
  });
  it("but never forever: past the final limit the run stops and says so", async () => {
    const { stagedCall, ModelsExhausted } = await import("@/lib/ai/staged-call.server");
    const state: any = { pending: { strategy: { id: "resp-b", model: "openai:gpt-5.5", at: Date.now() - 46 * min, failed: ["openai:gpt-6-astra"] } } };
    await expect(stagedCall(base(state))).rejects.toBeInstanceOf(ModelsExhausted);
  });
});

describe("run-eta on the route's last model", () => {
  it("never promises a backup when the other model already failed", () => {
    const at = T0 + 30 * min;
    const job = strategyJob({ pendingAt: at });
    job.result.pending.strategy.model = "openai:gpt-5.5";
    job.result.pending.strategy.failed = ["openai:gpt-6-astra"];
    const eta = runEta(job, at + 12 * min)!;
    expect(eta.slow).toBe(true);
    expect(eta.backupAtMs).toBeNull();
    expect(eta.model).toBe("openai:gpt-5.5");
  });
});

describe("Edit with AI's progress", () => {
  it("follows its real stages and the model's usual time, honest once it runs long", async () => {
    const { editEta } = await import("@/lib/program-intel/run-eta");
    const c = new Date(T0).toISOString();
    expect(editEta("Reading the program", c, T0 + 2000).pct).toBeLessThan(10);
    const mid = editEta("Thinking it through", c, T0 + 45_000);
    expect(mid.pct).toBeGreaterThan(40);
    expect(mid.pct).toBeLessThan(60);
    expect(mid.remainingMs).toBe(45_000);
    const late = editEta("Thinking it through", c, T0 + 3 * min);
    expect(late.slow).toBe(true);
    expect(late.remainingMs).toBeNull();
    expect(late.pct).toBeLessThan(86);
    expect(editEta("Checking the changes", c, T0 + 80_000).pct).toBeGreaterThanOrEqual(93);
  });
});
