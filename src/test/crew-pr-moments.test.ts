import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  featuredLift,
  headlineFromRecords,
  headlinePr,
  isBarbellBigThree,
  isPrMoment,
  type WorkoutShareStats,
} from "@/lib/community";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 18 2026: 120 of the 165 workouts in the 30 days before had a PR of some
 * kind (mostly accessories' 10+ rep bests: 139 of 249 records), so the story
 * row, the feed and the recap called nearly every session a PR. A workout now
 * leads with a PR only when it's an all-time PR at 10 reps or fewer on the
 * session's main lift, or on a barbell squat, bench or deadlift (57 of 165);
 * every other record still counts and still shows where the sets are.
 */
const base = {
  workout_title: "Block 2 · Week 3",
  completed_at: "2026-11-18T18:00:00Z",
  duration_min: 60,
  working_sets: 16,
  tonnage_kg: 9000,
  top_lift: { exercise_name: "Hip Thrust - Barbell", reps: 8, load_kg: 140 },
  pr_count: 0,
  prs: [],
} as unknown as WorkoutShareStats;
const pr = (
  exercise_name: string,
  reps: number,
  load_kg: number,
  scope: "atpr" | "program_pr" | "block_pr" = "atpr",
) => ({ exercise_name, reps, load_kg, scope });

describe("the PR a workout leads with", () => {
  it("an all-time PR at 10 reps or fewer on the session's main lift", () => {
    const s = { ...base, pr_count: 1, prs: [pr("Hip Thrust - Barbell", 8, 140)] };
    expect(headlinePr(s)?.exercise_name).toBe("Hip Thrust - Barbell");
    expect(isPrMoment(s)).toBe(true);
    expect(featuredLift(s)).toMatchObject({ name: "Hip Thrust - Barbell", pr: "atpr" });
  });
  it("else an all-time PR on a barbell squat, bench or deadlift (a Primary Bench on a day the squat named)", () => {
    const s = {
      ...base,
      top_lift: { exercise_name: "Competition Squat", reps: 3, load_kg: 200 },
      pr_count: 2,
      prs: [pr("Cable Triceps Pushdown", 15, 40), pr("Competition Bench", 4, 130)],
    };
    expect(headlinePr(s)?.exercise_name).toBe("Competition Bench");
  });
  it("never an accessory's rep best, a rep-out past 10, or a block / program best", () => {
    const accessory = {
      ...base,
      pr_count: 2,
      prs: [pr("Cable Triceps Pushdown", 15, 40), pr("Dumbbell Lateral Raise", 12, 12)],
    };
    expect(headlinePr(accessory)).toBeNull();
    expect(isPrMoment(accessory)).toBe(false);
    // the card features the session's main lift as it was lifted, not the accessory
    expect(featuredLift(accessory)).toMatchObject({ name: "Hip Thrust - Barbell", pr: null });
    expect(headlinePr({ ...base, prs: [pr("Hip Thrust - Barbell", 12, 120)] })).toBeNull();
    expect(headlinePr({ ...base, prs: [pr("Competition Squat", 3, 200, "block_pr")] })).toBeNull();
    expect(
      headlinePr({ ...base, prs: [pr("Competition Deadlift", 2, 250, "program_pr")] }),
    ).toBeNull();
  });
  it("a barbell lift of the family counts; a dumbbell, machine, belt or split-squat one doesn't", () => {
    for (const n of [
      "Competition Squat",
      "High Bar Squat",
      "2-Count Pause Bench Press",
      "Close-Grip Bench Press",
      "Romanian Deadlift",
      "Trap Bar Deadlift",
    ])
      expect(isBarbellBigThree(n), n).toBe(true);
    for (const n of [
      "Dumbbell Bulgarian Split Squat",
      "Belt Squat",
      "Hack Squat",
      "Incline Bench Press - Dumbbell",
      "Normal Squat Smith Machine",
      "Leg Press",
      "Cable Row",
    ])
      expect(isBarbellBigThree(n), n).toBe(false);
  });
  it("the recap reads the same rule from its full records, every one rather than the stats' top three", () => {
    const records = {
      records: [
        { exercise_name: "Cable Triceps Pushdown", reps: 15, load_kg: 40, atpr: true },
        { exercise_name: "Competition Squat", reps: 3, load_kg: 205, atpr: true },
      ],
      load_records: [],
    };
    expect(headlineFromRecords(records, "Competition Squat")?.exercise_name).toBe(
      "Competition Squat",
    );
    expect(headlineFromRecords({ records: [records.records[0]] }, "Competition Squat")).toBeNull();
    // with the main lift not known yet (stats still loading), a barbell big three still counts
    expect(headlineFromRecords(records, null)?.exercise_name).toBe("Competition Squat");
  });
});

describe("where it's used", () => {
  it("the recap: the trophy, the PR headline and the full sting only for the headline PR; every record still listed", () => {
    const recap = read("src/components/workout-submission-summary.tsx");
    expect(recap).toContain(
      "const lead = usesRecords ? headlineFromRecords(records, shareStats?.top_lift?.exercise_name ?? null) : null;",
    );
    expect(recap).toContain('stingRef.current = bigMoment ? "pr" : "workout";');
    expect(recap).toContain("lead ? `${lead.exercise_name} PR`");
    expect(recap).toContain(
      "<NewRecordsSection records={records} unit={displayUnit} setUnit={setUnit} highlight={!!lead} />",
    );
    // never shouted in capitals any more
    expect(recap).not.toContain("NEW ALL-TIME PR!");
  });
  it("the recap and the sheet give the trophy only to the headline PR; any other record is said quietly (Nov 21 2026)", () => {
    // the feed's workout chip is gone: the recap (the post's last swipe) is where a workout's PRs show
    expect(read("src/components/community/post-card.tsx")).not.toContain("data-page-prs");
    const lib = read("src/lib/workout-recap.ts");
    expect(lib).toContain("return { label: SCOPE_WORD[e.pr], loud: !!head && same(e.name, head.exercise_name) };");
    expect(read("src/components/community/workout-recap.tsx")).toContain('data-recap-pr={pr.loud ? "headline" : "quiet"}');
    expect(read("src/components/community/workout-details.tsx")).toContain('data-detail-pr={pr.loud ? "headline" : "quiet"}');
  });
  it("the share cards, the quick story's PR look and the grid / Home cards all read featuredLift / isPrMoment", () => {
    expect(read("src/lib/community.ts")).toContain("isPr: isPrMoment(s),");
    expect(read("src/components/community/post-tile.tsx")).toContain(
      "const lift = featuredLift(stats);",
    );
    expect(read("src/components/community/quick-story.tsx")).toContain("isPr: data.isPr");
  });
});
