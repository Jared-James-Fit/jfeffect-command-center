import { describe, expect, it } from "vitest";
import { auditProgram, heavyClashes, maxRepsAt, unsupportedTokens } from "@/lib/program-intel/audit";
import { buildBrief } from "@/lib/program-intel/brief";
import { missingEquipment, requirementsOf } from "@/lib/program-intel/equipment";
import { setupSchema, type BuiltBlock, type BuiltProgram, type Strategy } from "@/lib/program-intel/generator-schemas";
import { buildGeneratorIntel, type GeneratorIntel } from "@/lib/program-intel/intelligence";
import { sliceRecords } from "@/lib/program-intel/load";
import { generatedProgramOutcomes } from "@/lib/program-intel/outcomes";
import { blockStructure, findConflicts, redistribution, type GenerationSetup } from "@/lib/program-intel/recommend";
import { calibrationFactor, estimateDay } from "@/lib/program-intel/session-time";
import { bodybuilder, homeGym, powerlifter, sparse, TODAY } from "./program-intel-scenarios";

const setupWith = (intel: GeneratorIntel, patch: Partial<GenerationSetup>): GenerationSetup => ({ ...intel.recommendation.setup, ...patch });
const lookup = (intel: GeneratorIntel) => (r: { id: string | null; name: string }) => (r.id ? intel.exercises.get(r.id) ?? null : null) ?? { name: r.name, equipment: null };

describe("Home-gym athlete (4-day strength + hypertrophy, the real test case)", () => {
  const intel = buildGeneratorIntel(homeGym());
  const s = intel.recommendation.setup;
  const why = intel.recommendation.why;

  it("follows up the program they just finished, with the counts defined and consistent", () => {
    expect(intel.ctx.previous?.label).toBe("Home Gym 4-Day Strength + Hypertrophy");
    const c = intel.prev!.coverage;
    expect(c.prescribedSetsDue).toBe(224);
    expect(c.loggedSets).toBe(224);
    // the two sets logged at RPE 4 and 5 are completed sets (effort doesn't decide completion)…
    expect(c.completedSets).toBe(224);
    // …but not working volume
    expect(c.workingSets).toBe(222);
    expect(c.setsWithRpePct).toBe(100);
    expect(c.completedDays + c.partialDays).toBe(16);
    expect(c.partialDays).toBe(1);
    const q = intel.quality!;
    expect(q.definitions.map((d) => d.key)).toEqual(["prescribed", "completed", "records", "skipped", "incomplete", "extra", "modified", "not_counted", "working"]);
    expect(q.issues.find((i) => i.key === "low-effort")?.title).toContain("2 completed sets logged below RPE 6");
    expect(q.issues.find((i) => i.key === "not-finished")).toBeTruthy();
    expect(q.confidence.find((x) => x.topic.startsWith("Effort"))?.level).toBe("high");
  });
  it("reads it as powerbuilding (strength + hypertrophy), not bodybuilding because of the accessories", () => {
    expect(intel.classification.auto).toBe("powerbuilding");
    expect(intel.classification.reasons.join(" ")).toMatch(/strength \+ hypertrophy/i);
    expect(s.brain).toBe("powerbuilding");
  });
  it("4 days on their training schedule (where the workouts land; Goals & Setup follows it), with the last program as context", () => {
    expect(s.daysPerWeek).toBe(4);
    expect(why.daysPerWeek?.source).toBe("Training schedule");
    expect(why.daysPerWeek?.reason).toMatch(/Monday, Tuesday, Wednesday, Friday/);
    expect(why.daysPerWeek?.reason).toMatch(/last program: 4 days/);
    expect(s.trainingDays).toEqual(["Monday", "Tuesday", "Wednesday", "Friday"]);
    // 12 weeks written at a time (no deadline on file), whatever the last program's length
    expect(s.weeks).toBe(12);
    expect(s.durationMode).toBe("default");
    expect(s.startDate).toBe("2026-11-09");
    expect(s.blocks).toEqual([]);
  });
  it("session length from their logged sessions, within the stated limit", () => {
    expect(intel.ctx.session.observedMedian).toBeGreaterThanOrEqual(50);
    expect(s.sessionMinutes).toBe(55);
    expect(s.maxSessionMinutes).toBe(75);
    expect(intel.recommendation.baseline.calibration).not.toBeNull();
  });
  it("equipment: proven by the home program, not the stale commercial-gym checklist (and the conflict is named)", () => {
    const e = intel.equipment;
    expect(e.source).toBe("program");
    expect(e.home).toBe(true);
    for (const i of ["barbell", "rack", "dumbbells", "adjustable_bench", "cable_high", "cable_low", "landmine", "leg_extension", "leg_curl"]) expect(e.items).toContain(i);
    expect(e.items).not.toContain("machines");
    expect(e.items).not.toContain("leg_press");
    expect(e.conflicts[0]).toMatch(/Commercial gym/);
    expect(e.cableStations).toBe(1);
    expect(e.constraints.join(" ")).toMatch(/One cable column/);
    expect(e.constraints.join(" ")).toMatch(/stations/);
    expect(missingEquipment({ name: "Leg Press", equipment: "Machine" }, e)).not.toEqual([]);
    expect(missingEquipment({ name: "Wide-Grip Lat Pulldown", equipment: "Cable" }, e)).toEqual([]);
  });
  it("what the program tells us: improvements and effective progressions from the logs, keep / reconsider lists", () => {
    const r = intel.review!;
    expect(r.improvements.length).toBeGreaterThan(0);
    expect(r.improvements.every((i) => i.kind === "fact")).toBe(true);
    expect(r.effective.some((i) => /every prescribed set done/.test(i.title))).toBe(true);
    expect(r.maintain.some((i) => /4 training days a week/.test(i.title))).toBe(true);
    expect(s.retain.map((x) => x.name)).toContain("Competition Squat");
    expect(r.workload.some((i) => /hard sets per week/.test(i.title))).toBe(true);
  });
  it("cross-program patterns need repeated evidence", () => {
    expect(intel.ctx.history.programs.map((p) => p.label)).toEqual(["Block 1 — Foundation", "MARC — At-Home Upper / Lower — 4 Days/Week", "Home Gym 4-Day Strength + Hypertrophy"]);
    const consistent = intel.patterns.filter((p) => p.id.endsWith(":progresses"));
    expect(consistent.length).toBeGreaterThan(0);
    expect(consistent.every((p) => p.level === "recurring")).toBe(true);
  });
  it("changing 4 → 3 days redistributes the workload on purpose, and names it when sessions won't fit", () => {
    const three = setupWith(intel, { daysPerWeek: 3, trainingDays: [] });
    const red = redistribution(three, intel.recommendation.baseline)!;
    expect(red.fromDays).toBe(4);
    expect(red.toDays).toBe(3);
    expect(red.weeklySets).toBe(56);
    expect(red.perSessionAfter).toBeGreaterThan(red.perSessionBefore);
    expect(red.estMinutesAfter!).toBeGreaterThan(red.estMinutesBefore!);
    expect(red.lines.join(" ")).toMatch(/full-body/);
    const tight = setupWith(intel, { daysPerWeek: 3, trainingDays: [], maxSessionMinutes: 55 });
    const conflicts = findConflicts(tight, intel.ctx, intel.recommendation.baseline, lookup(intel), s);
    expect(conflicts.find((c) => c.id === "redistribution")?.options.join(" ")).toMatch(/Trim to about \d+ sets/);
  });
  it("the brief carries the whole previous program set by set, the setup, the coach's changes and data quality", () => {
    const three = setupWith(intel, { daysPerWeek: 3, trainingDays: [] });
    const b = buildBrief(intel, { setup: three, edited: ["daysPerWeek"], conflicts: [], redistribution: redistribution(three, intel.recommendation.baseline) });
    expect(b.sections.map((x) => x.key)).toEqual(["athlete", "development", "setup", "timeline", "cardio", "requirements", "quality", "previous", "patterns", "memory", "notes", "log", "earlier"]);
    expect(b.text).toContain("Changed by the coach");
    expect(b.text).toContain("Days per week: the coach changed it");
    expect(b.text).toContain("4 → 3 days");
    expect((b.text.match(/^#### Day \d/gm) ?? []).length).toBeGreaterThanOrEqual(16 + 32);
    expect(b.text).toContain("Equipment rules");
    expect(b.warnings).toEqual([]);
    expect(b.sections.every((x) => x.detail === "full")).toBe(true);
  });
  it("building reads a compact brief: no set-by-set logs, but the measured exercises, load references and the last program's layout", () => {
    const b = buildBrief(intel, { setup: s, edited: [], conflicts: [], redistribution: null, exclude: ["log", "earlier"] });
    expect(b.sections.map((x) => x.key)).toEqual(["athlete", "development", "setup", "timeline", "cardio", "requirements", "quality", "previous", "patterns", "memory", "notes"]);
    expect(b.text).not.toContain("## Previous program: full log");
    expect(b.text).toContain("Load references (latest sets of each exercise)");
    expect(b.text).toContain("Station 2 — High cable");
    expect(b.chars).toBeLessThan(70_000);
  });
  it("if earlier programs don't fit the budget they're summarized per exercise, and it says so (never silently)", () => {
    const b = buildBrief(intel, { setup: s, edited: [], conflicts: [], redistribution: null, budgetChars: 60_000 });
    const earlier = b.sections.find((x) => x.key === "earlier")!;
    expect(earlier.detail).toBe("summary");
    expect(earlier.note).toMatch(/logged sets didn't fit/);
    expect(b.warnings.join(" ")).toMatch(/summarized/);
    expect(b.text).toContain("NOTE: Earlier programs summarized");
    // the previous program is still complete
    expect(b.sections.find((x) => x.key === "log")!.detail).toBe("full");
  });
});

describe("Powerlifter (3 blocks, top sets + back-offs, meet on file, partial RPE)", () => {
  const intel = buildGeneratorIntel(powerlifter());
  const s = intel.recommendation.setup;
  it("is powerlifting, built back from the meet", () => {
    expect(intel.classification.auto).toBe("powerlifting");
    // the meet falls in week 10 from the start: the goal timeline runs the program to it
    expect(s.weeks).toBe(10);
    expect(s.durationMode).toBe("goal");
    expect(intel.recommendation.why.weeks?.source).toBe("Goal timeline");
    expect(intel.recommendation.why.weeks?.reason).toMatch(/Nationals \(2027-01-11\) falls in week 10: the program runs to it/);
    // the strategy picks the phases and their lengths around the meet
    expect(s.blocks).toEqual([]);
    expect(s.meetDate).toBe(intel.ctx.competition.next!.date);
  });
  it("previous program = the whole meet prep (3 blocks); each lift read on its own", () => {
    expect(intel.prev!.blocks).toHaveLength(3);
    expect(intel.prev!.lifts.map((l) => l.lift)).toEqual(["squat", "bench", "deadlift"]);
    expect(intel.recommendation.baseline.liftFreq.bench).toBeGreaterThan(1);
  });
  it("partial RPE lowers confidence instead of pretending", () => {
    const eff = intel.quality!.confidence.find((c) => c.topic.startsWith("Effort"))!;
    expect(["medium", "low"]).toContain(eff.level);
    expect(eff.instead).toBeTruthy();
  });
  it("bench progressed in the blocks with more bench work: an association across blocks, labeled as such", () => {
    const p = intel.patterns.find((x) => x.id === "lift:bench:dose");
    expect(p).toBeTruthy();
    // close-grip bench counts as bench work, so the blocks differ in weekly sets, not sessions
    expect(p!.statement).toMatch(/Bench progressed in 2 of 3 blocks; those blocks had more weekly sets/);
    expect(p!.caveat).toMatch(/not proof of cause/);
  });
  it("low-back pain reports after deadlift sessions are an association, not a diagnosis", () => {
    const pain = intel.patterns.find((x) => x.id.startsWith("pain:low back"));
    expect(pain?.caveat).toMatch(/unknown/);
    expect(s.restrictions.join(" ")).toMatch(/low back/i);
  });
  it("blocks don't add up → a blocker; a meet after the program → warned", () => {
    const bad = setupWith(intel, { blocks: [{ name: "A", weeks: 3, objective: "" }] });
    expect(findConflicts(bad, intel.ctx, intel.recommendation.baseline, lookup(intel)).find((c) => c.id === "blocks-weeks")?.severity).toBe("blocker");
    // 8 weeks of the coach's own would leave 2 before the meet: said, with the alternatives
    const short = setupWith(intel, { weeks: 8, durationMode: "custom" });
    const c = findConflicts(short, intel.ctx, intel.recommendation.baseline, lookup(intel)).find((x) => x.id === "short-final-prep")!;
    expect(c.options).toEqual(["Make it 10 weeks (through Nationals)", "Make it 6 weeks (a 4-week final prep next)", "Keep 8"]);
    // the 12-week default runs past it
    const long = setupWith(intel, { weeks: 12, durationMode: "default" });
    expect(findConflicts(long, intel.ctx, intel.recommendation.baseline, lookup(intel)).find((x) => x.id === "runs-past-deadline")).toBeTruthy();
    expect(blockStructure("powerlifting", 6, null)).toHaveLength(1);
  });
});

describe("Bodybuilder (5 days, glute priority, variable adherence, no check-outs)", () => {
  const intel = buildGeneratorIntel(bodybuilder());
  const s = intel.recommendation.setup;
  it("is hypertrophy, with the goal's priorities and the missed sessions read honestly", () => {
    expect(intel.classification.auto).toBe("bodybuilding");
    expect(s.priorities).toEqual(expect.arrayContaining(["Glutes", "Shoulders"]));
    expect(intel.ctx.previous!.sessionAdherencePct).toBeLessThan(85);
    expect(intel.review!.recovery[0].title).toMatch(/Trained \d+ of \d+ due workouts/);
    expect(intel.quality!.confidence.find((c) => c.topic.startsWith("Recovery"))!.level).toBe("none");
  });
  it("volume and frequency targets start from what they actually did, per muscle", () => {
    expect(s.volume.find((v) => v.target === "Glutes")!.setsPerWeek).toBeGreaterThan(8);
    expect(s.frequency.length).toBeGreaterThan(0);
  });
});

describe("Insufficient data", () => {
  it("still recommends, cautiously, and says what's missing", () => {
    const intel = buildGeneratorIntel(sparse());
    expect(intel.recommendation.setup.daysPerWeek).toBeGreaterThan(0);
    expect(intel.recommendation.why.daysPerWeek?.confidence).not.toBe("high");
    expect(intel.quality!.missing.join(" ")).toMatch(/Only 1 trained workouts|Goals & Setup not on file/);
    expect(intel.equipment.confidence).not.toBe("confirmed");
    const b = buildBrief(intel, { setup: intel.recommendation.setup, edited: [], conflicts: [], redistribution: null });
    expect(b.text).toContain("RPE / RIR: 0%");
    // the recommendation is always a valid setup (a sparse prescription can't estimate a 10-minute session)
    expect(setupSchema.safeParse(intel.recommendation.setup).success).toBe(true);
  });
});

describe("Equipment and session time", () => {
  it("what an exercise needs", () => {
    expect(requirementsOf({ name: "Landmine Belt Squat" })).toEqual([["landmine"], ["barbell"]]);
    expect(requirementsOf({ name: "Cable Triceps Pushdown", equipment: "Cable" })).toEqual([["cable_high"]]);
    expect(requirementsOf({ name: "Cable Seated On Floor Row", equipment: "Cable" })).toEqual([["cable_low", "seated_row"]]);
    expect(requirementsOf({ name: "Incline Bench Press - Dumbbell", equipment: "Dumbbell" })).toEqual([["dumbbells", "adjustable_dumbbells"], ["adjustable_bench"]]);
    expect(requirementsOf({ name: "Push-Up", equipment: "Bodyweight" })).toEqual([]);
  });
  it("estimates count rest, unilateral work, station changes and the barbell warm-up; calibration is the median ratio, bounded", () => {
    const d = estimateDay([
      { name: "Competition Squat", equipment: "Barbell, Rack", sets: 3, reps: "5-8", restSeconds: 150 },
      { name: "Dumbbell Bulgarian Split Squat", equipment: "Dumbbell", sets: 2, reps: "8-12 each leg", restSeconds: 75 },
      { name: "Cable Triceps Pushdown", equipment: "Cable", sets: 2, reps: "10-15", restSeconds: 60 },
    ]);
    expect(d.stations).toEqual(["barbell", "dumbbells", "cable"]);
    expect(d.stationChanges).toBe(2);
    expect(d.minutes).toBeGreaterThan(15);
    expect(calibrationFactor([{ estimated: 40, actual: 52 }, { estimated: 40, actual: 50 }, { estimated: 40, actual: 54 }, { estimated: 40, actual: 200 }])).toBe(1.33);
    expect(calibrationFactor([{ estimated: 40, actual: 52 }])).toBeNull();
  });
});

// ── The audit ────────────────────────────────────────────────────────────────

const strategyFor = (setup: GenerationSetup, over: Partial<Strategy> = {}): Strategy => ({
  athlete_read: "Intermediate lifter training at home.",
  previous_program: { intent: "Strength + hypertrophy", outcome: "Progressed on most lifts." },
  keep: [{ item: "Competition Squat", why: "progressed", evidence: [] }],
  change: [],
  prioritize: [],
  reduce: [],
  progression: { model: "Double progression", expected: "", fatigue: "Lighter week 4", success_criteria: [] },
  structure: { weeks: setup.weeks, days_per_week: setup.daysPerWeek, session_minutes: setup.sessionMinutes, blocks: (setup.blocks.length ? setup.blocks : [{ name: "Strength + hypertrophy", weeks: setup.weeks, objective: "" }]).map((b) => ({ name: b.name, weeks: b.weeks, objective: b.objective, phases: [] })) },
  weekly_layout: Array.from({ length: setup.daysPerWeek }, (_, i) => ({ day: i + 1, title: `Day ${i + 1}`, focus: "", primary: [], notes: "" })),
  frequency_targets: [],
  volume_targets: [],
  intensity: "",
  exercise_plan: { retain: [{ exercise_id: "e-csq", name: "Competition Squat", why: "" }], replace: [], add: [] },
  decisions: [{ area: "squat", observation: "Squat progressed", evidence: ["Competition Squat: e1RM"], change: "Keep squat 1×/week", benefit: "", monitor: "", basis: "fact", confidence: "high" }],
  coach_requirements: [],
  conflicts: [],
  data_limits: [],
  monitor: [],
  ...over,
});

function homeBlock(days: BuiltBlock["days"], weeks = 4): BuiltBlock {
  return { name: "Strength + hypertrophy", objective: "", weeks, week_phases: [{ week: 4, phase: "Deload" }], deload_rule: null, progression_rules: [], days };
}
const exr = (id: string, name: string, extra: any = {}) => ({ exercise_id: id, exercise_name: name, role: null, station: null, superset: null, sets: 3, reps: "8-10", rpe: "8", rest_seconds: 90, tempo: null, progression: "Add reps to the top of the range, then load", substitutions: [], notes: null, weeks: [{ week: 4, sets: 2, rpe: "6" }], ...extra });

describe("Program quality audit and scorecard", () => {
  const intel = buildGeneratorIntel(homeGym());
  // a 4-week program of the coach's own length (the fixture's blocks are 4 weeks)
  const setup: GenerationSetup = { ...intel.recommendation.setup, weeks: 4, durationMode: "custom" };
  const input = (program: BuiltProgram, extra: any = {}) => ({
    program,
    setup,
    strategy: strategyFor(setup),
    baseline: intel.recommendation.baseline,
    equipment: { items: setup.equipment.items, confidence: setup.equipment.confidence, home: intel.equipment.home, cableStations: setup.equipment.cableStations },
    ctx: intel.ctx,
    quality: intel.quality,
    meta: intel.exercises,
    unmatched: [],
    athleteExerciseIds: new Set((intel.prev?.exercises ?? []).map((e) => e.exerciseId).filter(Boolean) as string[]),
    brief: "Competition Squat e1RM 120kg B1·W2",
    ...extra,
  });
  const good = (): BuiltProgram => ({
    program_name: "x",
    summary: "",
    progression: "",
    recovery: "",
    changes: [],
    watch: [],
    blocks: [
      homeBlock([
        { title: "Lower A", exercises: [exr("e-csq", "Competition Squat", { role: "Primary Squat", reps: "5-8", rest_seconds: 150 }), exr("e-bss", "Dumbbell Bulgarian Split Squat"), exr("e-hcurl", "Bench Hamstring Curl Attachment")] },
        { title: "Upper A", exercises: [exr("e-idb", "Incline Bench Press - Dumbbell"), exr("e-pull", "Wide-Grip Lat Pulldown"), exr("e-row", "Cable Seated On Floor Row")] },
        { title: "Lower B", exercises: [exr("e-rdl", "Romanian Deadlift"), exr("e-lbs", "Landmine Belt Squat"), exr("e-lext", "Bench Leg Extension Attachment")] },
        { title: "Upper B", exercises: [exr("e-bbb", "Barbell Bench Press", { reps: "5-8" }), exr("e-bor", "Bent-Over Barbell Row"), exr("e-lat", "Lateral Raises Dumbbell")] },
      ]),
    ],
  });
  it("a sound program has no failures; checks that can't run are said, so it isn't called fully validated", () => {
    const a = auditProgram(input(good()));
    expect(a.scorecard).toHaveLength(15);
    expect(a.scorecard.filter((r) => r.status === "failed")).toEqual([]);
    expect(a.overall).not.toBe("failed");
    expect(a.sessions.filter((x) => x.week === 1)).toHaveLength(4);
  });
  it("equipment they don't have, two cable exercises in one superset, and an over-long session fail, located for repair", () => {
    const p = good();
    p.blocks[0].days[0].exercises.push(exr("e-legpress", "Leg Press"));
    p.blocks[0].days[1].exercises[1].superset = "A1";
    p.blocks[0].days[1].exercises[2].superset = "A2";
    p.blocks[0].days[3].exercises.push(...Array.from({ length: 6 }, (_, i) => exr("e-lat", `Lateral Raises Dumbbell`, { sets: 5, role: `extra ${i}`, rest_seconds: 120 })));
    const a = auditProgram(input(p));
    const row = (c: string) => a.scorecard.find((r) => r.criterion === c)!;
    expect(row("equipment").status).toBe("failed");
    expect(row("equipment").reasons[0]).toMatch(/Leg Press needs/);
    expect(row("practicality").status).toBe("failed");
    expect(row("practicality").reasons.join(" ")).toMatch(/supersets two cable exercises/);
    expect(row("practicality").reasons.join(" ")).toMatch(/over the 75-min maximum/);
    expect(a.overall).toBe("failed");
    expect(Object.keys(a.repairs)).toEqual(["0"]);
  });
  it("weeks, days, exclusions, requirements and library misses are checked", () => {
    const p = good();
    p.blocks[0].days.pop();
    const a = auditProgram(input(p, { setup: { ...setup, excluded: [{ id: "e-rdl", name: "Romanian Deadlift" }], required: [{ id: null, name: "Nordic Curl" }] }, unmatched: [] }));
    const sel = a.scorecard.find((r) => r.criterion === "selection")!;
    expect(sel.reasons.join(" ")).toMatch(/Excluded exercise Romanian Deadlift/);
    expect(sel.reasons.join(" ")).toMatch(/Required exercise Nordic Curl isn't in the program/);
    expect(a.scorecard.find((r) => r.criterion === "completeness")!.reasons.join(" ")).toMatch(/3 training days a week; the setup asks for 4/);
  });
  it("an exercise below the exercise standard fails for repair, unless the coach required it", () => {
    const p = good();
    p.blocks[0].days[3].exercises.push(exr("e-lmlat", "Landmine Lateral Raise", { role: "Accessory" }));
    const a = auditProgram(input(p));
    const sel = a.scorecard.find((r) => r.criterion === "selection")!;
    expect(sel.status).toBe("failed");
    expect(sel.reasons.join(" ")).toMatch(/Landmine Lateral Raise .* below the exercise standard/);
    expect(a.repairs[0].join(" ")).toMatch(/Landmine Lateral Raise/);
    const asked = auditProgram(input(p, { setup: { ...setup, required: [{ id: "e-lmlat", name: "Landmine Lateral Raise" }] } }));
    expect(asked.scorecard.find((r) => r.criterion === "selection")!.reasons.join(" ")).not.toMatch(/exercise standard/);
  });
  it("a block that misses the strategy's own frequency target fails for repair; a 'replaced' exercise still there is flagged", () => {
    const strategy = strategyFor(setup, { frequency_targets: [{ target: "Bench", per_week: 3 }], exercise_plan: { retain: [], replace: [{ exercise_id: "e-rdl", name: "Romanian Deadlift", with: null, why: "" }], add: [] } });
    const a = auditProgram(input(good(), { strategy }));
    const freq = a.scorecard.find((r) => r.criterion === "frequency")!;
    expect(freq.status).toBe("failed");
    // incline dumbbell press and barbell bench are both bench work: 2 days, not the 3 the strategy set
    expect(freq.reasons[0]).toMatch(/Bench: 2×\/week in block 1; the strategy targets 3×/);
    expect(a.repairs[0].join(" ")).toMatch(/Bench/);
    const sel = a.scorecard.find((r) => r.criterion === "selection")!;
    expect(sel.reasons.join(" ")).toMatch(/replace Romanian Deadlift, but it's still in block 1/);
    // the strategy's own decision: failed, and sent back for repair
    expect(sel.status).toBe("failed");
    expect(a.repairs[0].join(" ")).toMatch(/replace Romanian Deadlift/);
  });
  it("a frequency target is a minimum: training something more often than planned never fails", () => {
    const strategy = strategyFor(setup, { frequency_targets: [{ target: "Bench", per_week: 1 }] });
    const a = auditProgram(input(good(), { strategy }));
    expect(a.scorecard.find((r) => r.criterion === "frequency")!.status).not.toBe("failed");
    expect(Object.values(a.repairs).flat().join(" ")).not.toMatch(/Bench/);
  });
  it("the replacement a strategy names isn't flagged as a leftover, even when the model put its id on the old exercise", () => {
    const strategy = strategyFor(setup, { exercise_plan: { retain: [], replace: [{ exercise_id: "e-pull", name: "Lat Pulldown", with: "Wide-Grip Lat Pulldown", why: "" }], add: [] } });
    const a = auditProgram(input(good(), { strategy }));
    expect(a.scorecard.find((r) => r.criterion === "selection")!.reasons.join(" ")).not.toMatch(/replace Lat Pulldown/);
  });
  it("percentages that the reps can't fit fail; invented numbers in evidence are flagged", () => {
    expect(Math.floor(maxRepsAt(85))).toBe(5);
    const p = good();
    p.blocks[0].days[0].exercises[0] = exr("e-csq", "Competition Squat", { role: "Primary Squat", reps: "8", rpe: "8", percentage: 88 });
    const strategy = strategyFor(setup, { decisions: [{ area: "squat", observation: "Squat e1RM rose to 152.5kg", evidence: ["B9·W9 squat 152.5kg"], change: "x", benefit: "", monitor: "", basis: "fact", confidence: "high" }] });
    const a = auditProgram(input(p, { strategy }));
    expect(a.scorecard.find((r) => r.criterion === "volume")!.status).toBe("failed");
    expect(a.scorecard.find((r) => r.criterion === "evidence")!.reasons[0]).toMatch(/B9·W9|152.5/);
    expect(unsupportedTokens("Competition Squat e1RM 120kg at B1·W2", "Competition Squat e1RM 120kg B1·W2")).toEqual([]);
  });
  it("free-text instructions and restrictions are reported as not checked automatically", () => {
    const a = auditProgram(input(good(), { setup: { ...setup, coachNotes: "Keep Friday short", restrictions: ["Left knee"] } }));
    expect(a.scorecard.find((r) => r.criterion === "instructions")!.status).toBe("skipped");
    expect(a.scorecard.find((r) => r.criterion === "selection")!.reasons.join(" ")).toMatch(/can't be checked automatically/);
    expect(a.overall).toBe("review");
  });
});

// Devin Buth's first program (Nov 8 2026): a 6-day push / pull / legs powerbuilding split on Mon–Wed + Fri–Sun,
// written to its strategy's targets, with the library's real muscle data (a bench lists triceps among its muscles).
describe("A first program that follows its plan isn't flagged for what compounds give other muscles", () => {
  const intel = buildGeneratorIntel(homeGym());
  const mx = (id: string, name: string, pm: string, mg: string[], sm: string[] = [], family = "accessory") => [id, { id, name, primary_muscle_group: pm, muscle_groups: mg, secondary_muscle_groups: sm, movement_family: family, is_competition_lift: false, competition_lift_type: null, exercise_category: "compound", variation_type: null, counts_toward_volume: true, volume_multiplier: 1, equipment: null }] as const;
  const meta = new Map<string, any>([
    mx("bench", "Barbell Bench Press", "Chest", ["chest", "triceps"], ["front_delts"], "bench"),
    mx("pbench", "Paused Bench Press", "Chest", ["chest", "triceps"], ["front_delts"], "bench"),
    mx("dbpress", "Seated Shoulder Press - Dumbbell", "Front Delts", ["front_delts"], ["side_delts", "triceps"]),
    mx("pushdown", "Cable Triceps Pushdown", "Triceps", ["triceps"]),
    mx("dl", "Conventional Deadlift", "Glutes", ["glutes", "hamstrings", "lower_back"], ["upper_back", "traps", "forearms", "quads", "adductors"], "deadlift"),
    mx("pulldown", "Lat Pull Down Normal Grip", "Lats", ["lats"], ["upper_back", "biceps"]),
    mx("curl", "Dumbbell Alternate Biceps Curl", "Biceps", ["biceps"], ["forearms"]),
    mx("hbsq", "High Bar Squat", "Quads", ["quads", "glutes"], ["upper_back", "adductors", "core"], "squat"),
    mx("legpress", "Leg Press Machine", "Quads", ["quads", "glutes"], ["adductors"]),
    mx("calf", "Standing Calf Raise - Machine", "Calves", ["calves"]),
    mx("lateral", "Lateral Raises Dumbbell", "Side Delts", ["side_delts"], ["traps"]),
    mx("row", "Cable Seated Row", "Upper Back", ["upper_back", "lats"], ["rear_delts", "biceps"]),
    mx("wpulldown", "Wide-Grip Lat Pulldown", "Lats", ["lats"], ["upper_back", "biceps"]),
    mx("hammer", "Dumbbell Hammer Curl", "Biceps", ["biceps", "forearms"]),
    mx("bsq", "Barbell Full Squat(Back)", "Quads", ["quads", "glutes", "adductors"], ["core", "lower_back"], "squat"),
    mx("rdl", "Barbell Romanian Deadlift", "Hamstrings", ["hamstrings", "glutes"], ["forearms", "lower_back"], "hinge"),
    mx("legcurl", "Seated Leg Curl Machine", "Hamstrings", ["hamstrings"], ["calves"]),
    mx("scalf", "Seated Calf Raise", "Calves", ["calves"]),
  ]);
  const e = (id: string, sets: number, role: string | null = null) => exr(id, meta.get(id).name, { sets, role, rpe: "7" });
  const days = (): BuiltBlock["days"] => [
    { title: "Push 1", exercises: [e("bench", 4, "Primary Bench"), e("dbpress", 3), e("pushdown", 3)] },
    { title: "Pull 1", exercises: [e("dl", 4, "Primary Deadlift"), e("pulldown", 4), e("curl", 3)] },
    { title: "Legs 1", exercises: [e("hbsq", 4, "Primary Squat"), e("legpress", 3), e("calf", 3)] },
    { title: "Push 2", exercises: [e("pbench", 4, "Primary Bench"), e("lateral", 4), e("pushdown", 4)] },
    { title: "Pull 2", exercises: [e("row", 4), e("wpulldown", 4), e("hammer", 4)] },
    { title: "Legs 2", exercises: [e("bsq", 3, "Primary Squat"), e("rdl", 3), e("legcurl", 3), e("scalf", 4)] },
  ];
  const trainingDays = ["Monday", "Tuesday", "Wednesday", "Friday", "Saturday", "Sunday"];
  const setup = setupWith(intel, { brain: "powerbuilding", daysPerWeek: 6, trainingDays, weeks: 4, blocks: [{ name: "Powerbuilding", weeks: 4, objective: "" }], coachNotes: "", preferences: "", newCircumstances: "", recovery: "", restrictions: [], excluded: [], required: [], priorities: [] });
  const targets: Array<[string, number, number]> = [["Chest", 10, 2], ["Quads", 10, 2], ["Hamstrings", 10, 2], ["Glutes", 10, 2], ["Back", 8, 2], ["Lats", 8, 2], ["Shoulders", 7, 2], ["Biceps", 7, 2], ["Triceps", 7, 2], ["Calves", 7, 2], ["Squat", 7, 2], ["Bench", 8, 2], ["Deadlift", 4, 1]];
  const strategy = strategyFor(setup, {
    volume_targets: targets.map(([target, sets_per_week]) => ({ target, sets_per_week, vs_previous: "baseline" })),
    frequency_targets: targets.map(([target, , per_week]) => ({ target, per_week })),
    exercise_plan: { retain: [], replace: [], add: [] },
    conflicts: [{ description: "The specific equipment available at the commercial gym is unknown.", resolution: "Assumed standard commercial gym equipment." }],
  });
  const program = (d: BuiltBlock["days"]): BuiltProgram => ({ program_name: "x", summary: "", progression: "", recovery: "", changes: [], watch: [], blocks: [homeBlock(d)] });
  const audit = (d: BuiltBlock["days"], extra: any = {}) =>
    auditProgram({
      program: program(d),
      setup,
      strategy,
      baseline: { ...intel.recommendation.baseline, weeklySets: null },
      equipment: { items: [], confidence: "unknown", home: false, cableStations: null },
      ctx: intel.ctx,
      quality: null,
      meta,
      unmatched: [],
      athleteExerciseIds: new Set<string>(),
      brief: "",
      ...extra,
    });
  const row = (a: ReturnType<typeof auditProgram>, c: string) => a.scorecard.find((r) => r.criterion === c)!;

  it("volume and frequency read like with like: sets aimed at a muscle for 'too much', everything reaching it for 'too little'", () => {
    const a = audit(days());
    // what reaches each muscle is still measured (a bench set does work the triceps)…
    expect(a.weekly[0].muscles.Triceps.sets).toBe(16.5);
    expect(a.weekly[0].muscles.Back.days).toBeGreaterThanOrEqual(4);
    // …but the plan's 7 triceps sets are the 7 sets aimed at them, and back work lands on one day
    expect(a.weekly[0].direct!.Triceps.sets).toBe(7);
    expect(a.weekly[0].direct!.Biceps.sets).toBe(7);
    expect(a.weekly[0].direct!.Shoulders.sets).toBe(7);
    expect(row(a, "volume").status).toBe("passed");
    expect(row(a, "frequency").status).toBe("passed");
  });

  it("a first program's missing history and unknown equipment are 'not checked', never a review item", () => {
    const a = audit(days());
    expect(row(a, "data").status).toBe("skipped");
    expect(row(a, "equipment").status).toBe("skipped");
    expect(row(a, "instructions").status).toBe("passed");
  });

  it("heavy deadlift Tuesday into heavy squat Wednesday isn't a mistake by rule: it's a fact for the coaching review", () => {
    const a = audit(days());
    expect(row(a, "fatigue").status).toBe("passed");
    expect(a.facts).toEqual(["Block 1: Pull 1 (Tuesday) and Legs 1 (Wednesday) lead with a heavy squat and a heavy deadlift on back-to-back days."]);
    // the days stay as the strategy laid them out
    expect(a.sessions.filter((x) => x.week === 1).map((x) => x.title)).toEqual(["Push 1", "Pull 1", "Legs 1", "Push 2", "Pull 2", "Legs 2"]);
  });

  it("Sunday into Monday counts as back to back", () => {
    const flags = [{ squat: false, deadlift: true }, { squat: false, deadlift: false }, { squat: true, deadlift: false }];
    expect(heavyClashes(flags, ["Monday", "Wednesday", "Sunday"])).toEqual([[2, 0]]);
    expect(heavyClashes(flags, ["Monday", "Wednesday", "Friday"])).toEqual([]);
  });

  it("a real overshoot or shortfall is still flagged", () => {
    const more = days();
    more[0].exercises.push(e("pushdown", 8, "extra"));
    expect(row(audit(more), "volume").reasons.join(" ")).toMatch(/Triceps: 15 sets aimed at it in week 1 vs the strategy's 7/);
    const less = days();
    less[3].exercises.shift(); // no paused bench on Push 2
    expect(row(audit(less), "volume").reasons.join(" ")).toMatch(/Chest: 4 sets reach it in week 1 \(compounds included\) vs the strategy's 10/);
  });
});

describe("A coach's unassigned draft is never read as training", () => {
  it("the loader leaves out hidden, undated blocks (a generated draft), keeps hidden dated ones", async () => {
    const { loadIntelRecords } = await import("@/lib/program-intel/load");
    const blocks = [
      { id: "b-real", client_id: "c", client_visible: true, start_date: "2026-10-05", end_date: "2026-11-01", status: "Active", name: "Real", created_at: "2026-10-01" },
      { id: "b-old-hidden", client_id: "c", client_visible: false, start_date: "2026-09-07", end_date: "2026-10-04", status: "Archived", name: "Old", created_at: "2026-09-01" },
      { id: "b-draft", client_id: "c", client_visible: false, start_date: null, end_date: null, status: "Draft", name: "Draft", created_at: "2026-11-02" },
    ];
    const q: any = (rows: any[]) => {
      const me: any = { select: () => me, eq: () => me, is: () => me, in: () => me, order: () => me, not: () => me, gte: () => me, range: () => Promise.resolve({ data: rows, error: null }), maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }), then: (r: any) => Promise.resolve({ data: rows, error: null }).then(r) };
      return me;
    };
    const sb = { from: (t: string) => q(t === "clients" ? [{ id: "c", full_name: "X", timezone: "America/Winnipeg", preferred_weight_unit: "kg" }] : t === "pl_blocks" ? blocks : []) };
    const rec = await loadIntelRecords(sb, "c", { kind: "history" }, { today: "2026-11-02" });
    expect(rec.blocks.map((b) => b.id)).toEqual(["b-real", "b-old-hidden"]);
  });
});

describe("Every recommendation is a valid setup", () => {
  it("home gym, powerlifter, bodybuilder and sparse data all pass the setup schema the server checks", () => {
    const wordy = homeGym();
    wordy.client.injuries = "Left shoulder impingement since 2019. ".repeat(20);
    wordy.goals!.goal_target = "Bigger glutes arms chest back shoulders legs bench squat deadlift total ".repeat(5);
    for (const rec of [homeGym(), powerlifter(), bodybuilder(), sparse(), wordy]) {
      const r = setupSchema.safeParse(buildGeneratorIntel(rec).recommendation.setup);
      expect(r.success ? "ok" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")).toBe("ok");
    }
  });
});

describe("Learning from what happened", () => {
  it("compares a generated program with its strategy: prioritized lifts, volume, adherence, practicality, decisions", () => {
    const rec = powerlifter();
    const ids = ["pl-3"];
    const job = { id: "job-x", created_at: "2026-10-01T00:00:00Z", brain: "powerlifting" as const, result: { blockIds: ids, setup: { priorities: ["Bench"] }, strategy: strategyFor({ ...buildGeneratorIntel(rec).recommendation.setup }, { prioritize: [{ item: "Bench", why: "", evidence: [] }], decisions: [{ area: "bench", observation: "Bench flat at 1×", evidence: [], change: "Bench 2×/week", benefit: "", monitor: "Bench top sets", basis: "hypothesis", confidence: "medium" }] }), previousAdherencePct: 90, program: { program_name: "Realization" } } };
    const [o] = generatedProgramOutcomes(rec, [job]);
    expect(o.finished).toBe(true);
    expect(o.items.find((i) => i.key === "prio:bench")!.title).toMatch(/Bench \(prioritized\): e1RM/);
    expect(o.items.find((i) => i.key === "volume:read")!.kind).toBe("hypothesis");
    expect(o.items.find((i) => i.key === "adherence")!.title).toMatch(/previous program 90%/);
    expect(o.items.find((i) => i.key === "decision:0")!.detail).toMatch(/for you to judge/);
    expect(sliceRecords(rec, ids, "x").blocks).toHaveLength(1);
    expect(TODAY).toBe("2026-11-02");
  });
});

describe("Setting a program up for the athlete, not as a copy of last block", () => {
  it("days per week come from the training schedule even when they trained fewer, with a note to keep sessions doable", () => {
    const rec = homeGym();
    // they did about two of every three workouts
    const due = rec.results.length;
    rec.results = rec.results.filter((_, i) => i % 3 !== 0);
    expect(rec.results.length).toBeLessThan(due);
    const intel = buildGeneratorIntel(rec);
    expect(intel.recommendation.setup.daysPerWeek).toBe(4);
    expect(intel.recommendation.setup.trainingDays).toEqual(["Monday", "Tuesday", "Wednesday", "Friday"]);
    expect(intel.recommendation.why.daysPerWeek?.source).toBe("Training schedule");
  });
  it("no schedule on file: the last program's days, and it says to set them", () => {
    const rec = homeGym();
    rec.client = { ...rec.client, committed_training_days: [], committed_training_frequency: null } as typeof rec.client;
    const intel = buildGeneratorIntel(rec);
    expect(intel.recommendation.setup.daysPerWeek).toBe(4);
    expect(intel.recommendation.why.daysPerWeek?.reason).toMatch(/No training schedule on file/);
  });
  it("squat and bench at least twice a week, the deadlift at least once, never more than the days", () => {
    const intel = buildGeneratorIntel(homeGym());
    const f = (t: string) => intel.recommendation.setup.frequency.find((x) => x.target === t)?.perWeek ?? null;
    expect(f("Squat")).toBeGreaterThanOrEqual(2);
    expect(f("Bench")).toBeGreaterThanOrEqual(2);
    expect(f("Deadlift") ?? 1).toBeGreaterThanOrEqual(1);
    for (const x of intel.recommendation.setup.frequency) expect(x.perWeek).toBeLessThanOrEqual(intel.recommendation.setup.daysPerWeek);
    expect(intel.recommendation.why.frequency?.reason).toMatch(/at least twice a week/);
  });
  it("major muscles at least twice a week in a hypertrophy setup", () => {
    const intel = buildGeneratorIntel(bodybuilder());
    const s = intel.recommendation.setup;
    for (const x of s.frequency.filter((q) => /^(chest|back|lats|quads|glutes|hamstrings|shoulders)$/i.test(q.target))) expect(x.perWeek).toBeGreaterThanOrEqual(Math.min(2, s.daysPerWeek));
  });
  it("a trained lat pulldown proves pulldowns are possible, even without a note saying which machine", () => {
    const rec = homeGym();
    // no row note says "high cable" (Nicolas's didn't), so the pulldown alone has to prove it
    rec.rows = rec.rows.map((r) => ({ ...r, notes: null }));
    const intel = buildGeneratorIntel(rec);
    expect(intel.equipment.items).toContain("lat_pulldown");
    expect(missingEquipment({ name: "Wide-Grip Lat Pulldown", equipment: "Cable" }, intel.equipment)).toEqual([]);
  });
});

describe("Cardio in a generated program is logged as time", () => {
  it("a treadmill walk written as '10' becomes a 10-minute timed row", async () => {
    const { exerciseRow, isTimedCardio } = await import("@/lib/program-intel/next-program");
    const row = exerciseRow({ exercise_id: "e-walk", exercise_name: "Treadmill Walk", role: "Accessory", station: null, superset: null, sets: 1, reps: "10", rpe: "5", rest_seconds: 0, tempo: null, progression: "Maintain 10 minutes", substitutions: [], notes: "10 minutes finish", weeks: [] } as any, 1, 4);
    expect(row).toMatchObject({ measurement_type: "time", tracking_type: "time", duration_seconds: 600, reps_text: null, rpe: null, sets: 1, sort_order: 4, exercise_id: "e-walk" });
    expect(isTimedCardio("Walking Fast")).toBe(true);
    expect(isTimedCardio("Stationary Exercise Bike")).toBe(true);
    for (const n of ["Walking Lunges", "Dumbbell Farmer Walks", "Air Bike", "Lateral Band Walks", "Barbell Bench Press"]) expect(isTimedCardio(n)).toBe(false);
  });
});

describe("a strategy with empty parts goes back with its retry (blind grading, Nov 9 2026)", () => {
  it("names each empty part the workouts are written from; a complete one has none", async () => {
    const { strategyGaps } = await import("@/lib/program-intel/pipeline.server");
    const setup = setupWith(buildGeneratorIntel(homeGym()), { weeks: 4, daysPerWeek: 2, blocks: [] });
    const empty = strategyFor(setup, { progression: { model: "", expected: "", fatigue: " ", success_criteria: [] } });
    const gaps = strategyGaps(empty);
    expect(gaps.some((g) => g.startsWith("intensity is empty"))).toBe(true);
    expect(gaps.some((g) => g.startsWith("progression.model is empty"))).toBe(true);
    expect(gaps.some((g) => g.startsWith("progression.fatigue is empty"))).toBe(true);
    expect(gaps.some((g) => g.startsWith("frequency_targets is empty"))).toBe(true);
    expect(gaps.filter((g) => g.includes("lists no main exercises"))).toHaveLength(2);
    const full = strategyFor(setup, {
      intensity: "RPE 7-8 on the main lifts, +0.5 RPE every two weeks.",
      progression: { model: "Double progression on accessories; main lifts add 2.5 kg when all sets hit at RPE 8 or under.", expected: "", fatigue: "Volume drops a third in week 4.", success_criteria: [] },
      frequency_targets: [{ target: "Squat", per_week: 2 }],
      weekly_layout: [1, 2].map((d) => ({ day: d, title: `Day ${d}`, focus: "Full body", primary: ["Competition Squat"], notes: "" })),
    });
    expect(strategyGaps(full)).toEqual([]);
  });
});
