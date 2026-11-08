import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HISTORY_EDIT_QUERY_KEYS, numberText, setDraftIssue, setEditDraft, setEditPatch } from "@/lib/history-set-edit";

// Nicolas, Oct 2026: 135 / 185 / 205 typed in lb on a card that was in kg.
const nicolas = { id: "s3", entered_value: "205", entered_unit: "kg", actual_load: "205", actual_load_unit: "kg", actual_reps: 6, actual_rpe: "7", load_type: "external", is_bodyweight: false };

describe("a past day's set, fixed from the History sheet", () => {
  it("opens with what was logged, in the unit it was logged in", () => {
    expect(setEditDraft(nicolas, "lb")).toEqual({ load: "205", unit: "kg", reps: "6", rpe: "7", loadEditable: true });
    expect(numberText("92.5000")).toBe("92.5");
    expect(numberText(null)).toBe("");
  });

  it("flipping the unit relabels the number, never converts it", () => {
    const d = { ...setEditDraft(nicolas, "lb"), unit: "lb" as const };
    expect(setEditPatch(nicolas, d, "lb")).toEqual({ entered_value: 205, actual_load: 205, entered_unit: "lb", actual_load_unit: "lb" });
  });

  it("writes only what changed, and nothing when nothing did", () => {
    const d = setEditDraft(nicolas, "lb");
    expect(setEditPatch(nicolas, d, "lb")).toBeNull();
    expect(setEditPatch(nicolas, { ...d, reps: "5" }, "lb")).toEqual({ actual_reps: 5 });
    expect(setEditPatch(nicolas, { ...d, rpe: "7.5" }, "lb")).toEqual({ actual_rpe: "7.5" });
    expect(setEditPatch(nicolas, { ...d, rpe: "" }, "lb")).toEqual({ actual_rpe: null });
    expect(setEditPatch(nicolas, { ...d, load: "210" }, "lb")).toEqual({ entered_value: 210, actual_load: 210, entered_unit: "kg", actual_load_unit: "kg" });
  });

  it("a bodyweight set keeps its load; only reps and RPE change", () => {
    const bw = { id: "bw", entered_value: 0, entered_unit: "lb", actual_reps: 10, actual_rpe: "8", load_type: "bodyweight", is_bodyweight: true };
    const d = setEditDraft(bw, "lb");
    expect(d.loadEditable).toBe(false);
    expect(setEditPatch(bw, { ...d, load: "50", reps: "12" }, "lb")).toEqual({ actual_reps: 12 });
  });

  it("refuses what can't be right, and points a too-heavy kg number at lb", () => {
    const d = setEditDraft(nicolas, "lb");
    expect(setDraftIssue(d)).toBeNull();
    expect(setDraftIssue({ ...d, load: "495" })).toBe("495 kg is over 450 kg. Tap kg to make it lb.");
    expect(setDraftIssue({ ...d, load: "495", unit: "lb" })).toBeNull();
    expect(setDraftIssue({ ...d, load: "1200", unit: "lb" })).toBe("Weight is over 1000 lb");
    expect(setDraftIssue({ ...d, load: "1." })).toBe("Weight must be a number");
    expect(setDraftIssue({ ...d, reps: "101" })).toBe("Reps can't be over 100");
    expect(setDraftIssue({ ...d, rpe: "11" })).toBe("RPE is 1 to 10, in half steps");
    expect(setDraftIssue({ ...d, rpe: "7.3" })).toBe("RPE is 1 to 10, in half steps");
    expect(setDraftIssue({ ...d, rpe: "", reps: "", load: "" })).toBeNull();
  });

  it("an edit refreshes everything the past set feeds", () => {
    const keys = HISTORY_EDIT_QUERY_KEYS.map((k) => k[0]);
    for (const k of ["exercise-history", "exercise-records", "workout-previous-lifts", "pl-day-results"]) expect(keys).toContain(k);
  });
});

describe("the sheet edits in place, from inside the workout", () => {
  const sheet = readFileSync("src/components/exercise-history-sheet.tsx", "utf8");
  const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

  it("each day has Edit, and Save writes only changed sets, checked by RLS", () => {
    expect(sheet).toContain("{editable && editingKey !== dayKey && (");
    expect(sheet).toContain('await sb.from("pl_row_results").update(w.patch).eq("id", w.id).select("id");');
    expect(sheet).toContain("if (!data?.length) throw new Error(\"You can't change this set\");");
    expect(sheet).toContain("HISTORY_EDIT_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] }))");
  });

  it("the boxes are thumb-sized and never zoom the page", () => {
    expect(sheet.match(/className="h-10 [^"]*text-base/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sheet).toContain('inputMode="decimal"');
  });

  it("the workout's History opens editable unless the card is read-only", () => {
    expect(view.match(/editable=\{!readonly\}/g)?.length).toBe(2);
  });
});
