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

describe("suggestion card warm-up gauge", () => {
  const model: any = { status: "ready", unit: "lb", source: "history", historySessions: 6, history: [], today: [], readiness: { multiplier: 1, reasons: [] }, staleDays: null, warmup: null, bodyweightScale: 1 };
  const hint = { low: 215, high: 235, target: 225, unit: "lb" as const };
  const plan = { reps: 5, rpe: 6 };
  const render = (warmup: any, m = model, h: any = hint) => renderToStaticMarkup(createElement(LoadSuggestionCard, { hint: h, model: m, plan, warmup }));

  it("before warming up: tells the athlete what to warm up to", () => {
    const html = render({ suggested: { load: 195, reps: 2 }, logged: null, onOpen() {} });
    expect(html).toContain("Last warm-up");
    expect(html).toContain("~195 × 2");
    expect(html).toContain("log how it felt");
  });
  it("after logging: shows it was used, with the feel", () => {
    const html = render({ suggested: { load: 195, reps: 2 }, logged: { load: 205, reps: 2, rpe: 7 }, onOpen() {} });
    expect(html).toContain("205 × 2");
    expect(html).toContain("Solid");
    expect(html).toContain("✓ tuned");
  });
  it("no history yet: offers the warm-up as the way to a first suggestion", () => {
    const html = render({ suggested: null, logged: null, onOpen() {} }, { ...model, status: "calibrating", historySessions: 0 }, null);
    expect(html).toContain("Log your last warm-up for a first suggestion");
  });
  it("no gauge (working sets started / not SBD): card unchanged", () => {
    expect(render(null)).not.toContain("warmup-gauge");
  });
});
