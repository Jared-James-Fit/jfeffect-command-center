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

describe("suggestion card with the warm-up row", () => {
  const model: any = { status: "ready", unit: "lb", source: "history", historySessions: 6, history: [], today: [], readiness: { multiplier: 1, reasons: [] }, staleDays: null, warmup: null, bodyweightScale: 1 };
  const hint = { low: 215, high: 235, target: 225, unit: "lb" as const };
  const plan = { reps: 5, rpe: 6 };
  const render = (warmup: any, m = model, h: any = hint) => renderToStaticMarkup(createElement(LoadSuggestionCard, { hint: h, model: m, plan, warmup }));

  it("leaves the warm-up to the set table (no second prompt on the card)", () => {
    const html = render({ suggested: { load: 195, reps: 2 } });
    expect(html).toMatch(/data-testid="load-target">225(<!-- -->)? (<!-- -->)?lb</);
    expect(html).toContain("215–235");
    expect(html).not.toContain('data-testid="load-badge"');
    expect(html).not.toContain("warmup-gauge");
  });
  it("says when a logged warm-up tuned the number", () => {
    expect(render({ suggested: null }, { ...model, source: "history_warmup" })).toContain("Warm-up tuned");
    expect(render({ suggested: null }, { ...model, source: "warmup", historySessions: 0 })).toContain("From warm-up");
  });
  it("Suggest on but no number yet: never blank — points at the warm-up row when it's offered", () => {
    const html = render({ suggested: null }, { ...model, status: "calibrating", historySessions: 0 }, null);
    expect(html).toContain('data-testid="load-suggestion-pending"');
    expect(html).toContain("No logs of this lift yet");
    expect(html).toContain("log your last warm-up below and it sets today&#x27;s weight.");
  });
  it("no warm-up offered: the first logged set unlocks live suggestions", () => {
    const html = render(null, { ...model, status: "calibrating", historySessions: 3 }, null);
    expect(html).toContain("No recent logs of this lift with an RPE");
    expect(html).toContain("log your first set with an RPE and the rest get a live suggestion.");
  });
  it("an early estimate says so", () => {
    expect(render(null, { ...model, early: true, historySessions: 1 })).toContain("Early estimate");
  });
});
