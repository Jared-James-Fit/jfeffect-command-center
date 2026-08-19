import { describe, it, expect } from "vitest";
import {
  normalizeWeekdays, resolveClientAvailability, frequencyFromPlacements,
  frequencyFromTemplateBlocks, evaluateAvailabilityGuard, buildWeeklyPreview,
} from "@/lib/program-availability-guard";

const P = (blockKey: string, weekIndex: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ blockKey, weekIndex, dayKey: `${blockKey}::w${weekIndex}::d${i}` }));

describe("availability guardrail", () => {
  it("normalizes long + short weekday names in week order", () => {
    expect(normalizeWeekdays(["Friday", "mon", "Wednesday", "Monday"])).toEqual(["mon", "wed", "fri"]);
  });

  it("resolves committed → available → preferred and drops unavailable", () => {
    expect(resolveClientAvailability({ committed_training_days: ["Monday", "Tuesday"] }))
      .toEqual({ days: ["mon", "tue"], source: "committed" });
    expect(resolveClientAvailability({ available_training_days: ["Mon", "Sat"], unavailable_training_days: ["Saturday"] }))
      .toEqual({ days: ["mon"], source: "available" });
    expect(resolveClientAvailability({}).source).toBe("none");
  });

  it("detects frequency from actual programmed days, not exercise counts", () => {
    const f = frequencyFromPlacements([...P("b", 0, 3), ...P("b", 1, 3)]);
    expect(f.max).toBe(3);
    expect(f.variable).toBe(false);
  });

  it("detects variable frequency across weeks", () => {
    const f = frequencyFromPlacements([...P("b", 0, 3), ...P("b", 1, 4)]);
    expect(f.max).toBe(4);
    expect(f.min).toBe(3);
    expect(f.variable).toBe(true);
  });

  it("reads frequency from template blocks", () => {
    const f = frequencyFromTemplateBlocks([{ name: "B1", weeks: [{ days: [1, 2, 3] }, { days: [1, 2, 3] }] }] as any);
    expect(f.max).toBe(3);
  });

  it("passes when 3 workouts match 3 available days", () => {
    const g = evaluateAvailabilityGuard({
      frequency: frequencyFromPlacements(P("b", 0, 3)),
      availability: resolveClientAvailability({ committed_training_days: ["Monday", "Wednesday", "Friday"] }),
    });
    expect(g.status).toBe("ok");
    expect(g.blocking).toBe(false);
  });

  it("blocks 4 workouts against 3 available days", () => {
    const g = evaluateAvailabilityGuard({
      frequency: frequencyFromPlacements(P("b", 0, 4)),
      availability: resolveClientAvailability({ committed_training_days: ["Monday", "Wednesday", "Friday"] }),
      clientName: "Marc",
    });
    expect(g.status).toBe("too_few_days");
    expect(g.blocking).toBe(true);
    expect(g.message).toContain("Marc");
  });

  it("requires picking exact days when availability exceeds frequency", () => {
    const g = evaluateAvailabilityGuard({
      frequency: frequencyFromPlacements(P("b", 0, 3)),
      availability: resolveClientAvailability({ committed_training_days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }),
    });
    expect(g.status).toBe("extra_days");
    expect(g.requiredDays).toBe(3);
  });

  it("prompts for availability when none is configured", () => {
    const g = evaluateAvailabilityGuard({
      frequency: frequencyFromPlacements(P("b", 0, 4)),
      availability: resolveClientAvailability({}),
    });
    expect(g.status).toBe("missing_availability");
    expect(g.title).toBe("Set Training Availability First");
  });

  it("accepts coach-selected days that match the frequency", () => {
    const g = evaluateAvailabilityGuard({
      frequency: frequencyFromPlacements(P("b", 0, 4)),
      availability: resolveClientAvailability({ committed_training_days: ["Mon", "Wed", "Fri"] }),
      selectedDays: ["mon", "tue", "wed", "fri"],
    });
    expect(g.status).toBe("ok");
  });

  it("maps workouts chronologically onto chosen weekdays", () => {
    expect(buildWeeklyPreview(["Lower", "Upper", "Full Body"], ["mon", "wed", "fri"])).toEqual([
      { weekday: "mon", label: "Monday", title: "Lower" },
      { weekday: "wed", label: "Wednesday", title: "Upper" },
      { weekday: "fri", label: "Friday", title: "Full Body" },
    ]);
  });

  it("matches Marc's stored 4-day availability against a 4-day program", () => {
    const g = evaluateAvailabilityGuard({
      frequency: frequencyFromPlacements(P("b", 0, 4)),
      availability: resolveClientAvailability({ committed_training_days: ["Monday", "Tuesday", "Wednesday", "Friday"] }),
      clientName: "Marc Asugui",
    });
    expect(g.status).toBe("ok");
    expect(buildWeeklyPreview(["Upper A", "Lower A", "Upper B", "Lower B"], g.selectedDays).map((r) => r.label))
      .toEqual(["Monday", "Tuesday", "Wednesday", "Friday"]);
  });
});
