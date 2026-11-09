import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel, estimateCost, parseModelRef } from "@/lib/ai/model-client.server";

/**
 * The model client against a stubbed network: every provider path builds the request each
 * model accepts and reads its reply (the worker tests mock this module away, so this is the
 * only place that would catch a missing or malformed path).
 */
type Seen = { url: string; body: any; headers: Record<string, string> };
let seen: Seen[] = [];
let replies: Array<(url: string) => unknown> = [];

beforeEach(() => {
  seen = [];
  replies = [];
  vi.stubEnv("LOVABLE_API_KEY", "lov");
  vi.stubEnv("OPENAI_API_KEY", "oa");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      seen.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers ?? {} });
      const next = replies.shift();
      const json = next ? next(url) : {};
      return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("model client", () => {
  it("reads model refs", () => {
    expect(parseModelRef("openai:gpt-6-astra")).toMatchObject({ via: "openai", id: "gpt-6-astra" });
    expect(parseModelRef("gateway:anthropic/claude-opus-5-5")).toMatchObject({ via: "gateway", family: "anthropic", id: "anthropic/claude-opus-5-5" });
    expect(parseModelRef("gateway:google/gemini-3-flash-preview")).toMatchObject({ via: "gateway", family: "google" });
  });

  it("OpenAI and Google through the gateway: chat completions, effort only for reasoning models", async () => {
    replies.push(() => ({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } } }));
    const a = await callModel("gateway:openai/gpt-5.5", { system: "s", prompt: "p", effort: "high", maxOutputTokens: 1000 });
    expect(a.text).toBe("hi");
    expect(a.usage).toEqual({ input: 10, output: 5, reasoning: 2 });
    expect(seen[0].url).toMatch(/\/chat\/completions$/);
    expect(seen[0].body).toMatchObject({ model: "openai/gpt-5.5", reasoning_effort: "high", max_completion_tokens: 1000 });

    replies.push(() => ({ choices: [{ message: { content: "ok" } }] }));
    const g = await callModel("gateway:google/gemini-3-flash-preview", { system: "s", prompt: "p", effort: "low", temperature: 0.2, maxOutputTokens: 500 });
    expect(g.text).toBe("ok");
    expect(seen[1].body).toMatchObject({ temperature: 0.2, max_tokens: 500 });
    expect(seen[1].body.reasoning_effort).toBeUndefined();
  });

  it("Claude through the gateway: native Messages, adaptive thinking and effort, never a budget or temperature", async () => {
    replies.push(() => ({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } }));
    const c = await callModel("gateway:anthropic/claude-opus-5-5", { system: "s", prompt: "p", effort: "high", temperature: 0.3, maxOutputTokens: 4000 });
    expect(c.text).toBe("{}");
    expect(seen[0].url).toMatch(/\/messages$/);
    expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen[0].body).toMatchObject({ model: "anthropic/claude-opus-5-5", max_tokens: 4000, system: "s", thinking: { type: "adaptive" }, output_config: { effort: "high" } });
    expect(seen[0].body.temperature).toBeUndefined();
    expect(JSON.stringify(seen[0].body)).not.toContain("budget_tokens");
  });

  it("Claude declining is a failed call, not an empty answer", async () => {
    replies.push(() => ({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" } }));
    await expect(callModel("gateway:anthropic/claude-sonnet-5", { system: "s", prompt: "p" })).rejects.toThrow(/declined/);
  });

  it("OpenAI direct: submitted in background mode, then polled to the answer", async () => {
    replies.push(() => ({ id: "resp_1", status: "queued" }));
    replies.push(() => ({ id: "resp_1", status: "in_progress" }));
    replies.push(() => ({ id: "resp_1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "plan" }] }], usage: { input_tokens: 7, output_tokens: 3 } }));
    const r = await callModel("openai:gpt-6-astra", { system: "s", prompt: "p", effort: "high", maxOutputTokens: 9000, timeoutMs: 60_000 });
    expect(r.text).toBe("plan");
    expect(seen[0].url).toMatch(/\/responses$/);
    expect(seen[0].body).toMatchObject({ model: "gpt-6-astra", background: true, store: true, reasoning: { effort: "high" }, max_output_tokens: 9000 });
    expect(seen[1].url).toMatch(/\/responses\/resp_1$/);
  });

  it("streams gateway replies (no 524 on a long think): Claude's text deltas and usage", async () => {
    const sse = [
      { type: "message_start", message: { usage: { input_tokens: 90_000 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"a":' } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "1}" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1234 } },
      { type: "message_stop" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
        const text = sse.map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join("");
        return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const c = await callModel("gateway:anthropic/claude-opus-5-5", { system: "s", prompt: "p", effort: "high" });
    expect(seen[0].body.stream).toBe(true);
    expect(c.text).toBe('{"a":1}');
    expect(c.usage).toEqual({ input: 90_000, output: 1234, reasoning: null });
  });

  it("streams chat completions: deltas joined, usage from the last chunk, [DONE] ignored", async () => {
    const chunks = ['{"choices":[{"delta":{"content":"he"}}]}', '{"choices":[{"delta":{"content":"llo"}}]}', '{"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}', "[DONE]"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
        return new Response(chunks.map((c) => `data: ${c}\n\n`).join(""), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
      }),
    );
    const r = await callModel("gateway:openai/gpt-5.5", { system: "s", prompt: "p", effort: "medium" });
    expect(seen[0].body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(r.text).toBe("hello");
    expect(r.usage).toEqual({ input: 5, output: 2, reasoning: null });
  });

  it("a streamed refusal or error event is a failed call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "refusal" }, usage: { output_tokens: 0 } })}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    await expect(callModel("gateway:anthropic/claude-opus-5-5", { system: "s", prompt: "p" })).rejects.toThrow(/declined/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`data: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    await expect(callModel("gateway:anthropic/claude-opus-5-5", { system: "s", prompt: "p" })).rejects.toThrow(/Overloaded/);
  });

  it("estimates cost only from published prices", () => {
    expect(estimateCost("openai:gpt-6-astra", 100_000, 10_000)).toBe(1.5);
    expect(estimateCost("gateway:anthropic/claude-opus-5-5", 100_000, 10_000)).toBe(0.6);
    expect(estimateCost("gateway:openai/gpt-5.5", 100_000, 10_000)).toBeNull();
  });
});
