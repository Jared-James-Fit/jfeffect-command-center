import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { matchPreviousWeekSlots, type SlotRow } from "@/lib/previous-week-slot";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { LastWeekSwapChip, lastWeekSetLine } = await import("@/components/workout-day/last-week-swap");

const META: Record<string, Partial<SlotRow>> = {
  "Seated Cable Row": { muscleGroup: "Upper Back, Lats", category: "Back", family: "accessory" },
  "Chest Supported Dumbbell Row": { muscleGroup: "Upper Back, Lats", category: "Back", family: "accessory" },
  "EZ Bar Curl": { muscleGroup: "Biceps", category: "Biceps", family: "accessory" },
  "Face Pull": { muscleGroup: "Rear Delts", category: "Shoulders", family: "accessory" },
  "Lat Pulldown": { muscleGroup: "Lats", category: "Back", family: "accessory" },
  "Competition Squat": { muscleGroup: "Quads, Glutes", category: "Squat", family: "squat" },
  "Hack Squat": { muscleGroup: "Quads, Glutes", category: "Squat", family: "accessory" },
  "Glute Bridge": { muscleGroup: "Glutes", category: "Lower Body", family: "accessory" },
  "Back Extension": { muscleGroup: "Lower Back, Glutes", category: "Lower Body", family: "accessory" },
};
const row = (id: string, name: string, sortOrder: number, purposeLabel: string | null = "GPP"): SlotRow =>
  ({ id, exerciseId: `ex-${name}`, name, sortOrder, purposeLabel, ...META[name] });
// Tuesday: Secondary Deadlift, Secondary Bench, then GPP.
const lastWeek = [
  row("p1", "Tempo Sumo Deadlift", 1, "Secondary Deadlift"),
  row("p2", "2-Count Pause Bench", 2, "Secondary Bench"),
  row("p3", "Seated Cable Row", 3),
  row("p4", "EZ Bar Curl", 4),
];
const thisWeek = (third = "Chest Supported Dumbbell Row") => [
  row("c1", "Tempo Sumo Deadlift", 1, "Secondary Deadlift"),
  row("c2", "2-Count Pause Bench", 2, "Secondary Bench"),
  row("c3", third, 3),
  row("c4", "EZ Bar Curl", 4),
];

describe("last week's slot: only when the exercise there changed", () => {
  it("a swap (either week) shows last week's exercise on that card only", () => {
    const m = matchPreviousWeekSlots(thisWeek(), lastWeek);
    expect([...m.keys()]).toEqual(["c3"]);
    expect(m.get("c3")!.name).toBe("Seated Cable Row");
  });

  it("the same exercises as last week: nothing to show (Last time covers it)", () => {
    expect(matchPreviousWeekSlots(thisWeek("Seated Cable Row"), lastWeek).size).toBe(0);
  });

  it("a reorder is not a swap", () => {
    const reordered = [row("c1", "Tempo Sumo Deadlift", 1, "Secondary Deadlift"), row("c2", "2-Count Pause Bench", 2, "Secondary Bench"), row("c3", "EZ Bar Curl", 3), row("c4", "Seated Cable Row", 4)];
    expect(matchPreviousWeekSlots(reordered, lastWeek).size).toBe(0);
  });

  it("an exercise added this week doesn't flag the ones after it", () => {
    const added = [...thisWeek("Seated Cable Row").slice(0, 2), row("cx", "Face Pull", 3), row("c3", "Seated Cable Row", 4), row("c4", "EZ Bar Curl", 5)];
    expect(matchPreviousWeekSlots(added, lastWeek).size).toBe(0);
  });

  it("a different role in that position is a different slot", () => {
    const now = [row("c1", "Tempo Sumo Deadlift", 1, "Secondary Deadlift"), row("c2", "Larsen Press", 2, "Primary Bench")];
    expect(matchPreviousWeekSlots(now, lastWeek).size).toBe(0);
  });

  it("only a similar exercise counts as a swap — a redesigned day doesn't", () => {
    const redesigned = [row("c1", "Lat Pulldown", 1, null)];
    expect(matchPreviousWeekSlots(redesigned, [row("p1", "Competition Squat", 1, null)]).size).toBe(0);
    expect(matchPreviousWeekSlots([row("c1", "Competition Squat", 1, null)], [row("p1", "Hack Squat", 1, null)]).size).toBe(1);
    // "Lower Body" is too broad on its own
    expect(matchPreviousWeekSlots([row("c1", "Back Extension", 1, null)], [row("p1", "Glute Bridge", 1, null)]).size).toBe(0);
    // no library metadata (typed-in names): the purpose label decides
    const typed = (id: string, name: string, label: string | null): SlotRow => ({ id, exerciseId: null, name, sortOrder: 1, purposeLabel: label });
    expect(matchPreviousWeekSlots([typed("c1", "Banded row", "GPP")], [typed("p1", "Towel row", "GPP")]).size).toBe(1);
    expect(matchPreviousWeekSlots([typed("c1", "Banded row", null)], [typed("p1", "Towel row", null)]).size).toBe(0);
  });

  it("matches by name when the exercise record differs (coach typed it again)", () => {
    const now = thisWeek().map((r) => (r.id === "c3" ? { ...r, exerciseId: "other-id", name: "seated cable row " } : r));
    expect(matchPreviousWeekSlots(now, lastWeek).size).toBe(0);
  });
});

describe("the chip: small, in the badge row, last week's sets on tap", () => {
  const sets = [
    { id: "a", set_index: 2, entered_value: 120, entered_unit: "lb", normalized_lb: 120, normalized_kg: 54.43, actual_reps: 10, actual_rpe: "10", load_type: "external" },
    { id: "b", set_index: 1, entered_value: 120, entered_unit: "lb", normalized_lb: 120, normalized_kg: 54.43, actual_reps: 12, actual_rpe_num: 9, load_type: "external" },
  ];
  it("says what the slot was, compactly", () => {
    const html = renderToStaticMarkup(createElement(LastWeekSwapChip, { swap: { name: "Seated Cable Row", sets }, unit: "lb" }));
    expect(html).toContain('data-testid="last-week-swap"');
    expect(html).toContain("Last wk:");
    expect(html).toContain("Seated Cable Row");
    expect(html).toContain("h-5"); // same height as the purpose badge: no new row
  });
  it("lists each set in the card's unit", () => {
    expect(lastWeekSetLine(sets[1], "lb")).toBe("120 lb × 12 @ 9");
    expect(lastWeekSetLine(sets[0], "kg")).toBe("54.4 kg × 10 @ 10");
    expect(lastWeekSetLine({ load_type: "bodyweight", actual_reps: 15 }, "lb")).toBe("BW × 15");
  });
  it("sits next to the purpose badge and is fed per card", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("{lastWeekSwap && <LastWeekSwapChip swap={lastWeekSwap} unit={activeUnit} />}");
    expect(wdv).toContain("lastWeekSwap={lastWeekSwapByRow.get(r.id) ?? null}");
  });
});

describe("card buttons: fewer, clearer", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("Last time is the History button; a separate History chip only stands in when there's no last time", () => {
    expect(wdv).toContain("onOpen={clientId ? () => setHistoryOpen(true) : undefined}");
    expect(wdv).toContain("fallback={clientId ? (");
    expect(wdv).toContain("<DeferredExerciseHistorySheet");
  });
});
