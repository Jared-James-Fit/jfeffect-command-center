/**
 * AI reliability (Nov 23 2026): which failures are the provider's, what a call costs, when usage
 * is unusual, that a recap the model didn't write is never a reply, and that a dead key's other
 * models are never asked. The database half (ai_error_is_provider, ai_recovery_requeue, the deck
 * writer's budget) is supabase/tests/ai-reliability.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiUnavailableError,
  aiFailureWords,
  classifyAiError,
  isProviderFailure,
  isProviderFailureText,
  isProviderFailureWords,
  retryDelayMs,
} from "@/lib/ai/ai-errors";
import { callCost, featureName, priceKeyOf, unusualUsage } from "@/lib/ai/ai-usage";
import { heldBack, type Health } from "@/lib/ai/ai-health.server";
import {
  readRecapAnswer,
  isStandInRecap,
  FALLBACK_RECAP_SUMMARY,
} from "@/lib/messenger-checkins.functions";
import { queueBand } from "@/components/recovery/recovery-queue";

describe("which failures are the provider's", () => {
  // the same cases as supabase/tests/ai-reliability/scenario.sql's ai_error_is_provider
  const cases: [string, boolean][] = [
    [
      'No model answered (openai:gpt-5-mini: 429 {"error": {"message": "You have no credits remaining. Add credits to continue"',
      true,
    ],
    ["Couldn't make it: OpenAI gpt-5.1: You have no credits remaining.", true],
    ["AI is paused: OpenAI says the account has no credits left.", true],
    ["Waiting for AI: OpenAI credits ran out", true],
    ['openai:gpt-5.5: 503 {"error":"overloaded"}', true],
    ['401 {"error":{"code":"invalid_api_key"}}', true],
    [
      "No model answered. The OpenAI account has no credits left: add credits at platform.openai.com (billing).",
      true,
    ],
    ["Couldn't write a draft. Try again.", false],
    ["No draft passed the checks and the editor", false],
    ["The answer said 500 kcal for lunch", false],
    ["openai:gpt-5-mini: 429 Rate limit reached for requests", false],
  ];
  it.each(cases)("%s → %s", (text, provider) => {
    expect(isProviderFailureText(text)).toBe(provider);
  });

  it("names the kind", () => {
    expect(classifyAiError(new Error("429 insufficient_quota"))).toBe("credits");
    expect(classifyAiError(new AiUnavailableError("openai", "credits"))).toBe("paused");
    expect(classifyAiError(new Error("openai:gpt-5-mini: 429 Rate limit reached"))).toBe("rate");
    expect(classifyAiError(new Error("openai:gpt-5.5: no answer within 45s"))).toBe("timeout");
    expect(classifyAiError(new Error("OPENAI_API_KEY is not configured."))).toBe("auth");
    expect(classifyAiError(new Error("fetch failed"))).toBe("outage");
    expect(classifyAiError(new Error("openai:gpt-5-mini: empty answer"))).toBe("answer");
    expect(classifyAiError(new Error("Cannot read properties of undefined"))).toBe("other");
  });

  it("only the provider's failures are parked; everything else gets its own few tries, never forever", () => {
    expect(["credits", "auth", "outage", "paused"].every((k) => isProviderFailure(k as any))).toBe(
      true,
    );
    expect(["rate", "timeout", "answer", "other"].some((k) => isProviderFailure(k as any))).toBe(
      false,
    );
    expect(retryDelayMs("credits", 1)).toBeNull();
    expect(retryDelayMs("rate", 1)).toBe(60_000);
    expect(retryDelayMs("timeout", 2)).toBe(240_000);
    expect(retryDelayMs("answer", 3)).toBeNull();
  });

  it("reads our own stored words back (a recap's ai_error)", () => {
    expect(isProviderFailureWords(aiFailureWords("credits"))).toBe(true);
    expect(isProviderFailureWords(aiFailureWords("paused"))).toBe(true);
    expect(isProviderFailureWords(aiFailureWords("answer"))).toBe(false);
    expect(isProviderFailureWords("Couldn't write the recap: boom")).toBe(false);
  });
});

describe("what a call costs", () => {
  it("published rates only, cached input at its own rate", () => {
    expect(callCost("openai:gpt-5.5", { input: 10_000, output: 2_000 })).toBe(0.11);
    expect(callCost("openai:gpt-5.5", { input: 10_000, cached: 8_000, output: 2_000 })).toBe(0.074);
    expect(callCost("openai:gpt-5-mini", { input: 3_000, output: 800 })).toBe(0.00235);
    expect(
      callCost("gateway:google/gemini-3-flash-preview", { input: 3_000, output: 800 }),
    ).toBeNull();
    expect(callCost("openai:gpt-5.5", { input: null, output: 10 })).toBeNull();
  });
  it("a dated snapshot is priced like its model", () => {
    expect(priceKeyOf("openai:gpt-5-mini-2025-08-07")).toBe("gpt-5-mini");
    expect(priceKeyOf("gateway:openai/gpt-5.5")).toBe("gpt-5.5");
  });
  it("features read as the coach would name them", () => {
    expect(featureName("recovery_write:workout")).toBe("Coaching queue · workout replies");
    expect(featureName("checkin_recap")).toBe("Check-in recaps");
    expect(featureName("something_new")).toBe("something_new");
  });
});

describe("unusual usage", () => {
  const usual = Array.from({ length: 14 }, () => ({ cost: 1.2, calls: 80 }));
  it("three times the usual spend, past a floor", () => {
    expect(unusualUsage({ cost: 4.1, calls: 90 }, usual).unusual).toBe(true);
    expect(unusualUsage({ cost: 2.5, calls: 90 }, usual).unusual).toBe(false);
  });
  it("a few cents more on a quiet day is never an alert", () => {
    expect(
      unusualUsage(
        { cost: 0.4, calls: 30 },
        Array.from({ length: 14 }, () => ({ cost: 0.02, calls: 3 })),
      ).unusual,
    ).toBe(false);
  });
  it("a runaway loop shows in the calls even when it's cheap", () => {
    const r = unusualUsage({ cost: 0.9, calls: 2_400 }, usual);
    expect(r.unusual).toBe(true);
    expect(r.why).toMatch(/2400 calls/);
  });
});

describe("the circuit breaker", () => {
  const h = (status: Health["status"], next: number | null): Health => ({
    provider: "openai",
    status,
    since: null,
    last_ok_at: null,
    last_failure_at: null,
    last_failure: null,
    failures_in_row: 0,
    next_probe_at: next == null ? null : new Date(Date.now() + next).toISOString(),
    recovered_at: null,
    recovery_done_at: null,
    alerted_at: null,
  });
  it("holds calls back while a provider is down, until its probe is due", () => {
    expect(heldBack(h("ok", null))).toBe(false);
    expect(heldBack(h("credits", 5 * 60_000))).toBe(true);
    expect(heldBack(h("credits", -1_000))).toBe(false);
  });
});

describe("a check-in recap the model didn't write", () => {
  it("is never a reply: a missing summary or reply is a failed recap, not one filled from a template", () => {
    expect(
      readRecapAnswer(
        '{"summary":"Solid week","wins":["5/5 workouts"],"suggested_response":"great week, keep it going"}',
      ),
    ).toMatchObject({ analysis: { summary: "Solid week", wins: ["5/5 workouts"] } });
    expect(readRecapAnswer('{"summary":"Solid week","wins":[]}')).toEqual({ failure: "answer" });
    expect(readRecapAnswer('{"suggested_response":"good update"}')).toEqual({ failure: "answer" });
    expect(readRecapAnswer("not json")).toEqual({ failure: "answer" });
    expect(
      readRecapAnswer('```json\n{"summary":"s","suggested_response":"r","urgency":"loud"}\n```'),
    ).toMatchObject({ analysis: { urgency: "normal", focus: [] } });
  });
  it("a stand-in is known by its flag or, from before Nov 23, by its summary", () => {
    expect(isStandInRecap({ fallback: true, summary: "x" })).toBe(true);
    expect(
      isStandInRecap({
        summary: FALLBACK_RECAP_SUMMARY,
        suggested_response: "good update. keep the basics tight",
      }),
    ).toBe(true);
    expect(isStandInRecap({ summary: "Solid week", suggested_response: "great" })).toBe(false);
    expect(isStandInRecap(null)).toBe(false);
  });
});

describe("the coaching queue's order", () => {
  it("what could be serious, then judgment calls and what needs his eyes, then routine, then what couldn't be written", () => {
    expect(
      queueBand({ status: "awaiting_approval", risk: "urgent", category: "workout_reply" } as any),
    ).toBe(0);
    expect(
      queueBand({ status: "awaiting_approval", risk: "review", category: "checkin_reply" } as any),
    ).toBe(1);
    expect(
      queueBand({ status: "awaiting_approval", risk: "routine", category: "video_reply" } as any),
    ).toBe(1);
    expect(
      queueBand({ status: "awaiting_approval", risk: "routine", category: "workout_reply" } as any),
    ).toBe(2);
    expect(queueBand({ status: "failed", risk: "urgent", category: "workout_reply" } as any)).toBe(
      3,
    );
  });
});

describe("a dead key's other models are never asked", () => {
  const asked: string[] = [];
  let fail: (model: string) => Error | null = () => null;
  beforeEach(() => {
    asked.length = 0;
    vi.resetModules();
    vi.doMock("@/lib/ai/model-client.server", () => ({
      callModelNow: async (model: string) => {
        asked.push(model);
        const e = fail(model);
        if (e) throw e;
        return { text: "ok", model, usage: { input: 1, output: 1, reasoning: null }, ms: 1 };
      },
    }));
  });

  it("credits out on the first OpenAI model: the second isn't asked", async () => {
    fail = () => new Error('openai:gpt-5-mini: 429 {"error":{"type":"insufficient_quota"}}');
    const { askRoute, RouteExhausted } = await import("@/lib/ai/route-call.server");
    await expect(
      askRoute("coach_write", { system: "s", prompt: "p" }, { override: null }),
    ).rejects.toBeInstanceOf(RouteExhausted);
    expect(asked).toEqual(["openai:gpt-5-mini"]);
  });

  it("a slow first model still falls back to the second", async () => {
    fail = (m) =>
      m === "openai:gpt-5-mini" ? new Error("openai:gpt-5-mini: no answer within 45s") : null;
    const { askRoute } = await import("@/lib/ai/route-call.server");
    const r = await askRoute("coach_write", { system: "s", prompt: "p" }, { override: null });
    expect(r.model).toBe("openai:gpt-5.5");
    expect(asked).toEqual(["openai:gpt-5-mini", "openai:gpt-5.5"]);
  });

  it("paused by the breaker: says so (the job parks), one refusal, no request made", async () => {
    fail = () => new AiUnavailableError("openai", "credits");
    const { askRoute } = await import("@/lib/ai/route-call.server");
    await expect(
      askRoute("coach_write", { system: "s", prompt: "p" }, { override: null }),
    ).rejects.toMatchObject({ name: "AiUnavailableError" });
    expect(asked).toEqual(["openai:gpt-5-mini"]);
  });
});

describe("a staged call after an outage", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it("forgets the models the provider's failure stopped, so the redo asks them again", async () => {
    let credits = true;
    const submitted: string[] = [];
    vi.doMock("@/lib/ai/model-client.server", () => ({
      ModelHttpError: class extends Error {},
      parseModelRef: (m: string) => ({ via: m.split(":")[0], id: m.split(":")[1] }),
      submitBackground: async (m: string) => {
        submitted.push(m);
        if (credits)
          throw new Error(
            `${m}: 429 {"error":{"type":"insufficient_quota","message":"You have no credits remaining"}}`,
          );
        return { id: `resp-${m}` };
      },
      pollBackground: async () => ({
        status: "done",
        reply: { text: "answer", usage: { input: 1, output: 1, reasoning: null } },
      }),
      cancelBackground: async () => undefined,
      callModel: async () => {
        throw new Error("not used");
      },
    }));
    vi.doMock("@/lib/ai/ai-health.server", () => ({ recordAiCall: async () => undefined }));
    const { stagedCall, ModelsExhausted } = await import("@/lib/ai/staged-call.server");
    const state: any = {};
    const route = {
      models: ["openai:gpt-6-astra", "openai:gpt-5.5"],
      effort: "medium",
      strongOnly: true,
      task: "nutrition",
    } as any;
    const opts = {
      state,
      key: "targets",
      route,
      req: { system: "s", prompt: "p", effort: "medium" as const },
      save: async () => undefined,
      poll: { ms: 10, every: 1 },
      backgroundLimitMs: 60_000,
      syncTimeoutMs: 1_000,
    };
    await expect(stagedCall(opts)).rejects.toBeInstanceOf(ModelsExhausted);
    expect(submitted).toEqual(["openai:gpt-6-astra"]); // the second model on the same key isn't asked
    expect(state.pending.targets.failed).toEqual([]); // and nothing is remembered as this model's fault
    credits = false;
    const r = await stagedCall(opts);
    expect(r).toEqual({ text: "answer", model: "openai:gpt-6-astra" });
  });
});
