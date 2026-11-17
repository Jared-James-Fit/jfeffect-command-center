import { describe, expect, it } from "vitest";
import {
  applyCell, formatCell, formatLoad, formatSeconds, isMultiCellPaste, leadingNumber, newRowForExercise,
  parseLoad, parseSeconds, parseTsv, patchSlot, progression, progressionText, rowAtSlot, toTsv, weekSlots,
} from "@/lib/program-sheet";

const patchOf = (r: any) => {
  if ("error" in r) throw new Error(r.error);
  return r.patch;
};

describe("program sheet: cells read and write the row like the card editor", () => {
  it("time reads as a coach types it", () => {
    expect(parseSeconds("90")).toBe(90);
    expect(parseSeconds("1:30")).toBe(90);
    expect(parseSeconds("1:00:00")).toBe(3600);
    expect(parseSeconds("45s")).toBe(45);
    expect(parseSeconds("3m")).toBe(180);
    expect(parseSeconds("2.5 min")).toBe(150);
    expect(parseSeconds("ten")).toBeNull();
    expect(formatSeconds(45)).toBe("45s");
    expect(formatSeconds(90)).toBe("1:30");
    expect(formatSeconds(3725)).toBe("1:02:05");
    expect(formatSeconds(null)).toBe("");
  });

  it("a load is a % of a basis or a set weight, in the card editor's own fields", () => {
    expect(patchOf(parseLoad("75%", {}))).toMatchObject({ percentage_basis: "training_max", percentage: 75, load_kg: null, load_lb: null });
    // a bare % keeps the row's own % basis
    expect(patchOf(parseLoad("92.5%", { percentage_basis: "top_set" }))).toMatchObject({ percentage_basis: "top_set", percentage: 92.5 });
    expect(patchOf(parseLoad("80% 1RM", {}))).toMatchObject({ percentage_basis: "1rm", percentage: 80 });
    expect(patchOf(parseLoad("85% e1RM", {}))).toMatchObject({ percentage_basis: "est_1rm" });
    expect(patchOf(parseLoad("90% top set", {}))).toMatchObject({ percentage_basis: "top_set" });
    expect(patchOf(parseLoad("95% last week", {}))).toMatchObject({ percentage_basis: "prev_week" });
    expect(patchOf(parseLoad("100 kg", {}))).toMatchObject({ percentage_basis: "manual", load_unit: "kg", load_kg: 100, load_lb: null, percentage: null });
    expect(patchOf(parseLoad("225lb", {}))).toMatchObject({ load_unit: "lb", load_lb: 225, load_kg: null });
    // a bare weight is the row's unit
    expect(patchOf(parseLoad("185", { load_unit: "lb" }))).toMatchObject({ load_unit: "lb", load_lb: 185 });
    expect(patchOf(parseLoad("", { percentage_basis: "training_max", percentage: 70 }))).toMatchObject({ percentage_basis: "none", percentage: null });
    expect("error" in parseLoad("heavy", {})).toBe(true);
    expect("error" in parseLoad("300%", {})).toBe(true);
  });

  it("formatLoad shows what's there and nothing when there's none", () => {
    expect(formatLoad({ percentage_basis: "training_max", percentage: 72.5 })).toBe("72.5% TM");
    expect(formatLoad({ percentage_basis: "top_set", percentage: 92.5 })).toBe("92.5% top");
    expect(formatLoad({ percentage_basis: "manual", load_unit: "lb", load_lb: 225 })).toBe("225 lb");
    expect(formatLoad({ percentage_basis: null, load_kg: 100 })).toBe("100 kg");
    expect(formatLoad({ percentage_basis: "none", load_kg: 100 })).toBe("");
    expect(formatLoad({})).toBe("");
  });

  it("sets, effort and rest are checked, never guessed", () => {
    expect(patchOf(applyCell({}, "sets", "4"))).toEqual({ sets: 4 });
    expect("error" in applyCell({}, "sets", "4.5")).toBe(true);
    expect("error" in applyCell({}, "sets", "40")).toBe(true);
    expect(patchOf(applyCell({}, "rpe", "@8"))).toEqual({ rpe: "8" });
    expect(patchOf(applyCell({}, "rpe", "7 - 8"))).toEqual({ rpe: "7-8" });
    expect("error" in applyCell({}, "rpe", "11")).toBe(true);
    expect("error" in applyCell({}, "rpe", "8-7")).toBe(true);
    expect(patchOf(applyCell({}, "rir", ""))).toEqual({ rir: null });
    // rest is set by hand: both fields, as the card editor writes them
    expect(patchOf(applyCell({}, "rest", "3m"))).toEqual({ rest_seconds: 180, rest_seconds_override: 180 });
    expect(patchOf(applyCell({}, "rest", ""))).toEqual({ rest_seconds: null, rest_seconds_override: null });
  });

  it("a time row's reps cell is its time; a time row takes no load", () => {
    const timed = { measurement_type: "time", duration_seconds: 90 };
    expect(formatCell(timed, "reps")).toBe("1:30");
    expect(patchOf(applyCell(timed, "reps", "20 min"))).toEqual({ duration_seconds: 1200 });
    expect("error" in applyCell(timed, "load", "100 kg")).toBe(true);
    expect(patchOf(applyCell({ reps_text: "5" }, "reps", "8-10"))).toEqual({ reps_text: "8-10" });
    expect(formatCell({ rest_seconds: 180 }, "rest")).toBe("3:00");
    expect(formatCell({ rest_seconds: 90, rest_seconds_override: 120 }, "rest")).toBe("2:00");
  });

  it("pastes from Google Sheets as a grid and copies back out as one", () => {
    expect(parseTsv("4\t5\t7\n3\t8\t8\r\n")).toEqual([["4", "5", "7"], ["3", "8", "8"]]);
    expect(isMultiCellPaste("4\t5")).toBe(true);
    expect(isMultiCellPaste("4\n5")).toBe(true);
    expect(isMultiCellPaste("75% TM")).toBe(false);
    expect(toTsv([["4", "5"], ["a\tb", "c"]])).toBe("4\t5\na b\tc");
  });

  it("a progression adds a step a week, capped where it must be", () => {
    expect(progression(7, 0.5, 4, "rpe")).toEqual(["7", "7.5", "8", "8.5"]);
    expect(progression(9, 0.5, 4, "rpe")).toEqual(["9", "9.5", "10", "10"]);
    expect(progression(72.5, 2.5, 3, "load")).toEqual(["72.5", "75", "77.5"]);
    expect(progression(0.1, 0.2, 3, "load")).toEqual(["0.1", "0.3", "0.5"]);
    expect(progression(4, -1, 5, "sets")).toEqual(["4", "3", "2", "1", "1"]);
    expect(leadingNumber("75% TM")).toBe(75);
    expect(leadingNumber("@7-8")).toBe(7);
    expect(leadingNumber("AMRAP")).toBeNull();
    // a load keeps its basis or unit
    expect(progressionText({ percentage_basis: "top_set", percentage: 90 }, "load", "92.5")).toBe("92.5% top");
    expect(progressionText({ percentage_basis: "manual", load_unit: "lb", load_lb: 225 }, "load", "235")).toBe("235 lb");
    expect(progressionText({}, "load", "70")).toBe("70%");
    expect(progressionText({}, "rpe", "8")).toBe("8");
  });

  it("a new row is set up like the card editor's Add", () => {
    const r = newRowForExercise({ id: "x", name: "Plank", default_measurement_type: "time", duration_seconds: 45 });
    expect(r).toMatchObject({ exercise_id: "x", exercise_name_override: "Plank", tracking_type: "time", measurement_type: "time", duration_seconds: 45, percentage_basis: "none" });
    expect(newRowForExercise({ id: "y", name: "Squat" })).toMatchObject({ tracking_type: "reps_weight", measurement_type: "reps" });
  });
});

describe("program sheet: across weeks", () => {
  const weeks = [
    { week_index: 1, days: [{ day_index: 1, title: "Lower", rows: [{ exercise_name_override: "Squat", rpe: "7" }, { exercise_name_override: "RDL" }] }] },
    { week_index: 2, days: [{ day_index: 1, title: "Lower", rows: [{ exercise_name_override: "Squat", rpe: "7.5" }] }, { day_index: 2, title: "Upper", rows: [{ exercise_name_override: "Bench" }] }] },
  ];
  const nameOf = (r: any) => r.exercise_name_override;

  it("follows each day and place across the block, named from the first week that has it", () => {
    const slots = weekSlots(weeks, nameOf);
    expect(slots.map((s) => [s.key, s.name, s.dayLabel])).toEqual([
      ["1:0", "Squat", "Day 1 · Lower"],
      ["1:1", "RDL", "Day 1 · Lower"],
      ["2:0", "Bench", "Day 2 · Upper"],
    ]);
    expect(rowAtSlot(weeks[1], { dayIndex: 1, pos: 1 })).toBeNull();
    expect(rowAtSlot(weeks[1], { dayIndex: 1, pos: 0 })?.rpe).toBe("7.5");
  });

  it("patching one slot touches only that week's row and leaves the input alone", () => {
    const next = patchSlot(weeks, 1, { dayIndex: 1, pos: 0 }, { rpe: "8" });
    expect(next[1].days[0].rows[0].rpe).toBe("8");
    expect(next[0]).toBe(weeks[0]);
    expect(weeks[1].days[0].rows[0].rpe).toBe("7.5");
    expect(next[1].days[1]).toBe(weeks[1].days[1]);
  });
});

describe("program sheet: in the editor", () => {
  const editor = require("node:fs").readFileSync("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx", "utf8") as string;
  const sheet = require("node:fs").readFileSync("src/components/program-editor/program-sheet.tsx", "utf8") as string;

  it("is a third view on a computer only, remembered like the others", () => {
    expect(editor).toContain('[["week", "Week"], ["block", "Whole block"], ["sheet", "Sheet"]]');
    expect(editor).toContain('const view: EditorView = phone ? "week" : viewPref;');
    expect(editor).toContain('p.view === "sheet" ? "sheet"');
    expect(editor).toContain("<ProgramSheet");
  });

  it("writes through the editor's own setter (one undo step, autosaved) and undoes from a clean cell", () => {
    expect(sheet).toContain("if (next !== weeksData) setWeeksData(next);");
    expect(editor).toContain('t.hasAttribute("data-sheet-cell") && t.getAttribute("data-dirty") !== "1"');
  });

  it("a block editor shows what a % works out to with the client's max", () => {
    expect(editor).toContain("loadHint={sheetLoadHint}");
    expect(editor).toContain("computeRowLoad({");
  });
});
