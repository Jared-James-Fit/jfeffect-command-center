import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ageCategory,
  bodyweightPhase,
  classLimit,
  developmentText,
  glPoints,
  ipfClass,
  trainingYears,
  type AthleteDevelopment,
} from "@/lib/program-intel/athlete-development";
import { buildBrief } from "@/lib/program-intel/brief";
import { experienceLevel } from "@/lib/program-intel/first-program";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import { resolveChanges, type EngineCtx } from "@/lib/program-ai/engine";
import { changeSchema } from "@/lib/program-ai/ops";
import type { IntelRecords } from "@/lib/program-intel/types";
import type { ProgramSnapshot, RowSnap } from "@/lib/program-ai/types";
import { buildRecords, ex, TODAY, type BlockSpec } from "./program-intel-scenarios";

const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const EXS = [
  ex("sq", "Competition Squat", { movement_family: "squat", is_competition_lift: true, competition_lift_type: "squat", primary_muscle_group: "Quads", muscle_groups: ["quads"], equipment: "Barbell, Rack" }),
  ex("bp", "Competition Bench Press", { movement_family: "bench", is_competition_lift: true, competition_lift_type: "bench", primary_muscle_group: "Chest", muscle_groups: ["chest"], equipment: "Barbell, Bench" }),
  ex("dl", "Competition Deadlift", { movement_family: "deadlift", is_competition_lift: true, competition_lift_type: "deadlift", primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], equipment: "Barbell" }),
  ex("lc", "Seated Leg Curl", { primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], equipment: "Machine" }),
];

type Opts = {
  experience?: string | null;
  dob?: string | null;
  sex?: string | null;
  heightCm?: number | null;
  weeks?: number;
  /** bodyweight at the start and kg per week */
  bw?: [number, number] | null;
  /** squat working load (kg) at week 1 and kg added per week */
  sq?: [number, number];
  bench?: [number, number];
  dl?: [number, number];
  /** logged RPE on every main-lift set in week w (target 8) */
  rpe?: (w: number) => number | null;
  /** reps done per main-lift set in week w (target 5) */
  reps?: (w: number) => number;
  legCurlReps?: (w: number) => number;
  skip?: (w: number, d: number) => boolean;
  meet?: { inDays: number; weightClass: string } | null;
};

/** An athlete with `weeks` of logged training ending last week, and a block starting today. */
function athlete(o: Opts = {}): IntelRecords {
  const weeks = o.weeks ?? 8;
  const start = add(TODAY, -weeks * 7);
  const sq = o.sq ?? [100, 2.5];
  const bp = o.bench ?? [70, 1.25];
  const dl = o.dl ?? [130, 2.5];
  const main = (id: string, [base, step]: [number, number], sets: number) => ({
    id,
    sets,
    reps: "5",
    rpe: "8",
    load: (w: number) => base + step * (w - 1),
    done: (w: number) => (o.reps ? o.reps(w) : 5),
    rpeLog: (w: number) => (o.rpe ? o.rpe(w) : 8),
  });
  const days = (weekShift: number): BlockSpec["days"] => [
    { title: "Squat + Bench", exercises: [main("sq", [sq[0] + sq[1] * weekShift, sq[1]], 3), main("bp", [bp[0] + bp[1] * weekShift, bp[1]], 3)] },
    { title: "Deadlift + Hamstrings", exercises: [main("dl", [dl[0] + dl[1] * weekShift, dl[1]], 2), { id: "lc", sets: 3, reps: "10-12", rpe: "8", load: () => 40, done: (w: number) => (o.legCurlReps ? o.legCurlReps(w) : 10), rpeLog: () => null }] },
  ];
  const rec = buildRecords({
    exercises: EXS,
    blocks: [
      { id: "hist", name: "History", start, weeks, offsets: [0, 3], days: days(0), skip: o.skip },
      { id: "next", name: "Next block", start: TODAY, weeks: 4, offsets: [0, 3], days: days(weeks) },
    ],
  });
  rec.client = {
    ...rec.client,
    preferred_weight_unit: "kg",
    sex: o.sex === undefined ? "male" : o.sex,
    date_of_birth: o.dob === undefined ? "1996-03-01" : o.dob,
    height_cm: o.heightCm === undefined ? 178 : o.heightCm,
    intake_training_experience: o.experience === undefined ? "3–5 years" : o.experience,
    is_powerlifter: true,
  } as any;
  if (o.bw !== null) {
    const [b0, step] = o.bw ?? [85, 0];
    rec.bodyweight = Array.from({ length: Math.floor((weeks * 7) / 4) + 1 }, (_, i) => ({ date: add(start, i * 4), kg: Math.round((b0 + (step * i * 4) / 7) * 10) / 10 }));
  } else rec.bodyweight = [];
  if (o.meet) rec.preps = [{ id: "prep", title: "Meet", goal_type: "meet", event_name: "Provincials", event_date: add(TODAY, o.meet.inDays), federation: "CPU", weight_class: o.meet.weightClass, division: "Open", status: "active", coach_notes: null }] as any;
  return rec;
}

const dev = (o: Opts = {}): AthleteDevelopment => buildGeneratorIntel(athlete(o)).development;
const signal = (d: AthleteDevelopment, name: string) => d.progression.find((p) => p.exercise === name)!;
const lift = (d: AthleteDevelopment, l: string) => d.lifts.find((x) => x.lift === l)!;

describe("standard scoring is exact", () => {
  it("IPF GL points match the published reference results", () => {
    // OpenPowerlifting's own test cases for the IPF GL formula
    expect(glPoints(1035, 92.04, "M", "sbd", "equipped")).toBeCloseTo(112.85, 2);
    expect(glPoints(122.5, 70.5, "F", "bench", "classic")).toBeCloseTo(96.78, 2);
    expect(glPoints(600, 34, "M")).toBeNull();
    expect(glPoints(600, 93, null)).toBeNull();
  });

  it("weight classes, age categories and training age read the way coaches write them", () => {
    expect(ipfClass(82.4, "M")).toEqual({ label: "83 kg", limitKg: 83 });
    expect(ipfClass(130, "M")).toEqual({ label: "120+ kg", limitKg: null });
    expect(ipfClass(51, "M", 20)).toEqual({ label: "53 kg", limitKg: 53 });
    expect(ipfClass(51, "M", 30)).toEqual({ label: "59 kg", limitKg: 59 });
    expect(ipfClass(62, "F")).toEqual({ label: "63 kg", limitKg: 63 });
    expect(classLimit("-74kg")).toBe(74);
    expect(classLimit("84+")).toBeNull();
    expect(ageCategory(21)).toBe("Junior (19–23)");
    expect(ageCategory(52)).toBe("Masters 2 (50–59)");
    expect(trainingYears("3–5 years")).toBe(4);
    expect(trainingYears("6 months, never serious")).toBe(0.5);
    expect(trainingYears("14 years")).toBe(14);
    expect(trainingYears("Less than 1 year")).toBe(0.5);
    // the experience parser used to miss any number of years over 10
    expect(experienceLevel("14 years")).toBe("advanced");
    expect(experienceLevel("3–5 years")).toBe("intermediate");
  });
});

describe("bodyweight-adjusted strength", () => {
  it("gaining: strength up slower than bodyweight reads as expected, not as progress or failure", () => {
    const d = dev({ bw: [80, 0.5], sq: [120, 0.5], weeks: 10 });
    expect(d.phase?.phase).toBe("gaining");
    const s = lift(d, "squat");
    expect(s.changePct).toBeGreaterThan(0);
    expect(s.relChangePct).toBeLessThan(0);
    expect(s.reading).toMatch(/strength rose slower than bodyweight: expected while gaining; bodyweight alone isn't proof of muscle/);
  });

  it("cutting: holding strength is the win, and relative strength goes up", () => {
    const d = dev({ bw: [90, -0.6], sq: [140, 0], weeks: 10 });
    expect(d.phase?.phase).toBe("cutting");
    const s = lift(d, "squat");
    expect(s.relChangePct).toBeGreaterThan(0);
    expect(s.reading).toMatch(/held strength while losing weight/);
  });

  it("maintaining: absolute and relative move together", () => {
    const d = dev({ bw: [85, 0], sq: [120, 1.5], weeks: 10 });
    expect(d.phase?.phase).toBe("maintaining");
    const s = lift(d, "squat");
    expect(Math.sign(s.changePct!)).toBe(Math.sign(s.relChangePct!));
    expect(s.reading).not.toMatch(/gaining|losing/);
  });

  it("no bodyweight on file: no relative read, never a guess, and it says it's missing", () => {
    const d = dev({ bw: null });
    expect(lift(d, "squat").relLast).toBeNull();
    expect(lift(d, "squat").reading).toMatch(/no bodyweight on those dates/);
    expect(d.phase).toBeNull();
    expect(d.missing.map((m) => m.field)).toContain("Bodyweight log");
  });

  it("gym totals are estimates with GL points; only meet results are competition results", () => {
    const d = dev({ bw: [92, 0] });
    expect(d.gymTotal?.kg).toBeGreaterThan(0);
    expect(d.gymTotal?.gl).toBeGreaterThan(0);
    const t = developmentText(d, "kg");
    expect(t).toMatch(/Gym total \(e1RM estimate, NOT a meet result\)/);
  });

  it("lightweight vs heavyweight: same training, different class and GL, same coaching call", () => {
    const light = dev({ sex: "female", bw: [59, 0], sq: [80, 1.5], bench: [45, 0.5], dl: [100, 1.5] });
    const heavy = dev({ sex: "male", bw: [118, 0], sq: [200, 3], bench: [140, 1.5], dl: [240, 3] });
    expect(light.weightClass?.current?.label).toBe("63 kg");
    expect(heavy.weightClass?.current?.label).toBe("120 kg");
    expect(light.gymTotal!.gl).toBeGreaterThan(heavy.gymTotal!.gl! * 0.5);
    // the same pattern of sessions gets the same decision; size alone doesn't change it
    expect(signal(light, "Competition Squat").decision).toBe(signal(heavy, "Competition Squat").decision);
  });

  it("over the class limit for a meet: the rate needed is spelled out", () => {
    const d = dev({ bw: [86, 0], meet: { inDays: 42, weightClass: "83" } });
    expect(d.weightClass?.marginKg).toBe(-3);
    expect(d.weightClass?.neededPctPerWeek).toBeCloseTo(0.58, 1);
    expect(developmentText(d, "kg")).toMatch(/3 kg OVER the limit with 6 weeks to the meet/);
  });
});

describe("progress / hold / back off", () => {
  it("rapid progress: every rep done well under the target RPE → progress", () => {
    const d = dev({ rpe: () => 6.5 });
    const s = signal(d, "Competition Squat");
    expect(s.decision).toBe("progress");
    expect(s.why).toMatch(/easier than prescribed in 3 of the last 3 sessions/);
  });

  it("one hard session is a fluctuation, not a reason to change", () => {
    const d = dev({ rpe: (w) => (w === 7 ? 9.5 : 8), reps: (w) => (w === 7 ? 3 : 5) });
    const s = signal(d, "Competition Squat");
    expect(s.decision).toBe("maintain");
    expect(s.why).toMatch(/one session fell short/);
  });

  it("a plateau with missed reps and RPE over target, three sessions running → back off", () => {
    const d = dev({ sq: [140, 0], rpe: (w) => (w >= 6 ? 9.5 : 8.5), reps: (w) => (w >= 6 ? 3 : 5), weeks: 8 });
    const s = signal(d, "Competition Squat");
    expect(s.decision).toBe("regress");
    expect(s.method).toMatch(/drop the load/);
  });

  it("the same hard sessions in a cut, with the reps still done, are held instead of cut back", () => {
    const d = dev({ bw: [92, -0.6], sq: [140, 0], rpe: (w) => (w >= 6 ? 9.5 : 8), reps: () => 5, weeks: 8 });
    const s = signal(d, "Competition Squat");
    expect(d.phase?.phase).toBe("cutting");
    expect(s.decision).toBe("maintain");
    expect(s.why).toMatch(/they're cutting: hold it/);
  });

  it("an accessory at the top of its rep range with no RPE logged → progress by double progression", () => {
    const d = dev({ legCurlReps: () => 12 });
    const s = signal(d, "Seated Leg Curl");
    expect(s.decision).toBe("progress");
    expect(s.method).toMatch(/double progression/);
  });

  it("beginner vs advanced: the same rate of progress reads differently and is progressed differently", () => {
    // ~3.5%/month: a normal beginner's rate, well past an advanced lifter's
    const fast = { rpe: () => 6.5, sq: [100, 0.8] as [number, number] };
    const beginner = dev({ ...fast, experience: "Less than 1 year" });
    const advanced = dev({ ...fast, experience: "More than 5 years" });
    expect(beginner.level).toBe("beginner");
    expect(advanced.level).toBe("advanced");
    expect(lift(beginner, "squat").rate).toBe("within");
    expect(lift(advanced, "squat").rate).toBe("above");
    expect(signal(beginner, "Competition Squat").method).toMatch(/smallest load jump next session/);
    expect(signal(advanced, "Competition Squat").method).toMatch(/keep the RPE target and let the load ride the e1RM/);
  });

  it("younger vs older with the same data: the age category differs, the coaching call doesn't", () => {
    const young = dev({ dob: "2004-05-01" });
    const older = dev({ dob: "1972-05-01" });
    expect(young.ageCategory).toBe("Junior (19–23)");
    expect(older.ageCategory).toBe("Masters 2 (50–59)");
    expect(young.progression.map((p) => [p.exercise, p.decision])).toEqual(older.progression.map((p) => [p.exercise, p.decision]));
  });

  it("not enough logged sessions → no change on assumptions", () => {
    const d = dev({ weeks: 1 });
    expect(signal(d, "Competition Squat").decision).toBe("not_enough_data");
  });
});

describe("trends", () => {
  it("inconsistent adherence: the drop and the workout they keep missing are named", () => {
    const d = dev({ weeks: 12, skip: (w, day) => (w >= 9 && day === 1) || w === 11 });
    expect(d.adherence.trend).toBe("declining");
    expect(d.adherence.missed.map((m) => m.workout)).toContain("Deadlift + Hamstrings");
  });

  it("a plateau is dated from their best, and small data is said to be small", () => {
    const d = dev({ sq: [140, 0], weeks: 8 });
    expect(lift(d, "squat").plateauWeeks).toBeGreaterThanOrEqual(3);
    expect(lift(dev({ weeks: 3 }), "squat").confidence).toBe("low");
  });

  it("possible fatigue accumulation needs more than one sign", () => {
    const d = dev({ rpe: (w) => (w >= 6 ? 9.5 : 8), weeks: 8 });
    expect(d.fatigue.signs.join(" ")).toMatch(/feel harder than prescribed lately/);
  });

  it("bodyweight phase needs 3+ weigh-ins over 2+ weeks", () => {
    expect(bodyweightPhase([{ date: "2026-10-30", kg: 80 }, { date: "2026-11-01", kg: 81 }], "2026-11-01")).toBeNull();
  });
});

describe("missing information is listed, never filled in", () => {
  it("no birth date, sex, height or experience → each named with why it matters", () => {
    const d = dev({ dob: null, sex: null, heightCm: null, experience: null });
    expect(d.missing.map((m) => m.field)).toEqual(expect.arrayContaining(["Date of birth", "Sex", "Height", "Training experience"]));
    expect(d.gymTotal?.gl ?? null).toBeNull();
    expect(d.age).toBeNull();
    const t = developmentText(d, "kg");
    expect(t).toMatch(/age not on file · sex not on file · height not on file/);
    expect(t).toMatch(/Not on file \(never guess these\)/);
  });
});

describe("it reaches every AI feature, and it changes what the editor accepts", () => {
  it("the shared brief (Edit with AI and every Generate Next Program stage) carries it", () => {
    const intel = buildGeneratorIntel(athlete({ rpe: () => 6.5 }));
    const b = buildBrief(intel, { setup: intel.recommendation.setup, edited: [], conflicts: [], redistribution: null });
    expect(b.text).toContain("## Athlete development (computed from their records)");
    expect(b.text).toMatch(/Competition Squat: PROGRESS/);
    for (const f of ["src/lib/program-intel/generator-prompts.ts", "src/lib/program-ai/prompts.ts", "src/lib/program-intel/next-program.ts"]) expect(readFileSync(f, "utf8")).toContain("DEVELOPMENT_RULES");
    expect(readFileSync("src/lib/program-intel/jobs.server.ts", "utf8")).toContain("## Athlete development (computed from their records)");
  });

  it("asking more of an exercise the records say to back off is flagged on the change", () => {
    const row = (sets: number): RowSnap => ({ id: "r1", ref: "B1W1D1E1", dayId: "d1", sortOrder: 0, exerciseId: "sq", name: "Competition Squat", nameOverride: null, sets, reps: "5", rpe: "8", rir: null, percentage: null, percentageBasis: null, loadKg: null, loadLb: null, loadUnit: null, manualOverride: false, restSeconds: 180, restOverride: null, tempo: null, notes: null, timeProfile: "main_lift", purposeLabel: null, measurementType: "reps", trackingType: "reps_weight", durationSeconds: null, cardio: false, updatedAt: null });
    const snap: ProgramSnapshot = { kind: "client", clientId: "c", templateId: null, title: "A", unit: "kg", today: TODAY, trainingDays: [], blocks: [{ id: "b", ref: "B1", name: "B", status: "Active", visible: true, start: null, end: null, current: true, weeks: [{ id: "w", ref: "B1W1", blockId: "b", weekIndex: 1, start: null, end: null, phase: null, days: [{ id: "d1", ref: "B1W1D1", weekId: "w", dayIndex: 1, title: "Squat", subtitle: null, focus: null, date: null, lock: null, isCustom: false, updatedAt: null, rows: [row(3)] }] }] }] };
    const cat = { code: "X1", id: "sq", name: "Competition Squat", muscle: null, equipment: "Barbell", family: "squat", video: true, timeProfile: "main_lift", defaultRest: 180, standard: null };
    const ctx: EngineCtx = { catalog: new Map([["X1", cat]]), byId: new Map([["sq", cat]]), signals: new Map([["sq", { decision: "regress" as const, why: "fell short in 3 of the last 3 sessions" }]]) };
    const more = changeSchema.parse({ id: "c1", title: "More squat", basis: "speculative", ops: [{ op: "update", rows: ["B1W1D1E1"], set: { sets: 4 } }] });
    const less = changeSchema.parse({ id: "c2", title: "Less squat", basis: "data", ops: [{ op: "update", rows: ["B1W1D1E1"], set: { sets: 2 } }] });
    const [m, l] = resolveChanges(snap, [more, less], ctx);
    expect(m.issues.map((i) => i.text)).toContain("Competition Squat: their records say back off (fell short in 3 of the last 3 sessions), and this asks for more.");
    expect(l.issues.some((i) => /back off/.test(i.text))).toBe(false);
  });
});
