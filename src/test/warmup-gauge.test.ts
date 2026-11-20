import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { suggestFinalWarmup } from "@/lib/load-suggestion";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { LoadSuggestionCard } = await import("@/components/workout-day/load-suggestion-card");

describe("suggested last warm-up", () => {
  it("single at ~90% for a top set of 1-3, double at ~87% for 4-6, ~85% for 7+, rounded DOWN to plates", () => {
    expect(suggestFinalWarmup(500, 1, "lb")).toEqual({ load: 450, reps: 1 });
    expect(suggestFinalWarmup(225, 5, "lb")).toEqual({ load: 195, reps: 2 }); // 195.75 → 195
    expect(suggestFinalWarmup(100, 8, "kg")).toEqual({ load: 85, reps: 2 });
    expect(suggestFinalWarmup(142.5, 3, "kg")).toEqual({ load: 127.5, reps: 1 });
  });
  it("never suggests nonsense", () => {
    expect(suggestFinalWarmup(0, 5, "lb")).toBeNull();
    expect(suggestFinalWarmup(100, 0, "lb")).toBeNull();
  });
});

describe("suggestion card (no warm-up row, no warm-up weight)", () => {
  const model: any = { status: "ready", unit: "lb", source: "history", historySessions: 6, history: [], today: [], readiness: { multiplier: 1, reasons: [] }, staleDays: null, warmup: null, bodyweightScale: 1 };
  const hint = { low: 215, high: 235, target: 225, unit: "lb" as const };
  const plan = { reps: 5, rpe: 6 };
  const render = (warmupReads: boolean, m = model, h: any = hint) => renderToStaticMarkup(createElement(LoadSuggestionCard, { hint: h, model: m, plan, warmupReads }));

  it("never prompts a warm-up or suggests its weight", () => {
    const html = render(true);
    expect(html).toMatch(/data-testid="load-target">225(<!-- -->)? (<!-- -->)?lb</);
    // one line: what to load and what for; the range lives behind ⓘ
    expect(html).toContain("Suggested");
    expect(html).toContain("× 5 @ 6");
    expect(html).not.toContain("215–235");
    expect(html).not.toContain('data-testid="load-badge"');
    expect(html).not.toContain("warmup-gauge");
    expect(html).not.toContain("Work up to about");
  });
  it("says when a logged warm-up tuned the number", () => {
    expect(render(true, { ...model, source: "history_warmup" })).toContain("Warm-up tuned");
    expect(render(true, { ...model, source: "warmup", historySessions: 0 })).toContain("From warm-up");
  });
  it("Suggest on but no number yet: never blank, and it waits for the first set (never a warm-up prompt)", () => {
    const html = render(true, { ...model, status: "calibrating", historySessions: 0 }, null);
    expect(html).toContain('data-testid="load-suggestion-pending"');
    expect(html).toContain("No logs of this lift yet");
    // the cell says when a number comes; the why is one tap away
    expect(html).toContain("After your first set");
    expect(html).not.toContain("After your warm-up");
  });
  it("no warm-up offered: the first logged set unlocks live suggestions", () => {
    const html = render(false, { ...model, status: "calibrating", historySessions: 3 }, null);
    expect(html).toContain("No recent logs of this lift with an RPE");
    expect(html).toContain("After your first set");
  });
  it("an early estimate says so", () => {
    expect(render(false, { ...model, early: true, historySessions: 1 })).toContain("Early estimate");
  });
});
