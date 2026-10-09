import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { LoadSuggestionsToggle } = await import("@/components/workout-day/load-suggestion-card");

describe("suggested-load card: off by default, one toggle for the whole workout", () => {
  it("the toggle starts on 'Show suggestions'", () => {
    const html = renderToStaticMarkup(createElement(LoadSuggestionsToggle));
    expect(html).toContain("Show suggestions");
    expect(html).toContain('aria-pressed="false"');
  });

  it("every exercise card reads the same switch; the ◎ weight in the next set stays either way", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("{showSuggestionCard && loadModel && loadPlan && (");
    expect(wdv).toContain("<LoadSuggestionsToggle />");
    expect(wdv).toContain('suggested={!readonly && !isConfirmed && isNextSet && loadHint && loadType === "external" ? loadHint.target : null}');
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
