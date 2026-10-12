import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { LoadSuggestionsChip, LoadSuggestionsNudge, LoadSuggestionsDone } = await import("@/components/workout-day/load-suggestion-card");
const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

describe("suggestions: a switch on every exercise card, one state for the workout, off by default", () => {
  it("the chip is a switch that starts off", () => {
    const html = renderToStaticMarkup(createElement(LoadSuggestionsChip));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Suggest");
  });

  it("lives in each card that can suggest, not at the top of the workout", () => {
    expect(wdv).toContain("{canSuggest && !readonly && <LoadSuggestionsChip highlight={!!suggestNudge} />}");
    expect(wdv).not.toContain("LoadSuggestionsToggle");
    expect(wdv).toContain("{showSuggestionCard && loadModel && loadPlan && (");
    expect(wdv).not.toContain("suggested={!readonly && !isConfirmed && isNextSet");
  });

  it("a finished card shows how today ran instead of a stale range", () => {
    expect(wdv).toContain("openSetCount === 0 && workedToday");
    expect(renderToStaticMarkup(createElement(LoadSuggestionsDone, { own: 1.034 }))).toContain("3% above your usual");
    expect(renderToStaticMarkup(createElement(LoadSuggestionsDone, { own: 0.995 }))).toContain("right on your usual");
    // Never blank while Suggest is on: done, plus where to start next time.
    const bare = renderToStaticMarkup(createElement(LoadSuggestionsDone, { own: null }));
    expect(bare).toContain("All sets in");
    expect(bare).not.toContain("your usual");
    const next = renderToStaticMarkup(createElement(LoadSuggestionsDone, {
      own: null, next: { low: 47.5, high: 52.5, target: 50, unit: "lb" }, plan: { reps: 15, rpe: 9.5 },
    }));
    expect(next).toMatch(/Next time: .*50(<!-- -->)? (<!-- -->)?lb/);
    expect(next).toMatch(/15(<!-- -->)? @ RPE (<!-- -->)?9.5/);
    expect(wdv).toContain("<LoadSuggestionsDone own={dayRead?.own ?? null} next={loadHint} plan={loadPlan} />");
  });

  it("is a per-device UI preference with a safe fallback", async () => {
    const mod = await import("@/lib/load-suggestion-visibility");
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    mod.setShowLoadSuggestions(true);
    expect(store.get("jf.workout.showLoadSuggestions")).toBe("1");
    mod.setShowLoadSuggestions(false);
    expect(store.get("jf.workout.showLoadSuggestions")).toBe("0");
    vi.stubGlobal("window", { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } });
    expect(() => mod.setShowLoadSuggestions(true)).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("try-it nudge: until tried once, once per app load, never in coach preview", () => {
  it("offers Try it and Not now", () => {
    const html = renderToStaticMarkup(createElement(LoadSuggestionsNudge, { onDismiss() {} }));
    expect(html).toContain("New: live weight suggestions");
    expect(html).toContain("Try it");
    expect(html).toContain('aria-label="Not now"');
  });

  it("tried is stored server-side; Not now lasts until the app reloads", async () => {
    const mod = await import("@/lib/load-suggestion-visibility");
    expect(mod.LOAD_SUGGESTIONS_TRIED_KEY).toBe("load_suggestions_tried");
    expect(mod.suggestionsNudgeDismissed()).toBe(false);
    mod.dismissSuggestionsNudgeForNow();
    expect(mod.suggestionsNudgeDismissed()).toBe(true);
    expect(wdv).toContain("queryFn: () => hasSeenFeature(suggestUserId!, LOAD_SUGGESTIONS_TRIED_KEY)");
    expect(wdv).toContain("void markFeatureSeen(suggestUserId, LOAD_SUGGESTIONS_TRIED_KEY);");
    expect(wdv).toContain("const suggestUserId = !isImpersonating ? authUser?.id ?? null : null;");
  });

  it("shows on one card only: the first that can suggest", () => {
    expect(wdv).toContain("((rows as any[]).find((r) => suggestEligible.includes(r.id))?.id ?? null)");
    expect(wdv).toContain("suggestNudge={suggestNudgeRowId === r.id ? hideSuggestNudge : null}");
  });
});
