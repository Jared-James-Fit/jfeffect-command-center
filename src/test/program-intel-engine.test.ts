import { describe, expect, it } from "vitest";
import { repRange, rpeRange, setLine } from "@/lib/program-intel/core";
import { isStalled, trend } from "@/lib/program-intel/analyze";
import { buildIntelReport, recordsHash } from "@/lib/program-intel/report";
import { classifyProgram } from "@/lib/program-intel/classify";
import { fixture } from "./program-intel-fixture";

const settings = { e1rmFormula: "epley" as const, workingRpeMin: 6, muscleTargets: {} };
const base = { id: "x", row_id: "r", set_index: 1, actual_load: null, actual_load_unit: null, normalized_kg: null, actual_load_kg: null, actual_reps: null, actual_rpe: null, actual_rpe_num: null, actual_rir: null, is_working_set: null, is_bodyweight: false, load_type: "external", completed_at: "2026-10-06T18:00:00Z", completed_duration_seconds: null, notes: null };

describe("Program Intelligence: reading one logged set", () => {
  it("prescriptions: reps and RPE ranges, AMRAP has no range", () => {
    expect(repRange("5")).toEqual([5, 5]);
    expect(repRange("8-10")).toEqual([8, 10]);
    expect(repRange("AMRAP")).toBeNull();
    expect(rpeRange("@7-8")).toEqual([7, 8]);
    expect(rpeRange("")).toBeNull();
  });
  it("kg comes from the stored normalized value; a pound load without one converts from its own unit", () => {
    expect(setLine({ ...base, normalized_kg: 100, actual_reps: 5 }, settings, null).kg).toBe(100);
    expect(setLine({ ...base, actual_load: 225, actual_load_unit: "lb", actual_reps: 5 }, settings, null).kg).toBe(102.06);
    // a number with no unit is never guessed
    expect(setLine({ ...base, actual_load: 225, actual_reps: 5 }, settings, null).kg).toBeNull();
  });
  it("e1RM uses the app's formula with RPE as reps in reserve, only for external loads of 12 reps or fewer", () => {
    expect(setLine({ ...base, normalized_kg: 140, actual_reps: 5, actual_rpe_num: 7 }, settings, null).e1rm).toBe(177.3);
    expect(setLine({ ...base, normalized_kg: 40, actual_reps: 15, actual_rpe_num: 8 }, settings, null).e1rm).toBeNull();
    expect(setLine({ ...base, normalized_kg: 10, actual_reps: 8, load_type: "bodyweight" }, settings, null).e1rm).toBeNull();
    // RIR only: read as RPE 10 - RIR
    expect(setLine({ ...base, normalized_kg: 100, actual_reps: 5, actual_rir: "2" }, settings, null).rpe).toBe(8);
  });
  it("warm-ups (flagged, or below the client's working RPE) aren't working sets; hard sets are RPE 6+ or unrated", () => {
    expect(setLine({ ...base, normalized_kg: 60, actual_reps: 5, actual_rpe_num: 8, is_working_set: false }, settings, null).working).toBe(false);
    expect(setLine({ ...base, normalized_kg: 60, actual_reps: 5, actual_rpe_num: 5 }, settings, null).working).toBe(false);
    const unrated = setLine({ ...base, normalized_kg: 60, actual_reps: 5 }, settings, null);
    expect(unrated.working && unrated.hard).toBe(true);
  });
});

describe("Program Intelligence: trends", () => {
  it("first / last are the best of the first and last two once there are four points; slope is per week", () => {
    const t = trend([
      { date: "2026-10-01", value: 100 },
      { date: "2026-10-08", value: 102 },
      { date: "2026-10-15", value: 104 },
      { date: "2026-10-22", value: 106 },
    ]);
    expect(t.first).toBe(102);
    expect(t.last).toBe(106);
    expect(t.peak).toBe(106);
    expect(t.changePct).toBe(3.9);
    expect(t.slopePerWeek).toBe(2);
  });
  it("stalled: no new best (within 1%) in the last three of four or more exposures over three weeks", () => {
    const pts = (vals: number[]) => vals.map((value, i) => ({ date: `2026-10-${String(1 + i * 7).padStart(2, "0")}`, value }));
    expect(isStalled(pts([100, 110, 109, 110.5, 108]))).toBe(true);
    expect(isStalled(pts([100, 104, 108, 112]))).toBe(false);
    expect(isStalled(pts([100, 101, 102]))).toBe(false);
  });
});

describe("Program Intelligence: the report from a known program", () => {
  const r = buildIntelReport(fixture());
  it("day status: done, partly logged, missed (past with no logs) and upcoming", () => {
    expect(r.days.map((d) => `${d.dayId}:${d.status}`)).toEqual(["d1a:completed", "d1b:completed", "d2a:partial", "d2b:missed", "d3a:upcoming", "d3b:upcoming"]);
    expect(r.coverage.dueDays).toBe(4);
    expect(r.coverage.completedDays + r.coverage.partialDays).toBe(3);
    expect(r.coverage.upcomingDays).toBe(2);
  });
  it("prescribed vs actual: sets due, working sets logged (warm-ups out), per-row status and RPE gap", () => {
    expect(r.coverage.prescribedSetsDue).toBe(18);
    expect(r.coverage.workingSets).toBe(11);
    const w2sq = r.days.find((d) => d.dayId === "d2a")!.rows.find((x) => x.rowId === "r2sq")!;
    expect(w2sq.status).toBe("partial");
    expect(w2sq.workingSetsDone).toBe(2);
    expect(w2sq.rpeDelta).toBe(1);
    expect(r.days.find((d) => d.dayId === "d2a")!.rows.find((x) => x.rowId === "r2le")!.status).toBe("skipped");
    const w2 = r.weeks.find((w) => w.weekIndex === 2)!;
    expect(w2.prescribedSetsDue).toBe(9);
    expect(w2.workingSetsLogged).toBe(2);
    expect(w2.setAdherencePct).toBe(22);
    expect(w2.sessionAdherencePct).toBe(50);
  });
  it("hard sets per muscle: primary 1.0, secondary 0.5", () => {
    const w1 = r.weeks.find((w) => w.weekIndex === 1)!;
    expect(w1.hardSetsByMuscle.Quads).toBe(6);
    expect(w1.hardSetsByMuscle.Glutes).toBe(1.5);
    expect(w1.hardSetsByMuscle.Chest).toBe(3);
  });
  it("squat: e1RM 177.3 → 185 (+4.3%) is a fact with its sets as evidence; bench has too few exposures (missing)", () => {
    const sq = r.lifts.find((l) => l.lift === "squat")!;
    expect(sq.compTrend.first).toBe(177.3);
    expect(sq.compTrend.last).toBe(185);
    expect(sq.compTrend.changePct).toBe(4.3);
    const imp = r.findings.find((f) => f.id === "pl:squat:improved")!;
    expect(imp.kind).toBe("fact");
    expect(imp.evidence.join(" ")).toContain("150kg×5 @8");
    expect(r.findings.find((f) => f.id === "pl:bench:few")!.kind).toBe("missing");
  });
  it("classified as powerlifting from the goals, the meet prep and the program's structure, with its reasons", () => {
    const c = classifyProgram(fixture());
    expect(c.auto).toBe("powerlifting");
    expect(c.reasons.join(" ")).toContain("meet prep");
    expect(r.brain).toBe("powerlifting");
    expect(r.brainSource).toBe("auto");
    const bb = buildIntelReport(fixture(), { brainOverride: "bodybuilding" });
    expect(bb.brain).toBe("bodybuilding");
    expect(bb.brainSource).toBe("override");
    expect(bb.findings.some((f) => f.id.startsWith("bb:"))).toBe(true);
    expect(bb.findings.some((f) => f.id.startsWith("pl:"))).toBe(false);
  });
  it("hypotheses are never facts, and every finding is one of fact / hypothesis / missing", () => {
    for (const f of r.findings) expect(["fact", "hypothesis", "missing"]).toContain(f.kind);
    expect(r.findings.filter((f) => f.id.endsWith(":why")).every((f) => f.kind === "hypothesis")).toBe(true);
    expect(r.findings.find((f) => f.id === "recovery:pain:knee")!.kind).toBe("fact");
  });
  it("a date window keeps only the workouts in it", () => {
    const d = buildIntelReport(fixture({ scope: { kind: "dates", label: "Oct 7 – 14", from: "2026-10-07", to: "2026-10-14", blockIds: ["b1"] } }));
    expect(d.days.map((x) => x.dayId)).toEqual(["d1b", "d2a"]);
  });
  it("the data hash changes when a logged value changes, not when nothing does", () => {
    const a = recordsHash(fixture());
    expect(recordsHash(fixture())).toBe(a);
    const changed = fixture();
    changed.results[0] = { ...changed.results[0], actual_reps: 6 };
    expect(recordsHash(changed)).not.toBe(a);
  });
});
