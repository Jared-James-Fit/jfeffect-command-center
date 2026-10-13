import { describe, expect, it } from "vitest";
import { buildTrainingReadout, liftOf, parseRange, trainingReadoutText, type ReadoutRow } from "@/lib/training-readout";

const KG = 1 / 2.2046226;
// This week (w3): Mon squat done, Thu paused bench done heavy, Fri deadlift still to come. Next week (w4).
const days = [
  { id: "mon", week_id: "w3", day_index: 1, date: "2026-10-12" },
  { id: "thu", week_id: "w3", day_index: 4, date: "2026-10-15" },
  { id: "fri", week_id: "w3", day_index: 5, date: "2026-10-16" },
  { id: "mon4", week_id: "w4", day_index: 1, date: "2026-10-19" },
  { id: "thu4", week_id: "w4", day_index: 4, date: "2026-10-22" },
];
const row = (o: Partial<ReadoutRow> & Pick<ReadoutRow, "id" | "day_id" | "name">): ReadoutRow => ({ sets: 1, reps_text: "5", ...o });
const rows: ReadoutRow[] = [
  row({ id: "sq", day_id: "mon", sort_order: 0, name: "Competition Squat", exercise_id: "ex-sq", purpose_label: "Primary Squat", competition_lift_type: "squat", rpe: "5-6" }),
  row({ id: "sqb", day_id: "mon", sort_order: 1, name: "Competition Squat", exercise_id: "ex-sq", purpose_label: "Primary Squat Backoff", competition_lift_type: "squat", sets: 3, rpe: "6" }),
  row({ id: "belt", day_id: "mon", sort_order: 2, name: "Belt Squat", purpose_label: "Quaternary / Limiter Squat", sets: 3, reps_text: "6-10", rpe: "7-8" }),
  row({ id: "calf", day_id: "mon", sort_order: 7, name: "Calf Raise", purpose_label: "GPP", sets: 2, rpe: "9-10" }),
  row({ id: "bp", day_id: "thu", sort_order: 2, name: "1ct Paused Bench", exercise_id: "ex-bp", purpose_label: "Primary Bench", rpe: "5-6" }),
  row({ id: "bpb", day_id: "thu", sort_order: 3, name: "1ct Paused Bench", exercise_id: "ex-bp", purpose_label: "Primary Bench Backoff", sets: 3, rpe: "6" }),
  row({ id: "dl", day_id: "fri", sort_order: 1, name: "Competition Deadlift", purpose_label: "Primary Deadlift", competition_lift_type: "deadlift", rpe: "5-6" }),
  row({ id: "dlb", day_id: "fri", sort_order: 2, name: "Competition Deadlift", purpose_label: "Primary Deadlift Backoff", competition_lift_type: "deadlift", sets: 3, rpe: "6" }),
  row({ id: "sq4", day_id: "mon4", sort_order: 0, name: "Competition Squat", purpose_label: "Primary Squat", competition_lift_type: "squat", rpe: "6-7" }),
  row({ id: "sqb4", day_id: "mon4", sort_order: 1, name: "Competition Squat", purpose_label: "Primary Squat Backoff", sets: 4, rpe: "7" }),
  row({ id: "bp4", day_id: "thu4", sort_order: 2, name: "1ct Paused Bench", purpose_label: "Primary Bench", rpe: "6-7" }),
];
const set = (row_id: string, lb: number, reps: number, rpe: number | null, set_index = 1, at?: string) => ({ row_id, set_index, kg: lb * KG, reps, rpe, at });
const sets = [
  set("sq", 315, 5, 6),
  set("sqb", 315, 5, 6, 1), set("sqb", 315, 5, 6, 2), set("sqb", 315, 5, 6, 3),
  set("belt", 205, 10, 8), set("belt", 205, 10, 8), set("belt", 205, 10, 9),
  set("calf", 45, 20, 10),
  set("bp", 250, 5, 8), // 2 RPE over the 5-6 plan
  set("bpb", 225, 5, 7.5), set("bpb", 225, 5, 8),
];
// Earlier this block: week 1 squat lighter, week 2 squat same load at RPE 6.5; bench week 2 at 245.
const history = [
  set("h-sq", 295, 5, 5, 1, "2026-09-28"),
  set("h-sq", 315, 5, 6.5, 1, "2026-10-05"), set("h-sq", 315, 5, 6, 2, "2026-10-05"),
  set("h-bp", 245, 5, 6, 1, "2026-10-08"),
];
const historyRows = [{ id: "h-sq", exercise_id: "ex-sq", name: "Competition Squat" }, { id: "h-bp", exercise_id: "ex-bp", name: "1ct Paused Bench" }];
const readout = buildTrainingReadout({ thisWeekId: "w3", nextWeekId: "w4", days, rows, sets, history, historyRows, asOf: "2026-10-15", unit: "lb" })!;
const by = (l: string) => readout.this_week.find((x) => x.lift === l)!;

describe("training readout", () => {
  it("parses RPE ranges and groups lifts by the coach's role labels (GPP is nobody's)", () => {
    expect(parseRange("5-6")).toEqual([5, 6]);
    expect(parseRange("@7.5")).toEqual([7.5, 7.5]);
    expect(liftOf({ purpose_label: "Quaternary / Limiter Squat" })).toBe("squat");
    expect(liftOf({ purpose_label: "GPP", competition_lift_type: "squat" })).toBeNull();
    expect(liftOf({ purpose_label: null, competition_lift_type: "bench" })).toBe("bench");
  });

  it("squat: top set on plan, back-offs on plan, all sets done, same load easier than last time; no e1RM from RPE 6", () => {
    expect(by("squat")).toMatchObject({
      exercise: "Competition Squat",
      prescribed: "1×5 @ RPE 5-6 + 3×5 @ RPE 6",
      top: "315lb × 5 @ RPE 6",
      top_vs_plan: "on plan",
      backoff_vs_plan: "on plan",
      sets_done: 7,
      sets_due: 7,
    });
    expect(by("squat").vs_last).toBe("same load × reps as last time, 0.5 RPE easier (last time 315lb × 5 @ RPE 6.5)");
    expect(by("squat").e1rm).toBeNull();
  });

  it("bench: a top set 2 RPE over plan and back-offs over plan are flagged", () => {
    expect(by("bench")).toMatchObject({ top: "250lb × 5 @ RPE 8", top_vs_plan: "2 RPE over plan", backoff: "2 sets avg RPE 7.8", backoff_vs_plan: "1.8 RPE over plan", sets_done: 3, sets_due: 4 });
    expect(by("bench").vs_last).toBe("+5lb vs last time (245lb × 5 @ RPE 6)");
    // RPE 8 is a reliable read, but nothing earlier this block was RPE 7+ to compare against.
    expect(by("bench").e1rm).toBe("308lb"); // 250 × (1 + (5 + 2 RIR)/30)
    expect(by("bench").e1rm_change).toBeNull();
  });

  it("deadlift later this week is still to come, never missed", () => {
    expect(by("deadlift")).toMatchObject({ top: null, top_due: false, sets_done: 0, sets_due: 0, sets_to_come: 4 });
    const text = trainingReadoutText(readout);
    expect(text).toContain("deadlift not trained yet this week (4 sets still to come)");
    expect(text).toContain("Bench: 1ct Paused Bench · prescribed 1×5 @ RPE 5-6 + 3×5 @ RPE 6 · top set 250lb × 5 @ RPE 8 (2 RPE over plan)");
  });

  it("next week: prescription per lift with the RPE and set changes", () => {
    const sq = readout.next_week.find((n) => n.lift === "squat")!;
    expect(sq).toMatchObject({ prescribed: "Competition Squat 1×5 @ RPE 6-7 + 4×5 @ RPE 7", top_rpe_change: "top set RPE 5-6 → 6-7", sets: "squat sets 7 → 5" });
    expect(readout.next_week.find((n) => n.lift === "deadlift")).toBeUndefined();
  });

  it("e1RM is compared only against reliable sets earlier in the block", () => {
    const r = buildTrainingReadout({
      thisWeekId: "w3", nextWeekId: null, days, rows, sets, asOf: "2026-10-15", unit: "lb",
      history: [set("h-bp", 245, 5, 7.5, 1, "2026-10-08"), set("h-bp", 240, 10, 9, 2, "2026-10-08")],
      historyRows,
    })!;
    expect(r.this_week.find((x) => x.lift === "bench")!.e1rm_change).toMatch(/^\+0\.\d% vs best earlier this block \(306lb\)$/); // 245 × 5 @ 7.5; the 10-rep set is excluded
  });

  it("today's session isn't due until it's logged; a passed day with nothing logged is called out", () => {
    const today = buildTrainingReadout({ thisWeekId: "w3", nextWeekId: null, days, rows, sets: [], asOf: "2026-10-12", unit: "lb" })!;
    expect(today.this_week.find((x) => x.lift === "squat")).toMatchObject({ top_due: false, sets_due: 0, sets_to_come: 7 });
    const later = buildTrainingReadout({ thisWeekId: "w3", nextWeekId: null, days, rows, sets: [], asOf: "2026-10-14", unit: "lb" })!;
    expect(trainingReadoutText(later)).toContain("top set day passed with nothing logged · 0/7 squat sets logged so far");
  });

  it("a session done early counts as done; kg clients see kg", () => {
    const early = buildTrainingReadout({ thisWeekId: "w3", nextWeekId: null, days, rows, sets: [...sets, set("dl", 405, 5, 6)], asOf: "2026-10-15", unit: "kg" })!;
    expect(early.this_week.find((x) => x.lift === "deadlift")).toMatchObject({ top: "183.5kg × 5 @ RPE 6", sets_done: 1, sets_due: 1, sets_to_come: 3 });
  });
});
