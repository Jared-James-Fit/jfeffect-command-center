/**
 * The run card as the coach sees it (rendered to markup): the bar, the share done and the time
 * left, what the model on the step now is doing, and Try again on a stopped run.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PipelineProgress } from "@/components/program-intel/generator/draft-view";

const min = 60_000;
function job(over: any = {}): any {
  const now = Date.now();
  return {
    id: "j1",
    kind: "strategy",
    status: "running",
    stage: "strategy",
    created_at: new Date(now - 5 * min).toISOString(),
    progress: {
      stages: [
        { key: "context", label: "Athlete data, analytics and intelligence", status: "done", detail: "982 set records, 193k characters" },
        { key: "strategy", label: "Programming strategy", status: "running", startedAt: now - 4 * min },
      ],
      current: "strategy",
    },
    result: { pending: { strategy: { id: "resp", model: "openai:gpt-6-astra", at: now - 4 * min, phase: "in_progress", startedAt: now - 4 * min } } },
    ...over,
  };
}
const html = (j: any) => renderToStaticMarkup(<PipelineProgress job={j} busy={false} onRetry={() => undefined} onDiscard={() => undefined} />);

describe("the run card", () => {
  it("working: a bar with its share, the time left and the model at work", () => {
    const h = html(job());
    expect(h).toContain('role="progressbar"');
    expect(h).toMatch(/\d+% · about \d+ min left/);
    expect(h).toContain("GPT-6 Astra thinking · 4 min (usually ~9 min)");
    expect(h).toContain("982 set records");
  });

  it("past its usual time: says so honestly, with when a backup would start", () => {
    const now = Date.now();
    const h = html(job({ result: { pending: { strategy: { id: "resp", model: "openai:gpt-6-astra", at: now - 12 * min, startedAt: now - 12 * min, phase: "in_progress" } } } }));
    expect(h).toContain("taking longer than usual");
    expect(h).toContain("If it hasn&#x27;t answered by 15 min, a second model starts beside it");
    expect(h).not.toMatch(/min left/);
  });

  it("waiting in OpenAI's queue: says that, not that the model is thinking", () => {
    const now = Date.now();
    const h = html(job({ result: { pending: { strategy: { id: "resp", model: "openai:gpt-6-astra", at: now - 3 * min, phase: "queued" } } } }));
    expect(h).toContain("Waiting for OpenAI to start GPT-6 Astra · 3 min in their queue");
    expect(h).toContain("waiting on OpenAI");
  });

  it("stopped: no bar, the reason and Try again", () => {
    const h = html(job({ status: "error", error: "The coaching model didn't answer." }));
    expect(h).not.toContain('role="progressbar"');
    expect(h).toContain("The coaching model didn&#x27;t answer.");
    expect(h).toContain("Try again");
  });
});
