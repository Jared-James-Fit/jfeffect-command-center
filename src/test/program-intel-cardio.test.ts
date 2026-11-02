import { describe, expect, it } from "vitest";
import {
  cardioBriefLines,
  cardioGoal,
  cardioPlanFromTargets,
  cardioTargetsFromProposal,
  liftingMinutesWith,
  proposeCardio,
  type RawCardioTarget,
} from "@/lib/program-intel/cardio";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import { withoutCardioRows } from "@/lib/program-intel/next-program";
import { pickCardioTargetForDay } from "@/lib/resolved-client-days";
import { currentCardioText } from "@/lib/nutrition-cardio-sync";
import { homeGym } from "./program-intel-scenarios";

const TODAY = "2026-11-02";
const target = (over: Partial<RawCardioTarget>): RawCardioTarget => ({
  id: over.id ?? "t1",
  day_type: "Training Day",
  cardio_type: "Incline Treadmill Walk",
  duration_minutes: 15,
  frequency_per_week: 4,
  scheduled_weekdays: ["Monday", "Tuesday", "Wednesday", "Friday"],
  incline: 5,
  status: "Active",
  enabled: true,
  visible_to_client: true,
  program_name: null,
  start_date: "2026-11-01",
  end_date: null,
  source: "nutrition",
  updated_at: "2026-11-02T04:00:00Z",
  ...over,
});

describe("the client's cardio plan, as the program generator reads it", () => {
  it("Marc: nutrition plan's 15-min walk after lifting and 20 min on days off, with how much he did", () => {
    const plan = cardioPlanFromTargets(
      [
        target({ id: "train" }),
        target({ id: "rest", day_type: "Non-Training Day", duration_minutes: 20, frequency_per_week: 2, scheduled_weekdays: ["Thursday", "Saturday", "Sunday"] }),
        target({ id: "old", day_type: "Training Day", program_name: "Old multi-week", duration_minutes: 40 }),
        target({ id: "off", day_type: "Training Day", enabled: false, duration_minutes: 50 }),
      ],
      [
        { cardio_target_id: "train", completed_date: "2026-10-26", completed: true },
        { cardio_target_id: "rest", completed_date: "2026-10-29", completed: true },
        { cardio_target_id: "rest", completed_date: "2026-10-31", completed: false, skipped: true },
      ],
      TODAY,
    );
    expect(plan.source).toBe("plan");
    expect(plan.origin).toBe("nutrition");
    expect(plan.trainingDay).toMatchObject({ type: "Incline Treadmill Walk", minutes: 15, incline: 5 });
    expect(plan.restDay).toMatchObject({ minutes: 20, perWeek: 2 });
    expect(plan.done).toEqual({ done: 2, planned: 24 });
    expect(plan.why).toMatch(/nutrition plan/);
  });

  it("a coach's own target outranks one read from the program", () => {
    const plan = cardioPlanFromTargets(
      [target({ id: "rows", source: "program_rows", duration_minutes: 10 }), target({ id: "coach", source: null, duration_minutes: 20 })],
      [],
      TODAY,
    );
    expect(plan.trainingDay?.minutes).toBe(20);
    expect(plan.origin).toBe("coach");
  });

  it("no plan on file reads as none", () => {
    expect(cardioPlanFromTargets([], [], TODAY)).toMatchObject({ source: "none", trainingDay: null, restDay: null });
  });
});

describe("a cardio plan proposed when there is none (program built first)", () => {
  const days = ["Monday", "Tuesday", "Wednesday", "Friday"];

  it("reads the goal: fat loss, recomposition, general fitness, or none for strength and muscle", () => {
    expect(cardioGoal("Lose body fat")).toBe("fat_loss");
    expect(cardioGoal("Body recomposition")).toBe("recomp");
    expect(cardioGoal("losing fat and building muscle")).toBe("recomp");
    expect(cardioGoal("Improve general fitness")).toBe("general");
    expect(cardioGoal("Get stronger for my next meet")).toBe("none");
    expect(cardioGoal("Build muscle")).toBe("none");
  });

  it("fat loss: 15 min after lifting and three 25-min walks on days off, never on a training day", () => {
    const p = proposeCardio({ goalText: "Lose body fat", trainingDays: days });
    expect(p.source).toBe("proposed");
    expect(p.trainingDay).toMatchObject({ minutes: 15, weekdays: days, zone: "Zone 2" });
    expect(p.restDay?.minutes).toBe(25);
    expect(p.restDay?.weekdays).toHaveLength(3);
    for (const d of p.restDay!.weekdays) expect(days).not.toContain(d);
  });

  it("general fitness: rest-day walks only; a meet within 6 weeks or a strength goal: none", () => {
    const g = proposeCardio({ goalText: "General fitness", trainingDays: ["Monday", "Wednesday", "Friday"] });
    expect(g.trainingDay).toBeNull();
    expect(g.restDay?.perWeek).toBe(2);
    expect(proposeCardio({ goalText: "Lose body fat", trainingDays: days, meetWeeksOut: 4 }).source).toBe("none");
    expect(proposeCardio({ goalText: "Powerlifting total", trainingDays: days }).source).toBe("none");
  });

  it("on Assign it becomes cardio targets marked as set with the program", () => {
    const rows = cardioTargetsFromProposal(proposeCardio({ goalText: "Lose body fat", trainingDays: days }), { clientId: "c1", trainingDays: days, today: TODAY });
    expect(rows.map((r) => r.day_type)).toEqual(["Training Day", "Non-Training Day"]);
    expect(rows.every((r) => r.source === "program" && r.status === "Active" && r.start_date === TODAY)).toBe(true);
    expect(rows[0]).toMatchObject({ duration_minutes: 15, scheduled_weekdays: days, incline: 5 });
    expect(cardioTargetsFromProposal(cardioPlanFromTargets([target({})], [], TODAY), { clientId: "c1", trainingDays: days, today: TODAY })).toEqual([]);
  });
});

describe("the program leaves room for the cardio and never writes it", () => {
  it("lifting time is the stated session less the cardio after it (never under 20 min)", () => {
    const cardio = { trainingDay: { type: "Walk", minutes: 15, perWeek: 4, weekdays: [], incline: null, zone: null } };
    expect(liftingMinutesWith(cardio, 60, 60)).toBe(45);
    expect(liftingMinutesWith(cardio, 40, 75)).toBe(40);
    expect(liftingMinutesWith(cardio, 60, null)).toBe(60);
    expect(liftingMinutesWith(null, 60, 60)).toBe(60);
    expect(liftingMinutesWith({ trainingDay: { ...cardio.trainingDay, minutes: 50 } }, 60, 60)).toBe(20);
  });

  it("the brief says what the plan is and that cardio rows are never written", () => {
    const lines = cardioBriefLines(cardioPlanFromTargets([target({})], [], TODAY)).join("\n");
    expect(lines).toMatch(/Training days: Incline Treadmill Walk 15 min, incline 5%/);
    expect(lines).toMatch(/LAST exercise of every workout/);
    expect(lines).toMatch(/never write walking, treadmill, bike/);
  });

  it("a walk or bike the model writes is taken out; lunges and carries stay", () => {
    const block = {
      days: [
        { exercises: [{ exercise_name: "Back Squat" }, { exercise_name: "Walking Lunges" }, { exercise_name: "Treadmill Walk" }] },
        { exercises: [{ exercise_name: "Dumbbell Farmer Walks" }, { exercise_name: "Stationary Exercise Bike" }] },
      ],
    };
    const { block: lean, removed } = withoutCardioRows(block);
    expect(removed).toEqual(["Treadmill Walk", "Stationary Exercise Bike"]);
    expect(lean.days.map((d) => d.exercises.map((e) => e.exercise_name))).toEqual([["Back Squat", "Walking Lunges"], ["Dumbbell Farmer Walks"]]);
    expect(withoutCardioRows({ days: [{ exercises: [{ exercise_name: "Bench Press" }] }] }).removed).toEqual([]);
  });

  it("the recommended setup carries their plan and trims lifting so the cardio still fits", () => {
    const rec = homeGym();
    rec.cardioTargets = [target({ id: "train", duration_minutes: 25 })];
    const intel = buildGeneratorIntel(rec);
    const s = intel.recommendation.setup;
    expect(s.cardio?.source).toBe("plan");
    expect(s.cardio?.trainingDay?.minutes).toBe(25);
    // 75 min stated in Goals & Setup: lifting gets 50 so the 25-min walk after it fits
    expect(s.sessionMinutes).toBe(50);
    expect(intel.recommendation.why.sessionMinutes?.reason).toMatch(/25-min cardio after it/);
    expect(intel.recommendation.why.cardio?.source).toBe("Nutrition plan");
  });

  it("with no plan on file the setup proposes one from the goal (or none)", () => {
    const intel = buildGeneratorIntel(homeGym());
    expect(["proposed", "none"]).toContain(intel.recommendation.setup.cardio?.source);
    expect(intel.recommendation.why.cardio?.reason).toBeTruthy();
  });
});

describe("the cardio card follows the actual day", () => {
  const train = { id: "train", day_type: "Training Day", scheduled_weekdays: ["Monday", "Tuesday", "Thursday", "Friday"], status: "Active", enabled: true, visible_to_client: true } as any;
  const rest = { id: "rest", day_type: "Non-Training Day", scheduled_weekdays: ["Wednesday", "Saturday", "Sunday"], status: "Active", enabled: true, visible_to_client: true } as any;
  const high = { id: "high", day_type: "High Day", scheduled_weekdays: ["Saturday"], status: "Active", enabled: true, visible_to_client: true } as any;

  it("a workout moved to Wednesday gets the training-day cardio (it's in that workout)", () => {
    expect(pickCardioTargetForDay([train, rest], "training", "2026-11-04")?.id).toBe("train");
  });
  it("a Monday with no workout never shows the training-day cardio", () => {
    expect(pickCardioTargetForDay([train, rest], "non_training", "2026-11-02")).toBeNull();
  });
  it("the usual days still pick their own session; a High Day on Saturday still shows", () => {
    expect(pickCardioTargetForDay([train, rest], "training", "2026-11-02")?.id).toBe("train");
    expect(pickCardioTargetForDay([train, rest], "non_training", "2026-11-04")?.id).toBe("rest");
    expect(pickCardioTargetForDay([train, rest, high], "non_training", "2026-11-07")?.id).toBe("rest");
    expect(pickCardioTargetForDay([train, high], "non_training", "2026-11-07")?.id).toBe("high");
  });
});

describe("the nutrition AI knows the training days and where cardio is done", () => {
  it("CURRENT CARDIO names the days, says the training-day session ends every workout, and flags a program-set plan", () => {
    const text = currentCardioText(
      [{ id: "a", day_type: "Training Day", cardio_type: "Incline Treadmill Walk", duration_minutes: 15, status: "Active", enabled: true, source: "program" }],
      { trainingDays: ["Monday", "Tuesday", "Wednesday", "Friday"] },
    );
    expect(text).toMatch(/Training Day: 15 min incline treadmill walk/);
    expect(text).toMatch(/set with the training program/);
    expect(text).toMatch(/TRAINING DAYS: Monday, Tuesday, Wednesday, Friday \(4 a week\)/);
    expect(text).toMatch(/added to the end of every workout/);
    expect(currentCardioText([], { trainingDays: ["Monday"] })).toMatch(/none yet/);
    expect(currentCardioText([])).toBe("");
  });
});
