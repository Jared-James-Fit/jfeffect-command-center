/**
 * Gemini 3 rejects a tool step whose earlier tool call comes back without its
 * thought signature. Cleo's provider is named "google" so the SDK echoes it
 * (summer.server.ts answerSummer). This pins that round trip without a network.
 */
import { describe, expect, it } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

function fakeGateway() {
  const bodies: any[] = [];
  const fetch = async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    bodies.push(body);
    const first = bodies.length === 1;
    const message = first
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "body_weight", arguments: JSON.stringify({ client_id: "c1" }) },
              extra_content: { google: { thought_signature: "SIG-123" } },
            },
          ],
        }
      : { role: "assistant", content: "He's 181 lb." };
    return new Response(
      JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, message, finish_reason: first ? "tool_calls" : "stop" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { bodies, fetch };
}

async function run(name: string) {
  const g = fakeGateway();
  const provider = createOpenAICompatible({ name, baseURL: "https://gateway.test/v1", fetch: g.fetch as any });
  const result = await generateText({
    model: provider("google/gemini-3-flash-preview"),
    prompt: "What does he weigh?",
    tools: { body_weight: tool({ description: "weight", inputSchema: z.object({ client_id: z.string() }), execute: async () => "181 lb" }) },
    stopWhen: stepCountIs(3),
  });
  const echoed = g.bodies[1]?.messages?.find((m: any) => m.role === "assistant")?.tool_calls?.[0];
  return { text: result.text, signature: echoed?.extra_content?.google?.thought_signature };
}

describe("Gemini thought signatures", () => {
  it("come back on the next tool step when the provider is named google", async () => {
    const r = await run("google");
    expect(r.text).toBe("He's 181 lb.");
    expect(r.signature).toBe("SIG-123");
  });

  it("would be dropped under any other provider name (why Cleo's is named google)", async () => {
    expect((await run("lovable")).signature).toBeUndefined();
  });
});
