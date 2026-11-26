import { describe, expect, it } from "vitest";
import {
  approachAnchors,
  assessGoal,
  calibrationFrom,
  decideAction,
  meaningfulChange,
  recommendApproach,
  resolveOutcome,
  scoreAgainst,
  trainingProjection,
  type GoalContext,
  type GoalSpec,
} from "@/lib/goal-intel/feasibility";
import { dedupeKey, goalTitle, inferUnit, loadNumbers, measurableGoals, statedGoals, wordedGoal } from "@/lib/goal-intel/extract";
import {
  buildUpdateMessage,
  currentChanges,
  inQuiet,
  mergeChanges,
  presenceOf,
  sendDecision,
  type OutboxChange,
} from "@/lib/goal-intel/outbox";
import { goalsText } from "@/lib/goal-intel/rules";
import { fmtClientTarget, timeLeftLine, toKg, type GoalRow } from "@/lib/goal-intel/types";

const TODAY = "2026-11-26";

function ctx(over: Partial<GoalContext> = {}): GoalContext {
  return {
    today: TODAY,
    unit: "lb",
    level: "intermediate",
    lifts: {
      squat: { nowKg: 100, state: "measured", basis: "92.5 kg × 1 @ 7.5 on Nov 23", basisDay: "2026-11-23", hardSessions6w: 4, trendPerWeek: 0.004, direction: "up" },
      bench: { nowKg: 50, state: "measured", basis: null, basisDay: "2026-11-25", hardSessions6w: 4, trendPerWeek: 0.002, direction: "up" },
      deadlift: { nowKg: 122, state: "measured", basis: null, basisDay: "2026-11-23", hardSessions6w: 3, trendPerWeek: 0.003, direction: "up" },
    },
    meets: {
      comp1: {
        competitionId: "comp1",
        meetDate: "2026-12-05",
        name: "Winter Open",
        lifts: {
          squat: { conservative: 100, expected: 105, high: 107.5 },
          bench: { conservative: 50, expected: 52.5, high: 55 },
          deadlift: { conservative: 125, expected: 130, high: 135 },
        },
        total: { conservative: 275, expected: 287.5, high: 297.5 },
        confidence: "medium",
        incrementKg: 2.5,
        concerns: [],
      },
    },
    bodyweight: { currentKg: 58.4, trendKgPerWeek: -0.15, trendClear: true, seKgPerWeek: 0.04, noiseKg: 0.4, weighInsLast14: 10, stale: false },
    weightContext: "powerlifting_class",
    concerns: [],
    adherencePct: 85,
    calibration: null,
    preferences: {},
    ...over,
  };
}

const spec = (over: Partial<GoalSpec>): GoalSpec => ({
  kind: "lift",
  lift: "squat",
  client_kg: null,
  client_kg_max: null,
  approved_kg: null,
  deadline: null,
  competition_id: null,
  status: "proposed",
  approved_approach: null,
  client_text: null,
  approved_text: null,
  ...over,
});

describe("extracting goals from what was said", () => {
  it("reads a meeting's goal items: lift, range, third attempt, no unit", () => {
    const [g] = measurableGoals("The athlete is thinking her squat third attempt will be around 220 to 225.", "basically for squats, I think I'm gonna hit 222 25");
    expect(g).toMatchObject({ kind: "lift", lift: "squat", values: [220, 225], unit: null, timing: "third", tentative: true });
  });

  it("reads several lifts on one line (the coach's notes from the call)", () => {
    const gs = measurableGoals("Thinking for thirds:\n\nsquat 220 - 225\n\nbench 110-115\n\ndeadlift 264 - 280\n\nWant to hit top end don't care about going 9/9");
    expect(gs.map((g) => [g.lift, g.values])).toEqual([
      ["squat", [220, 225]],
      ["bench", [110, 115]],
      ["deadlift", [264, 280]],
    ]);
    expect(gs.every((g) => g.timing === "third")).toBe(true);
  });

  it("keeps a stated unit, and never reads reps, sets, RPE, percentages or dates as a load", () => {
    expect(measurableGoals("Bench 100 kg by the meet")[0]).toMatchObject({ lift: "bench", values: [100], unit: "kg" });
    expect(measurableGoals("squat 3 sets of 5 at RPE 8")).toEqual([]);
    expect(measurableGoals("squat at 85% for 6 weeks")).toEqual([]);
    expect(loadNumbers("2026 squat 12/05 at 10:30")).toEqual([]);
    expect(loadNumbers("max 220 lbs")[0]).toMatchObject({ value: 220, unit: "lb" });
  });

  it("reads a total and a bodyweight goal", () => {
    expect(measurableGoals("I want to total 300 kg at nationals")[0]).toMatchObject({ kind: "total", values: [300], unit: "kg" });
    expect(measurableGoals("I need to make weight, get down to 57 kg")[0]).toMatchObject({ kind: "bodyweight", values: [57], unit: "kg" });
  });

  it("keeps a goal in words in words, and a preference as a preference", () => {
    expect(wordedGoal("Wants to keep growing muscle while also getting stronger.")?.kind).toBe("physique");
    expect(wordedGoal("Still wants to get stronger after stepping back.")?.kind).toBe("performance");
    expect(wordedGoal("Wants to push the top end at the meet rather than make 9/9 the main goal.")?.kind).toBe("preference");
    expect(wordedGoal("Wants to qualify for nationals next year.")?.kind).toBe("event");
    expect(wordedGoal("Trains between clients.")).toBeNull();
  });

  it("only takes a client's own words when they state a goal, never a result", () => {
    expect(statedGoals("Goal is to squat 140 kg by summer.")).toHaveLength(1);
    expect(statedGoals("Hit 140 kg on squat today, felt great")).toEqual([]);
    expect(statedGoals("Squat felt heavy at 120 kg")).toEqual([]);
  });

  it("reads the unit from their training when none was said, and flags it", () => {
    // squat now 100 kg: 225 is believable in lb (102 kg), not in kg
    expect(inferUnit({ values: [220, 225], kind: "lift", currentKg: 100, preferred: "kg" })).toMatchObject({ unit: "lb", source: "inferred" });
    // 105 fits kg (105 kg) and not lb (48 kg)
    expect(inferUnit({ values: [105], kind: "lift", currentKg: 100, preferred: "lb" }).unit).toBe("kg");
    // nothing to compare: their training unit, flagged
    const none = inferUnit({ values: [200], kind: "lift", currentKg: null, preferred: "lb" });
    expect(none).toMatchObject({ unit: "lb", source: "inferred" });
    expect(none.note).toMatch(/Confirm/);
  });

  it("one goal is one row: same lift at the same meet, never twice", () => {
    expect(dedupeKey({ kind: "lift", lift: "squat", competitionId: "c1", deadline: "2026-12-05" })).toBe("lift:squat:comp:c1");
    expect(dedupeKey({ kind: "bodyweight", lift: null, competitionId: null, deadline: "2027-03-01" })).toBe("bodyweight:date:2027-03-01");
    const a = dedupeKey({ kind: "physique", lift: null, competitionId: null, deadline: null, text: "Ana wants to keep growing muscle", names: ["Ana"] });
    expect(a).not.toMatch(/ana/);
    expect(goalTitle({ kind: "lift", lift: "squat", eventTitle: "Winter Open", deadline: null, timing: "third" })).toBe("Squat third attempt · Winter Open");
  });
});

describe("feasibility", () => {
  it("scores a target by where it sits in their own range: 95 easy, 75 moderate, 15 extreme", () => {
    const anchors = approachAnchors(100, { lowKg: 100, expectedKg: 105, highKg: 107.5 }, 2.5);
    expect(anchors).toEqual({ easy: 97.5, conservative: 100, moderate: 105, high: 107.5, very_aggressive: 110, extreme: 117.5 });
    expect(scoreAgainst(105, anchors, "up").score).toBe(75);
    expect(scoreAgainst(97.5, anchors, "up").score).toBe(95);
    expect(scoreAgainst(117.5, anchors, "up").score).toBe(15);
    expect(scoreAgainst(140, anchors, "up").score).toBeLessThan(15);
  });

  it("an athlete's stated thirds against the meet forecast: supported, with room above", () => {
    const f = assessGoal(spec({ client_kg: toKg(220, "lb"), client_kg_max: toKg(225, "lb"), competition_id: "comp1", deadline: "2026-12-05" }), ctx());
    expect(f.projection).toMatchObject({ expectedKg: 105, source: "meet_forecast" });
    expect(f.judged).toBe("client");
    expect(f.score).toBeGreaterThanOrEqual(80);
    expect(f.score).toBeLessThanOrEqual(86);
    expect(f.headline).toMatch(/^8\d\/100 feasibility: Current training supports this target\.$/);
    expect(f.approaches.map((a) => a.key)).toEqual(["easy", "conservative", "moderate", "high", "very_aggressive", "extreme"]);
    expect(f.action.kind).toBe("approve");
    expect(f.timeLeft.line).toBe("9 days");
  });

  it("recommends the high approach only when they asked for the top end and nothing argues against it", () => {
    const pref = ctx({ preferences: { comp1: ["Wants to push the top end at the meet rather than make 9/9 the main goal."] } });
    expect(assessGoal(spec({ competition_id: "comp1", deadline: "2026-12-05" }), pref).recommended).toBe("high");
    const pain = ctx({ preferences: pref.preferences, concerns: [{ lift: "squat", severity: "concern", text: "Knee pain getting worse" }] });
    const f = assessGoal(spec({ competition_id: "comp1", deadline: "2026-12-05" }), pain);
    expect(f.recommended).toBe("conservative");
    expect(f.recommendedWhy).toMatch(/Knee pain/);
  });

  it("an approved target past the forecast at a meet says change the target, not the program", () => {
    const f = assessGoal(spec({ status: "active", approved_kg: 115, competition_id: "comp1", deadline: "2026-12-05" }), ctx());
    expect(f.score).toBeLessThan(35);
    expect(f.action.kind).toBe("adjust_target");
    expect(f.action.suggestedKg).toBe(105);
    expect(f.headline).toMatch(/risk/);
  });

  it("a working plan is kept: maintain, no change for its own sake", () => {
    const f = assessGoal(spec({ status: "active", approved_kg: 102.5, competition_id: "comp1", deadline: "2026-12-05" }), ctx());
    expect(f.action.kind).toBe("maintain");
    expect(f.action.line).toBe("Maintain plan: current programming is working.");
  });

  it("a lift by a date reads the training line and the usual rate for their level", () => {
    const p = trainingProjection(ctx().lifts.squat!, TODAY, "2027-03-05", "intermediate", null)!;
    expect(p.range.expectedKg).toBeGreaterThan(100);
    expect(p.range.expectedKg).toBeLessThan(108);
    expect(p.confidence).toBe("high");
    const far = assessGoal(spec({ status: "active", approved_kg: 115, deadline: "2027-03-05" }), ctx());
    expect(far.action.kind).toBe("adjust_program");
    const wild = assessGoal(spec({ status: "active", approved_kg: 125, deadline: "2027-03-05" }), ctx());
    expect(wild.action.kind).toBe("adjust_target");
    expect(far.pace.requiredPctPerWeek).toBeGreaterThan(far.pace.usualPctPerWeek![1]);
  });

  it("too little recent data is low confidence and asks for data, never a guess", () => {
    const thin = ctx({ lifts: { squat: { nowKg: 100, state: "stale", basis: null, basisDay: "2026-09-01", hardSessions6w: 0, trendPerWeek: null, direction: "unclear" } } });
    const f = assessGoal(spec({ status: "active", approved_kg: 102.5, deadline: "2027-03-05" }), thin);
    expect(f.confidence).toBe("low");
    expect(f.action.kind).toBe("collect_data");
    const none = assessGoal(spec({ status: "active", approved_kg: 102.5, deadline: "2027-03-05" }), ctx({ lifts: {} }));
    expect(none.measurable).toBe(false);
    expect(none.headline).toMatch(/Low confidence/);
    expect(none.missing.join(" ")).toMatch(/squat/);
  });

  it("a bodyweight goal is judged by the pace it takes against the safe rates", () => {
    const comfy = assessGoal(spec({ kind: "bodyweight", lift: null, status: "active", approved_kg: 57, deadline: "2027-02-25" }), ctx());
    expect(comfy.measurable).toBe(true);
    expect(comfy.score!).toBeGreaterThanOrEqual(75);
    const crash = assessGoal(spec({ kind: "bodyweight", lift: null, status: "active", approved_kg: 52, deadline: "2026-12-10" }), ctx());
    expect(crash.score!).toBeLessThan(30);
    expect(crash.headline).toMatch(/risk/i);
    expect(crash.action.kind).toBe("adjust_target");
  });

  it("goals in words are tracked, never scored", () => {
    const f = assessGoal(spec({ kind: "physique", lift: null, client_text: "grow muscle" }), ctx());
    expect(f.measurable).toBe(false);
    expect(f.score).toBeNull();
    expect(f.headline).toMatch(/Not scored/);
  });

  it("learns from how past approved targets went (two outcomes or more)", () => {
    expect(calibrationFrom([{ actualKg: 105, projectedAtApprovalKg: 110, nowAtApprovalKg: 100 }])).toBeNull();
    expect(
      calibrationFrom([
        { actualKg: 105, projectedAtApprovalKg: 110, nowAtApprovalKg: 100 },
        { actualKg: 203, projectedAtApprovalKg: 210, nowAtApprovalKg: 200 },
      ]),
    ).toBe(0.5);
    const slow = trainingProjection(ctx().lifts.squat!, TODAY, "2027-03-05", "intermediate", 0.5)!;
    const normal = trainingProjection(ctx().lifts.squat!, TODAY, "2027-03-05", "intermediate", null)!;
    expect(slow.range.expectedKg).toBeLessThan(normal.range.expectedKg);
  });

  it("re-asks only on a meaningful change", () => {
    const a = assessGoal(spec({ status: "active", approved_kg: 102.5, competition_id: "comp1", deadline: "2026-12-05" }), ctx());
    expect(meaningfulChange(a, a)).toBe(false);
    const b = assessGoal(spec({ status: "active", approved_kg: 115, competition_id: "comp1", deadline: "2026-12-05" }), ctx());
    expect(meaningfulChange(a, b)).toBe(true);
  });

  it("resolves an outcome from what was lifted or weighed", () => {
    expect(resolveOutcome({ kind: "lift", targetKg: 102.5, actualKg: 105, direction: "up" })).toBe("achieved");
    expect(resolveOutcome({ kind: "lift", targetKg: 102.5, actualKg: 100, direction: "up" })).toBe("missed");
    expect(resolveOutcome({ kind: "bodyweight", targetKg: 57, actualKg: 57.2, direction: "down" })).toBe("achieved");
  });

  it("decides an action from the band and the evidence", () => {
    const anchors = approachAnchors(100, { lowKg: 100, expectedKg: 105, highKg: 107.5 }, 2.5);
    const base = { goal: spec({ status: "active" }), anchors, recommended: "moderate" as const, direction: "up" as const, unit: "kg" as const, projection: null };
    expect(decideAction({ ...base, score: 40, band: "very_aggressive", conf: "high", weeks: 12 }).kind).toBe("adjust_program");
    expect(decideAction({ ...base, score: 40, band: "very_aggressive", conf: "high", weeks: 3 }).kind).toBe("adjust_target");
    expect(decideAction({ ...base, score: 95, band: "easy", conf: "high", weeks: 12 }).kind).toBe("raise_target");
    expect(decideAction({ ...base, score: 95, band: "easy", conf: "low", weeks: 12 }).kind).toBe("collect_data");
    expect(recommendApproach({ confidence: "high", concerns: [], lift: "squat", adherencePct: 55, preferences: [], meetSoon: false }).key).toBe("conservative");
  });
});

describe("client updates", () => {
  const change = (over: Partial<OutboxChange> = {}): OutboxChange => ({
    goalId: "g1",
    version: 2,
    kind: "lift",
    lift: "squat",
    title: "Squat third attempt · Winter Open",
    eventTitle: "Winter Open",
    deadline: "2026-12-05",
    targetKg: toKg(225, "lb"),
    targetText: null,
    unit: "lb",
    beforeKg: null,
    ...over,
  });

  it("writes one short message from approved targets only", () => {
    const body = buildUpdateMessage({ firstName: "Ana", changes: [change(), change({ goalId: "g2", lift: "bench", targetKg: toKg(115, "lb") })] });
    expect(body).toContain("Hey Ana, quick update on your targets for Winter Open (Dec 5):");
    expect(body).toContain("• Squat: 225 lb");
    expect(body).toContain("• Bench: 115 lb");
    expect(body).toMatch(/Keep logging every set with its RPE/);
    expect(body).not.toMatch(/feasib|projection|\/100|confidence/i);
  });

  it("consolidates: a newer change to the same goal replaces the line and keeps what it was before", () => {
    const merged = mergeChanges([change({ version: 2, beforeKg: toKg(215, "lb") })], change({ version: 3, targetKg: toKg(230, "lb") }));
    expect(merged).toHaveLength(1);
    expect(buildUpdateMessage({ firstName: null, changes: merged })).toContain("Squat: 230 lb (was 215 lb)");
  });

  it("drops outdated or withdrawn changes before sending", () => {
    const goals = [{ id: "g1", status: "active", version: 2, approved_kg: toKg(225, "lb"), client_facing: true }];
    expect(currentChanges([change()], goals)).toHaveLength(1);
    expect(currentChanges([change()], [{ ...goals[0], version: 3 }])).toHaveLength(0);
    expect(currentChanges([change()], [{ ...goals[0], status: "dismissed" }])).toHaveLength(0);
    expect(currentChanges([change()], [{ ...goals[0], client_facing: false }])).toHaveLength(0);
  });

  it("reads presence: online, offline, and unknown when the heartbeat can't be trusted", () => {
    const now = Date.parse("2026-11-26T18:00:00Z");
    const ago = (m: number) => new Date(now - m * 60_000).toISOString();
    expect(presenceOf({ lastBeatAt: ago(1), lastActiveAt: null, now })).toBe("online");
    expect(presenceOf({ lastBeatAt: ago(30), lastActiveAt: ago(31), now })).toBe("offline");
    expect(presenceOf({ lastBeatAt: null, lastActiveAt: ago(300), now })).toBe("unknown");
    expect(presenceOf({ lastBeatAt: ago(60 * 24 * 20), lastActiveAt: null, now })).toBe("unknown");
    // active long after the last heartbeat: the heartbeat isn't covering them
    expect(presenceOf({ lastBeatAt: ago(600), lastActiveAt: ago(30), now })).toBe("unknown");
  });

  it("sends only offline, after the window, outside quiet hours, and holds what it can't verify", () => {
    const now = Date.parse("2026-11-26T18:00:00Z");
    const base = { now, sendAfter: now - 1000, createdAt: now - 40 * 60_000, autoSend: true, presence: "offline" as const, quiet: { now: false, endsAt: null }, currentChanges: 1, editedThenChanged: false };
    expect(sendDecision(base)).toEqual({ send: true });
    expect(sendDecision({ ...base, sendAfter: now + 60_000 })).toMatchObject({ send: false, wait: "window" });
    expect(sendDecision({ ...base, presence: "online" })).toMatchObject({ send: false, wait: "online" });
    expect(sendDecision({ ...base, quiet: { now: true, endsAt: now + 3600_000 } })).toMatchObject({ wait: "quiet", retryAt: now + 3600_000 });
    expect(sendDecision({ ...base, presence: "unknown" })).toMatchObject({ wait: "presence_unknown" });
    expect(sendDecision({ ...base, presence: "unknown", sendAfter: now - 25 * 3600_000 })).toMatchObject({ hold: "presence_unknown" });
    expect(sendDecision({ ...base, currentChanges: 0 })).toMatchObject({ hold: "nothing_current" });
    expect(sendDecision({ ...base, editedThenChanged: true })).toMatchObject({ hold: "changed_after_edit" });
    expect(sendDecision({ ...base, autoSend: false })).toMatchObject({ hold: "auto_off" });
    expect(inQuiet(23, 22, 7)).toBe(true);
    expect(inQuiet(12, 22, 7)).toBe(false);
  });
});

describe("what the AI reads", () => {
  const row = (over: Partial<GoalRow>): GoalRow =>
    ({
      id: "g", client_id: "c", kind: "lift", lift: "squat", title: "Squat third attempt · Winter Open", client_value: 220, client_value_max: 225, client_unit: "lb", client_unit_source: "inferred",
      client_kg: null, client_kg_max: null, client_text: null, approved_value: null, approved_unit: null, approved_kg: null, approved_text: null, approved_approach: null, approved_at: null, approved_by: null,
      deadline: "2026-12-05", competition_id: "comp1", event_title: "Winter Open", status: "proposed", client_facing: true, source_kind: "meeting", source_id: null, source_quote: null, source_context: null,
      source_speaker: "athlete", source_at: null, tentative: true, feasibility: null, assessed_at: null, data_hash: null, recommendation: null, recommendation_status: "none", recommendation_at: null, outcome: null,
      version: 1, dedupe_key: "x", created_at: "", updated_at: "", ...over,
    }) as GoalRow;

  it("labels the client's number, the projection and the approved target apart", () => {
    const t = goalsText([row({}), row({ id: "h", lift: "bench", title: "Bench third attempt · Winter Open", status: "active", approved_kg: 52.5, approved_approach: "moderate" })], "kg")!;
    expect(t.split("\n")[0]).toMatch(/APPROVED: 52\.5 kg \(Moderate\)/);
    expect(t).toMatch(/client said: 220–225 lb \(unit inferred, unconfirmed\) \(tentative\) · not reviewed by the coach yet/);
    expect(fmtClientTarget({ client_value: 110, client_value_max: 115, client_unit: "lb", client_text: null })).toBe("110–115 lb");
    expect(timeLeftLine(TODAY, "2027-02-08").line).toBe("11 weeks");
  });
});
