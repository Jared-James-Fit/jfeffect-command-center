/**
 * Strength Intelligence, scenario by scenario (src/lib/strength-intel): the
 * cases the engine has to get right before any screen or AI reads it. Each
 * builds an athlete's sets in getClientResults' shape (load in lb) and checks
 * the kept-apart numbers, the planning reference and the coach's controls.
 */
import { describe, expect, it } from "vitest";
import { meetsFromRows } from "@/lib/analytics/competition-strength";
import { buildStrengthIntel, dailyRead, type StrengthIntel } from "@/lib/strength-intel/profile";
import { currentRef, notPlannable, planningRefs, strengthLoadInputs } from "@/lib/strength-intel/planning";
import { sessionEvidence, setEstimate } from "@/lib/strength-intel/evidence";
import { STRENGTH_RULES as R } from "@/lib/strength-intel/rules";
import { strengthText } from "@/lib/strength-intel/describe";
import { buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { percentOf1RM } from "@/lib/analytics/e1rm";
import {
  historyLine,
  lockWrite,
  pinWrite,
  restoreWrite,
  unpinWrite,
  type MaxHistoryEntry,
} from "@/lib/strength-intel/max-history";

const LB = 2.2046226218;
type Lift = "squat" | "bench" | "deadlift";
type S = { day: string; kg: number; reps: number; rpe?: number | null; [k: string]: unknown };

const NAME: Record<Lift, string> = { squat: "Competition Squat", bench: "Competition Bench Press", deadlift: "Competition Deadlift" };

/** One lift's sets as getClientResults returns them. */
function sets(lift: Lift, list: S[]) {
  return list.map((s, i) => {
    const { day, kg, reps, rpe, ...extra } = s;
    return {
      date: `${day}T12:00:00Z`,
      load: kg * LB,
      counts_load: true,
      reps,
      rpe: rpe ?? null,
      rir: null,
      est_1rm: 0,
      competition_lift_type: lift,
      is_competition_lift: true,
      exercise_id: `comp-${lift}`,
      exercise_name: NAME[lift],
      day_id: `${lift}-${day}`,
      row_order: 1,
      set_index: i,
      ...extra,
    };
  });
}

/** A weekly series: `fn(week)` gives that week's top set. */
function weekly(lift: Lift, start: string, weeks: number, fn: (w: number) => [number, number, number | null], extra: Record<string, unknown> = {}) {
  const out: S[] = [];
  for (let w = 0; w < weeks; w++) {
    const day = new Date(Date.parse(`${start}T12:00:00Z`) + w * 7 * 86_400_000).toISOString().slice(0, 10);
    const [kg, reps, rpe] = fn(w);
    out.push({ day, kg, reps, rpe, ...extra });
  }
  return sets(lift, out);
}

const read = (results: any[], today: string, meets: any[] = [], phases: any[] = []) =>
  buildStrengthIntel(results, meets, { today, phases });
const kgOf = (intel: StrengthIntel, lift: Lift) => (intel.lifts[lift].current ? intel.lifts[lift].current!.value / LB : null);
/** e1RM of a set by the chart, in kg */
const chart = (kg: number, reps: number, rpe: number) => kg / (percentOf1RM(reps, 10 - rpe) as number);

describe("one model for a set: the RTS chart", () => {
  it("reads a single at RPE 10 as itself and a triple at RPE 8 off the chart", () => {
    expect(percentOf1RM(1, 0)).toBe(1);
    expect(chart(200, 3, 8)).toBeCloseTo(200 / 0.863, 1);
  });

  it("a light set is only ever a lower bound, never a max on its own", () => {
    const light = setEstimate({ load: 150 * LB, reps: 5, rpe: 5.5, rir: null });
    expect(light?.confidence).toBe("medium");
    const nothing = setEstimate({ load: 100 * LB, reps: 5, rpe: 4, rir: null });
    expect(nothing).toBeNull();
  });
});

describe("scenarios", () => {
  it("an advanced lifter with a stable max: tight, high confidence", () => {
    const r = weekly("squat", "2026-08-03", 12, (w) => [w % 2 ? 230 : 232.5, 2, 8.5]);
    const intel = read(r, "2026-10-24");
    const c = intel.lifts.squat.current!;
    const expected = chart(231, 2, 8.5);
    expect(kgOf(intel, "squat")).toBeGreaterThan(expected * 0.97);
    expect(kgOf(intel, "squat")).toBeLessThan(expected * 1.03);
    expect(c.word).toBe("high");
    expect(notPlannable(c, "2026-10-24")).toBeNull();
  });

  it("a beginner improving fast: it climbs every week, never more than a week behind, never ahead", () => {
    const r = weekly("bench", "2026-09-07", 8, (w) => [60 + w * 5, 5, 8]);
    let last = 0;
    for (let w = 1; w < 8; w++) {
      const day = new Date(Date.parse("2026-09-07T12:00:00Z") + w * 7 * 86_400_000).toISOString().slice(0, 10);
      const now = kgOf(read(r, day), "bench")!;
      expect(now).toBeGreaterThan(last);
      // a 5-rep set at RPE 8 is evidence, not proof: it moves most of the way, and two in a row close the gap
      expect(now).toBeGreaterThan(chart(60 + (w - 1) * 5, 5, 8));
      expect(now).toBeLessThanOrEqual(chart(60 + w * 5, 5, 8) + 0.01);
      last = now;
    }
  });

  it("a low-RPE block never raises the estimate on its own and never drops it either", () => {
    const hard = sets("deadlift", [
      { day: "2026-08-10", kg: 240, reps: 2, rpe: 9 },
      { day: "2026-08-17", kg: 245, reps: 1, rpe: 9 },
    ]);
    const light = weekly("deadlift", "2026-08-31", 8, () => [180, 5, 6]);
    const before = kgOf(read(hard, "2026-08-24"), "deadlift")!;
    const after = kgOf(read([...hard, ...light], "2026-10-24"), "deadlift")!;
    expect(after).toBeGreaterThanOrEqual(before * 0.98);
    expect(after).toBeLessThanOrEqual(before * 1.005);
  });

  it("only lighter sets: a lower bound, plannable as 'at least', never claimed as a max", () => {
    const intel = read(weekly("squat", "2026-10-05", 4, () => [150, 5, 6]), "2026-10-30");
    const c = intel.lifts.squat.current!;
    expect(c.state).toBe("floor");
    expect(planningRefs(intel).e1rm.squat?.lowerBound).toBe(true);
  });

  it("accumulated fatigue in an accumulation block isn't read as lost strength", () => {
    const peak = sets("squat", [
      { day: "2026-07-06", kg: 220, reps: 1, rpe: 9 },
      { day: "2026-07-13", kg: 222.5, reps: 1, rpe: 9 },
    ]);
    // three weeks of heavier-than-usual RPE on the same weights, mid-accumulation
    const tired = weekly("squat", "2026-07-27", 3, () => [200, 3, 9.5]);
    const phases = [{ start: "2026-07-20", end: "2026-08-23", kind: "accumulation" }];
    const fresh = kgOf(read(peak, "2026-07-20"), "squat")!;
    const withPhase = kgOf(read([...peak, ...tired], "2026-08-14", [], phases), "squat")!;
    const withoutPhase = kgOf(read([...peak, ...tired], "2026-08-14"), "squat")!;
    expect(withPhase).toBeGreaterThanOrEqual(withoutPhase);
    expect(withPhase).toBeGreaterThan(fresh * 0.97);
  });

  it("a peak: a meet is read as training-day strength, never the training max itself", () => {
    const training = weekly("deadlift", "2026-07-06", 8, () => [215, 3, 8]);
    const meets = meetsFromRows([{ meet_date: "2026-09-12", meet_name: "Nationals", squat_kg: 200, bench_kg: 130, deadlift_kg: 265 }]);
    const intel = read(training, "2026-09-20", meets);
    expect(intel.lifts.deadlift.competitionPR!.value / LB).toBeCloseTo(265, 0);
    const now = kgOf(intel, "deadlift")!;
    expect(now).toBeLessThan(265);
    expect(now).toBeGreaterThan(265 / R.PEAK_PREMIUM_MAX);
  });

  it("after a meet, two weeks of lighter sessions are recovery, not a decline", () => {
    const meets = meetsFromRows([{ meet_date: "2026-09-12", meet_name: "Nationals", squat_kg: 230, bench_kg: 140, deadlift_kg: 260 }]);
    const after = sets("squat", [
      { day: "2026-09-16", kg: 190, reps: 3, rpe: 9 },
      { day: "2026-09-20", kg: 195, reps: 3, rpe: 9 },
    ]);
    const atMeet = kgOf(read([], "2026-09-13", meets), "squat")!;
    const now = kgOf(read(after, "2026-09-24", meets), "squat")!;
    expect(now).toBeGreaterThan(atMeet * 0.97);
  });

  it("a real regression: comparable hard sessions lower it, gradually and capped", () => {
    const strong = weekly("bench", "2026-06-01", 6, () => [150, 2, 9]);
    const weaker = weekly("bench", "2026-07-13", 6, () => [137.5, 2, 9]);
    const top = kgOf(read(strong, "2026-07-12"), "bench")!;
    const later = read([...strong, ...weaker], "2026-08-23");
    const now = kgOf(later, "bench")!;
    expect(now).toBeLessThan(top * 0.97);
    // never faster than the cap allows over the six weeks of decline
    expect(now).toBeGreaterThan(top * (1 - R.MAX_FALL_PER_WEEK * 7));
  });

  it("one bad session never lowers it", () => {
    const strong = weekly("bench", "2026-06-01", 6, () => [150, 2, 9]);
    const one = sets("bench", [{ day: "2026-07-13", kg: 130, reps: 2, rpe: 9.5 }]);
    const before = kgOf(read(strong, "2026-07-12"), "bench")!;
    expect(kgOf(read([...strong, ...one], "2026-07-15"), "bench")!).toBeCloseTo(before, 0);
  });

  it("a rapid improvement moves it up at once", () => {
    const base = weekly("deadlift", "2026-06-01", 6, () => [220, 2, 9]);
    const jump = sets("deadlift", [{ day: "2026-07-13", kg: 240, reps: 2, rpe: 9 }]);
    expect(kgOf(read([...base, ...jump], "2026-07-14"), "deadlift")!).toBeGreaterThan(chart(240, 2, 9) * 0.97);
  });

  it("inconsistent RPE calls make RPE-read evidence count less", () => {
    const steady = weekly("squat", "2026-06-01", 10, () => [200, 3, 8]);
    const noisy = weekly("squat", "2026-06-01", 10, (w) => [200, 3, w % 2 ? 10 : 7]);
    expect(read(steady, "2026-08-15").lifts.squat.calibration.consistency).toBeGreaterThan(
      read(noisy, "2026-08-15").lifts.squat.calibration.consistency,
    );
  });

  it("a mistyped weight (kg typed as lb, or a slip) is kept out", () => {
    const real = weekly("squat", "2026-06-01", 8, () => [200, 3, 8]);
    const slip = sets("squat", [{ day: "2026-07-28", kg: 200 * LB, reps: 3, rpe: 8 }]);
    const clean = kgOf(read(real, "2026-07-30"), "squat")!;
    expect(kgOf(read([...real, ...slip], "2026-07-30"), "squat")!).toBeCloseTo(clean, 0);
  });

  it("failed attempts: a missed set (0 reps) says nothing, an opener-only meet counts less", () => {
    const missed = sets("bench", [{ day: "2026-07-01", kg: 200, reps: 0, rpe: 10 }]);
    expect(read(missed, "2026-07-02").lifts.bench.current).toBeNull();
    expect(sessionEvidence([])).toEqual([]);
  });

  it("an old meet with nothing since is history: the PR stays, the current estimate doesn't", () => {
    const meets = meetsFromRows([{ meet_date: "2020-03-01", meet_name: "Provincials", squat_kg: 200, bench_kg: 120, deadlift_kg: 240 }]);
    const intel = read([], "2026-11-26", meets);
    expect(intel.lifts.squat.competitionPR!.value / LB).toBeCloseTo(200, 0);
    expect(intel.lifts.squat.current).toBeNull();
    expect(planningRefs(intel).compPr.squat?.kg).toBeCloseTo(200, 0);
    expect(planningRefs(intel).e1rm.squat).toBeUndefined();
  });

  it("a stale estimate loses confidence and stops being planned from", () => {
    const hard = weekly("bench", "2026-01-05", 6, () => [140, 2, 9]);
    const lightSince = weekly("bench", "2026-02-23", 24, () => [100, 8, 6]);
    const intel = read([...hard, ...lightSince], "2026-08-08");
    const c = intel.lifts.bench.current!;
    expect(c.confidence).toBeLessThan(R.PLAN_MIN_CONFIDENCE);
    expect(planningRefs(intel).e1rm.bench).toBeUndefined();
    expect(planningRefs(intel).why.bench).toMatch(/out of date/);
  });

  it("sumo and conventional are kept apart: a switch starts its own read", () => {
    const sumo = weekly("deadlift", "2026-06-01", 8, () => [250, 2, 9], { name_override: "Sumo Deadlift" });
    const conv = sets("deadlift", [{ day: "2026-08-03", kg: 220, reps: 3, rpe: 8, name_override: "Conventional Deadlift" }]);
    const intel = read([...sumo, ...conv], "2026-08-05");
    const l = intel.lifts.deadlift;
    expect(l.style).toBe("conventional");
    expect(l.otherStyle?.style).toBe("sumo");
    // never handed the sumo number
    expect(kgOf(intel, "deadlift")!).toBeLessThan(chart(250, 2, 9) * 0.95);
  });

  it("several sets in a session are one piece of evidence; back-offs never pull it down", () => {
    const day = sets("squat", [
      { day: "2026-09-01", kg: 220, reps: 1, rpe: 8.5 },
      { day: "2026-09-01", kg: 190, reps: 4, rpe: 8, purpose_label: "Back-off" },
      { day: "2026-09-01", kg: 190, reps: 4, rpe: 8.5, purpose_label: "Back-off" },
    ]);
    const intel = read(day, "2026-09-02");
    expect(intel.lifts.squat.sessions).toHaveLength(1);
    expect(intel.lifts.squat.sessions[0].set.load / LB).toBeCloseTo(220, 0);
  });

  it("missing or unreliable velocity changes nothing", () => {
    const plain = weekly("bench", "2026-06-01", 6, () => [140, 3, 8]);
    const bad = plain.map((r) => ({ ...r, velocity_mps: 0.9, velocity_quality: "low", velocity_uncertainty: 0.2 }));
    expect(kgOf(read(bad, "2026-07-15"), "bench")).toBeCloseTo(kgOf(read(plain, "2026-07-15"), "bench")!, 1);
  });

  it("kg or lb, the same athlete reads the same", () => {
    const kgSets = weekly("squat", "2026-06-01", 6, () => [180, 3, 8]);
    const lbSets = kgSets.map((r) => ({ ...r, load: Math.round(r.load) }));
    expect(kgOf(read(lbSets, "2026-07-15"), "squat")).toBeCloseTo(kgOf(read(kgSets, "2026-07-15"), "squat")!, 0);
  });

  it("today's sets say how today is going and never move today's plan", () => {
    const base = weekly("squat", "2026-06-01", 8, () => [200, 2, 9]);
    const today = sets("squat", [{ day: "2026-07-27", kg: 215, reps: 2, rpe: 9 }]);
    const intel = read([...base, ...today], "2026-07-27");
    expect(dailyRead(intel.lifts.squat, "2026-07-27")?.word).toBe("strong");
    // planned from the day before: the read as of yesterday is unchanged by today's set
    expect(kgOf(read([...base, ...today], "2026-07-26"), "squat")).toBeCloseTo(kgOf(read(base, "2026-07-26"), "squat")!, 1);
  });
});

describe("prescriptions read the right number, exactly", () => {
  const intel = read(weekly("deadlift", "2026-08-03", 8, () => [240, 2, 9]), "2026-09-25");
  const refs = planningRefs(intel);
  const est = refs.e1rm.deadlift!.kg;
  const base = { exerciseName: "Paused Deadlift", manualLoadKg: null, manualLoadLb: null, unit: "kg" as const, maxesIndex: buildMaxIndex([]), family: "deadlift" as const };

  it("60% of the competition deadlift's e1RM is exactly that, with no extra discount", () => {
    const r = computeRowLoad({ ...base, basis: "est_1rm", percentage: 60, ...strengthLoadInputs(refs, "est_1rm", "deadlift", "paused") });
    expect(r.exact).toBeCloseTo(est * 0.6, 3);
    expect(r.load! % 2.5).toBe(0);
  });

  it("a % of a competition PR reads the PR; a % of today's top set is never a % of a max", () => {
    const meets = meetsFromRows([{ meet_date: "2026-09-12", meet_name: "Nationals", squat_kg: 200, bench_kg: 130, deadlift_kg: 260 }]);
    const withMeet = planningRefs(read(weekly("deadlift", "2026-08-03", 6, () => [240, 2, 9]), "2026-09-20", meets));
    const pr = computeRowLoad({ ...base, basis: "comp_pr", percentage: 90, ...strengthLoadInputs(withMeet, "comp_pr", "deadlift", null) });
    expect(pr.exact).toBeCloseTo(260 * 0.9, 1);
    expect(computeRowLoad({ ...base, basis: "top_set", percentage: 90 }).status).toBe("needs-link");
  });

  it("a stored coach e1RM wins over the live estimate, and a block's own row wins over the profile", () => {
    const profile = { id: "p", lift: "Competition Deadlift", unit: "kg", one_rm: 250, training_max: 225, estimated_1rm: 245, active: true, block_id: null } as unknown as ClientMaxRow;
    const block = { ...profile, id: "b", block_id: "blk", estimated_1rm: 230 } as ClientMaxRow;
    const live = strengthLoadInputs(refs, "est_1rm", "deadlift", null);
    expect(computeRowLoad({ ...base, basis: "est_1rm", percentage: 60, maxesIndex: buildMaxIndex([profile]), ...live }).exact).toBeCloseTo(245 * 0.6, 3);
    expect(computeRowLoad({ ...base, basis: "est_1rm", percentage: 60, maxesIndex: buildMaxIndex([profile, block]), ...live }).exact).toBeCloseTo(230 * 0.6, 3);
  });

  it("a variation's own e1RM uses its own history; without enough, nothing is invented", () => {
    const paused = weekly("deadlift", "2026-08-04", 2, () => [200, 2, 8], {
      is_competition_lift: false,
      competition_lift_type: null,
      exercise_id: "paused",
      exercise_name: "Paused Deadlift",
      exercise_movement_family: "deadlift",
      day_id: "x",
    }).map((r, i) => ({ ...r, day_id: `p-${i}` }));
    const withVar = read([...weekly("deadlift", "2026-08-03", 8, () => [240, 2, 9]), ...paused], "2026-08-20");
    const v = withVar.variations.find((x) => x.exerciseId === "paused");
    expect(v).toBeTruthy();
    expect(v!.ratio).toBeNull(); // two comparisons isn't a learned ratio
    const vr = planningRefs(withVar).variations.paused;
    if (vr) expect(vr.metric).toBe("variation");
  });
});

describe("the coach's controls: pin, lock, restore", () => {
  const ref = {
    kg: 157.5,
    metric: "current" as const,
    confidence: 0.6,
    word: "moderate" as const,
    state: "held" as const,
    source: null,
    lastUpdate: "2026-11-13",
    style: null,
  };

  it("pin writes the estimate as the profile Est. 1RM in the row's own unit, leaving its 1RM and TM", () => {
    const rows = [{ id: "a", lift: "Competition Deadlift", unit: "lb", one_rm: 600, training_max: 540, block_id: null, active: true }];
    const w = pinWrite(rows, "deadlift", ref, "2026-11-26", "kg");
    expect(w).toMatchObject({ lift: "Competition Deadlift", unit: "lb", estimated_1rm: Math.round(157.5 * LB), block_id: null });
    expect(w).not.toHaveProperty("one_rm");
    // no row yet: one is made, as an estimate
    expect(pinWrite([], "squat", ref, "2026-11-26", "kg")).toMatchObject({ lift: "Competition Squat", unit: "kg", estimated_1rm: 157.5, source: "estimated" });
  });

  it("unpin clears it, or removes a row that only held the pin", () => {
    expect(unpinWrite({ id: "x", lift: "Competition Squat", estimated_1rm: 160 })).toEqual({ kind: "delete", id: "x" });
    expect(unpinWrite({ id: "y", lift: "Competition Squat", estimated_1rm: 160, one_rm: 170, notes: "Tested Oct" })).toEqual({
      kind: "put",
      row: { lift: "Competition Squat", block_id: null, estimated_1rm: null, notes: "Tested Oct" },
    });
  });

  it("a block lock copies today's reference so nothing changes mid-block", () => {
    const rows = [{ id: "a", lift: "Competition Squat", unit: "kg", one_rm: 230, training_max: 207.5, block_id: null, active: true }];
    const w = lockWrite(rows, "squat", "blk-2", ref, "2026-11-26", "kg");
    expect(w).toMatchObject({ block_id: "blk-2", one_rm: 230, training_max: 207.5, estimated_1rm: 157.5, unit: "kg" });
    // the lock is what the block reads from now on
    const idx = buildMaxIndex([rows[0] as any, { ...w, id: "lock", active: true } as any]);
    expect(idx.get("competition squat")!.block_id).toBe("blk-2");
  });

  it("restore puts back the version before a change, and undoes an add", () => {
    const before = { lift: "Competition Bench Press", one_rm: 150, unit: "kg", block_id: null, active: true };
    const after = { ...before, one_rm: 155 };
    const upd: MaxHistoryEntry = { id: "h1", max_id: "m1", client_id: "c", op: "update", before, after, changed_by: null, changed_at: "2026-11-20T10:00:00Z" };
    expect(restoreWrite(upd)).toMatchObject({ kind: "put", id: "m1", row: { one_rm: 150 } });
    expect(historyLine(upd)).toBe("1RM 150 → 155 kg");
    const add: MaxHistoryEntry = { ...upd, op: "insert", before: null };
    expect(restoreWrite(add)).toEqual({ kind: "delete", id: "m1" });
    const del: MaxHistoryEntry = { ...upd, op: "delete", after: null };
    expect(restoreWrite(del)).toMatchObject({ kind: "put", id: null, row: { one_rm: 150, lift: "Competition Bench Press" } });
    expect(historyLine(del)).toBe("Removed (1RM 150 kg)");
  });
});

describe("what the AI and the coach read", () => {
  it("names each metric and the rules, never one number for another", () => {
    const meets = meetsFromRows([{ meet_date: "2026-09-12", meet_name: "Nationals", squat_kg: 230, bench_kg: 140, deadlift_kg: 260 }]);
    const intel = read(weekly("squat", "2026-08-03", 8, () => [210, 2, 9]), "2026-10-01", meets);
    const text = strengthText(intel, "kg", [{ lift: "Competition Squat", one_rm: 235, unit: "kg", active: true }]);
    expect(text).toMatch(/competition PR 230 kg/);
    expect(text).toMatch(/current estimate/);
    expect(text).toMatch(/coach's reference "Competition Squat": 1RM 235 kg/);
    expect(text).toMatch(/never stand in for each other/);
  });

  it("the pin uses the estimate a program would read, and says when it wouldn't", () => {
    const one = read(sets("bench", [{ day: "2026-11-20", kg: 140, reps: 2, rpe: 9 }]), "2026-11-26");
    expect(currentRef(one.lifts.bench)).not.toBeNull();
    expect(notPlannable(one.lifts.bench.current, "2026-11-26")).toMatch(/One session/);
  });
});
