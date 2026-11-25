/**
 * "Write a new version" on a Competition assessment: what the coach sees while Cleo writes it
 * (rewrite-progress.ts). The cases are the worker's real states, the last one stored as it was on
 * Nov 25 2026 (the coach's "The game plan is 66kg. 74kg isn't an option": drafted, sent back for a
 * second pass, then refused by the AI-permission check).
 */
import { describe, expect, it } from "vitest";
import {
  CLAIM_MS,
  DEFAULT_TYPICAL,
  FINISH_MS,
  READ_MS,
  RETRY_AFTER_MS,
  inFlight,
  isProviderWait,
  leftWords,
  liveFromProgress,
  medianMs,
  rewriteView,
  type LiveRewrite,
} from "@/lib/competition/rewrite-progress";

const T0 = Date.parse("2026-11-25T19:13:42Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const typical = { write: 158_000, write2: 244_000 };

function live(over: Partial<LiveRewrite> = {}): LiveRewrite {
  return {
    milestoneId: "m1",
    kind: "confirm",
    status: "scheduled",
    attempts: 0,
    lastError: null,
    why: "Changes requested",
    updatedAt: at(0),
    lockedAt: null,
    done: [],
    pending: null,
    request: {
      assessmentId: "a1",
      version: 1,
      note: "The game plan is 66kg. 74kg isn't an option",
      at: at(0),
    },
    ...over,
  };
}

describe("rewriteView", () => {
  it("says it was sent at once, with the usual time for the whole run", () => {
    const v = rewriteView(live(), T0 + 5_000, typical);
    expect(v.phase).toBe("queued");
    expect(v.step).toBe("sent");
    expect(v.steps.map((s) => [s.key, s.state])).toEqual([
      ["sent", "now"],
      ["reading", "todo"],
      ["writing", "todo"],
      ["checking", "todo"],
      ["ready", "todo"],
    ]);
    expect(v.steps[0].label).toBe("Sent");
    expect(v.doing).toBe("Sent to Cleo. Starting in a moment.");
    // 30 s of the claim left + reading + Cleo's median + finishing ≈ 4 min
    const left = CLAIM_MS - 5_000 + READ_MS + typical.write + FINISH_MS;
    expect(v.time).toBe(leftWords(left));
    expect(v.time).toBe("About 4 min left");
    expect(v.share).toBeGreaterThan(0);
    expect(v.share).toBeLessThan(0.2);
  });

  it("a run nobody asked for starts as queued, not sent", () => {
    const v = rewriteView(live({ request: null }), T0, typical);
    expect(v.steps[0].label).toBe("Queued");
    expect(v.doing).toBe("Queued. Cleo starts in a moment.");
  });

  it("reading the records once the worker has it", () => {
    const v = rewriteView(
      live({ status: "generating", lockedAt: at(30), attempts: 1 }),
      T0 + 35_000,
      typical,
    );
    expect(v.phase).toBe("reading");
    expect(v.steps.map((s) => s.state)).toEqual(["done", "now", "todo", "todo", "todo"]);
  });

  it("writing: time left counts down from Cleo's median, the bar moves on and never fills", () => {
    const pending = {
      key: "write",
      model: "openai:gpt-6.2-astra",
      phase: "in_progress",
      submittedAt: T0 + 40_000,
      startedAt: T0 + 42_000,
    };
    const early = rewriteView(live({ status: "waiting_ai", pending }), T0 + 70_000, typical);
    const later = rewriteView(live({ status: "generating", pending }), T0 + 160_000, typical);
    expect(early.phase).toBe("writing");
    expect(early.doing).toBe("Cleo is writing the new version with your changes");
    expect(early.time).toBe("About 3 min left");
    expect(later.time).toBe("About 1 min left");
    expect(later.share!).toBeGreaterThan(early.share!);
    expect(later.share!).toBeLessThanOrEqual(0.95);
  });

  it("past its usual length it says how long it's been, never a made-up time", () => {
    const pending = {
      key: "write",
      model: "x",
      phase: "in_progress",
      submittedAt: T0,
      startedAt: T0,
    };
    const v = rewriteView(live({ status: "waiting_ai", pending }), T0 + 9 * 60_000, typical);
    expect(v.slow).toBe(true);
    expect(v.time).toBe("Taking longer than usual · 9 min so far");
    expect(v.share).toBeLessThan(0.95);
  });

  it("waiting for a slot at OpenAI is its own line", () => {
    const pending = { key: "write", model: "x", phase: "queued", submittedAt: T0, startedAt: null };
    const v = rewriteView(live({ status: "waiting_ai", pending }), T0 + 90_000, typical);
    expect(v.phase).toBe("openai_queue");
    expect(v.doing).toBe("Waiting for a slot at OpenAI");
    expect(v.time).toBe("Waiting 1 min");
  });

  it("a second pass shows as checking, says why, and adds its own usual time", () => {
    const pending = {
      key: "write2",
      model: "x",
      phase: "in_progress",
      submittedAt: T0 + 180_000,
      startedAt: T0 + 220_000,
    };
    const v = rewriteView(
      live({ status: "waiting_ai", done: ["write"], pending }),
      T0 + 240_000,
      typical,
    );
    expect(v.phase).toBe("second_pass");
    expect(v.step).toBe("checking");
    expect(v.steps.map((s) => s.state)).toEqual(["done", "done", "done", "now", "todo"]);
    expect(v.doing).toBe("Some numbers didn't match the records. Cleo is correcting them.");
    expect(v.time).toBe("About 4 min left");
  });

  it("between the draft and saving it: checking, under a minute", () => {
    const v = rewriteView(live({ status: "generating", done: ["write"] }), T0 + 200_000, typical);
    expect(v.phase).toBe("checking");
    expect(v.time).toBe("Under a minute left");
  });

  it("OpenAI down: waiting, no time promised, the reason said", () => {
    const v = rewriteView(
      live({
        status: "waiting_ai",
        lastError: "Waiting for AI: OpenAI is out of credits",
        updatedAt: at(0),
      }),
      T0 + 5 * 60_000,
      typical,
    );
    expect(v.phase).toBe("waiting_ai");
    expect(v.share).toBeNull();
    expect(v.time).toBe("Waiting 5 min");
    expect(v.error).toBe("OpenAI is out of credits");
  });

  it("failed: the reason, when it tries again by itself, and Try again", () => {
    const err = "Jared hasn't allowed their data to be sent to AI services";
    const v = rewriteView(
      live({ status: "failed", attempts: 1, lastError: err, updatedAt: at(320), done: ["write"] }),
      T0 + 330_000,
      typical,
    );
    expect(v.phase).toBe("failed");
    expect(v.error).toBe(err);
    expect(v.canRetry).toBe(true);
    expect(v.retryAt).toBe(T0 + 320_000 + RETRY_AFTER_MS);
    expect(v.share).toBeNull();
  });

  it("stopped after three tries: no retry by itself, Try again still offered", () => {
    const v = rewriteView(live({ status: "failed", attempts: 3, lastError: "x" }), T0, typical);
    expect(v.phase).toBe("stopped");
    expect(v.retryAt).toBeNull();
    expect(v.canRetry).toBe(true);
  });

  it("with nothing measured it uses the defaults", () => {
    const v = rewriteView(live(), T0, { write: 0, write2: 0 });
    const left = CLAIM_MS + READ_MS + DEFAULT_TYPICAL.write + FINISH_MS;
    expect(v.time).toBe(leftWords(left));
  });
});

describe("liveFromProgress", () => {
  it("reads only where the call stands, never the answers' text (the stored Nov 25 run)", () => {
    const stored = {
      calls: { write: { text: "{…a long draft…}", model: "openai:gpt-6.2-astra" } },
      pending: {
        write2: {
          at: 1795634202954,
          id: "resp_0177f9d523aef6cf006b07341b14ec87d0bbb732524a2aa3a5",
          model: "openai:gpt-6.2-astra",
          phase: "in_progress",
          failed: [],
          startedAt: 1795634243890,
        },
      },
    };
    const r = liveFromProgress(stored);
    expect(r).toEqual({
      done: ["write"],
      pending: {
        key: "write2",
        model: "openai:gpt-6.2-astra",
        phase: "in_progress",
        submittedAt: 1795634202954,
        startedAt: 1795634243890,
      },
    });
    expect(JSON.stringify(r)).not.toContain("long draft");
  });

  it("nothing stored: nothing done, nothing pending", () => {
    expect(liveFromProgress(null)).toEqual({ done: [], pending: null });
  });
});

describe("helpers", () => {
  it("medianMs", () => {
    expect(medianMs([158311, 482451, 100000])).toBe(158311);
    expect(medianMs([1, 3])).toBe(2);
    expect(medianMs([])).toBeNull();
  });
  it("in flight and provider waits", () => {
    expect(inFlight("generating")).toBe(true);
    expect(inFlight("ready")).toBe(false);
    expect(isProviderWait({ status: "waiting_ai", lastError: "Waiting for AI: down" })).toBe(true);
    expect(isProviderWait({ status: "waiting_ai", lastError: null })).toBe(false);
  });
});
