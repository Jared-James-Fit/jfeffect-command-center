import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";

describe("load type menu", () => {
  it("shows only load types", () => {
    render(<WeightValueInput value="" loadType="external" unit="lb" ariaLabel="Weight" onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText("Weight — change load type"));
    const html = document.body.innerHTML;
    expect(html).toContain("Load type");
    expect(html).toContain("Weight");
    expect(html).toContain("Bodyweight");
    expect(html).toContain("Assisted");
    expect(html).not.toMatch(/\+\/[-−]/);
    console.log(document.querySelector('[role=dialog]')?.textContent);
  });
});
