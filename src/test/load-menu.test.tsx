import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";

describe("load type menu", () => {
  it("shows only load types, no +/-", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<WeightValueInput value="" loadType="external" unit="lb" ariaLabel="Weight" onPick={() => {}} />);
    });
    const chevron = document.querySelector('[aria-label="Weight — change load type"]') as HTMLElement;
    await act(async () => { chevron.click(); });
    const text = (document.querySelector('[role=dialog]') as HTMLElement).textContent!;
    console.log("MENU:", text);
    expect(text).toContain("Load type");
    expect(text).toContain("Bodyweight");
    expect(text).toContain("Assisted");
    expect(text).not.toMatch(/\+\/[-−]/i);
  });
});
