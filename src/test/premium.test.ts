import { describe, expect, it } from "vitest";
import { briefFromProfile, buildCleoDraft, findExercise, weekEffort } from "@/lib/premium/cleo-build";
import { planIssue } from "@/lib/program-plan";
import { unreadCount } from "@/lib/premium/premium";

const LIB = [
  { id: "ex-squat", name: "Back Squat", muscle_group: "Quads" },
  { id: "ex-bench", name: "Bench Press", muscle_group: "Chest" },
  { id: "ex-dl", name: "Deadlift", muscle_group: "Back" },
  { id: "ex-ohp", name: "Overhead Press" },
  { id: "ex-row", name: "Barbell Row" },
  { id: "ex-lat", name: "Lat Pulldown" },
  { id: "ex-rdl", name: "Romanian Deadlift" },
  { id: "ex-lp", name: "Leg Press" },
  { id: "ex-db", name: "Dumbbell Bench Press" },
  { id: "ex-curl", name: "Seated Leg Curl" },
  { id: "ex-lr", name: "Lateral Raise" },
  { id: "ex-plank", name: "Plank" },
];

describe("Build with Cleo", () => {
  it("reads the member's own profile into a brief", () => {
    expect(briefFromProfile({ goals_tags: ["Powerlifting meet"], experience_level: "advanced", committed_training_days: ["mon", "wed", "fri", "sat"] })).toEqual({ goal: "powerlifting", level: "advanced", days: 4, weeks: 8 });
    expect(briefFromProfile({ goals_tags: ["Build muscle"], experience_level: "new", committed_training_days: [] })).toMatchObject({ goal: "muscle", level: "beginner", days: 3 });
    expect(briefFromProfile({})).toMatchObject({ goal: "general", level: "beginner", days: 3 });
  });

  it("finds exercises by name in the library, never invents one", () => {
    expect(findExercise(LIB, ["Leg Curl"])?.id).toBe("ex-curl");
    expect(findExercise(LIB, ["Bench Press"])?.id).toBe("ex-bench");
    expect(findExercise(LIB, ["Hack Squat Machine"])).toBeNull();
  });

  it("drafts a whole program the builder accepts, the same answers giving the same program, every 4th week lighter", () => {
    const brief = { goal: "strength" as const, level: "intermediate" as const, days: 3, weeks: 8 };
    const { draft, missing } = buildCleoDraft(brief, LIB);
    expect(missing).toEqual([]);
    expect(planIssue(draft.title, draft.plan)).toBeNull();
    const weeks = draft.plan.blocks[0]!.weeks;
    expect(weeks).toHaveLength(8);
    expect(weeks[0]!.days.map((d) => d.title)).toEqual(["Squat + Bench", "Deadlift + Press", "Bench + Squat volume"]);
    // same day and exercise keys every week (the builder keeps weeks in step by key)
    expect(weeks[5]!.days[0]!.key).toBe(weeks[0]!.days[0]!.key);
    expect(weeks[5]!.days[0]!.exercises[0]!.key).toBe(weeks[0]!.days[0]!.exercises[0]!.key);
    expect(weeks[3]!.days[0]!.exercises[0]).toMatchObject({ rpe: "6", sets: 3 });
    expect(weeks[2]!.days[0]!.exercises[0]).toMatchObject({ rpe: "8.5", sets: 4 });
    expect(draft.description).toMatch(/Change anything before you start it/);
    expect(weekEffort(0, false, "beginner").rpe).toBe("6.5");
  });

  it("says what it couldn't find instead of guessing", () => {
    const { draft, missing } = buildCleoDraft({ goal: "muscle", level: "beginner", days: 4, weeks: 4 }, LIB.filter((e) => e.id !== "ex-lat"));
    expect(missing).toEqual(["Lat Pulldown"]);
    expect(planIssue(draft.title, draft.plan)).toBeNull();
  });
});

describe("the Cleo inbox", () => {
  it("counts what's unread", () => {
    expect(unreadCount([{ read_at: null }, { read_at: "x" }])).toBe(1);
  });
});
