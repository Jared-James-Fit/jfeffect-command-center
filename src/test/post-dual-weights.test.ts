import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREW_UNIT,
  dualLoad,
  dualLoadText,
  dualTotal,
  labelSecondary,
  recordedLoad,
  splitAtWeight,
  weightNumber,
  withOther,
} from "@/lib/dual-weight";
import {
  buildCardExtras,
  buildShareCardFields,
  exerciseBestLines,
  formatTopSet,
  formatTopSetDual,
  pickWorkoutWin,
  postSlides,
  progressVsLast,
  topSetOther,
  winsHero,
  workoutStats,
  type CommunityExercise,
  type WinsStats,
  type WorkoutShareStats,
} from "@/lib/community";

const read = (p: string) => readFileSync(p, "utf8");

/** The kg mirror the database stores for a typed weight (tg_pl_row_results_sync_units: 4 decimals). */
const mirrorKg = (v: number, unit: "kg" | "lb") => Math.round((unit === "lb" ? v * 0.45359237 : v) * 10_000) / 10_000;

const ex = (o: Partial<CommunityExercise>): CommunityExercise => ({
  name: "Squat",
  sets: 3,
  best_load_kg: null,
  best_reps: null,
  max_reps: null,
  max_seconds: null,
  pr: null,
  ...o,
});

const stats = (o: Partial<WorkoutShareStats>): WorkoutShareStats => ({
  workout_title: "Primary SBD",
  completed_at: "2026-11-16T14:00:00Z",
  duration_min: 74,
  working_sets: 18,
  tonnage_kg: mirrorKg(17902, "lb"),
  top_lift: null,
  pr_count: 0,
  prs: [],
  ...o,
});

describe("one weight, both units: the formatter", () => {
  it("reads a typed weight back exactly from its 4-decimal kg mirror, the other unit to one decimal", () => {
    for (const lb of [315, 72.5, 45, 455, 135, 2.5, 1000]) {
      expect(dualLoad(mirrorKg(lb, "lb"), "lb").primary).toBe(`${lb} lb`);
    }
    for (const kg of [142.5, 20, 1.25, 102.5, 300]) {
      expect(dualLoad(mirrorKg(kg, "kg"), "kg").primary).toBe(`${kg} kg`);
    }
    expect(dualLoad(mirrorKg(315, "lb"), "lb").secondary).toBe("142.9 kg");
    expect(dualLoad(mirrorKg(72.5, "lb"), "lb").secondary).toBe("32.9 kg");
    expect(dualLoad(mirrorKg(142.5, "kg"), "kg").secondary).toBe("314.2 lb");
    expect(dualLoadText(mirrorKg(315, "lb"), "lb")).toBe("315 lb (142.9 kg)");
  });

  it("never converts twice: the secondary comes from the stored kg, not the rounded primary", () => {
    // 72.5 lb → 32.8855 kg; via a rounded "32.9 kg" back to lb would read 72.53
    const kg = mirrorKg(72.5, "lb");
    expect(dualLoad(kg, "lb").primary).toBe("72.5 lb");
    expect(dualLoad(kg, "kg").primary).toBe("32.89 kg");
    expect(weightNumber(-0.001, 1)).toBe("0");
  });

  it("shows a weight whose unit isn't known to a plate step in the fallback, as before", () => {
    expect(recordedLoad(102, null, "lb").primary).toBe("225 lb");
    expect(recordedLoad(102, undefined, "kg").primary).toBe("102 kg");
    expect(recordedLoad(206.384, null, "kg").primary).toBe("206.5 kg");
    // a known unit wins over the fallback, and reads exactly
    expect(recordedLoad(mirrorKg(225, "lb"), "lb", "kg").primary).toBe("225 lb");
  });

  it("totals are whole numbers with separators", () => {
    expect(dualTotal(mirrorKg(17902, "lb"), "lb")).toEqual({ unit: "lb", primary: "17,902 lb", secondary: "8,120 kg" });
    expect(dualTotal(8120, "kg")).toEqual({ unit: "kg", primary: "8,120 kg", secondary: "17,902 lb" });
  });

  it("puts the other unit right after the weight in a line of text, matching its case", () => {
    expect(withOther("455 lb × 1", "206.4 kg")).toBe("455 lb (206.4 kg) × 1");
    expect(withOther("455 LB × 1", "206.4 kg")).toBe("455 LB (206.4 KG) × 1");
    expect(withOther("12 reps", "206.4 kg")).toBe("12 reps");
    expect(withOther("455 lb × 1", null)).toBe("455 lb × 1");
    expect(splitAtWeight("Top set · 455 lb × 1 @ RPE 6")).toEqual({ head: "Top set · 455 lb", tail: " × 1 @ RPE 6" });
    expect(splitAtWeight("Set 2 · 12 reps")).toBeNull();
    expect(labelSecondary("455 lb × 1 @ RPE 6", mirrorKg(455, "lb"))).toBe("206.4 kg");
    expect(labelSecondary("BW + 20 kg × 8", 20)).toBe("44.1 lb");
    expect(labelSecondary("12 reps", 20)).toBeNull();
    expect(labelSecondary("455 lb × 1", null)).toBeNull();
  });
});

describe("a post reads the same for every viewer", () => {
  const lbAthlete = stats({
    unit: "lb",
    top_lift: { exercise_name: "Competition Bench Press", reps: 1, load_kg: mirrorKg(315, "lb"), unit: "lb" },
  });
  const kgAthlete = stats({
    unit: "kg",
    tonnage_kg: 8120,
    top_lift: { exercise_name: "Competition Squat", reps: 3, load_kg: 142.5, unit: "kg" },
  });

  it("an lb athlete's lift leads in lb, whether a kg or an lb viewer is looking", () => {
    for (const viewer of ["kg", "lb"] as const) {
      expect(formatTopSet(lbAthlete.top_lift!, viewer)).toBe("315 lb × 1");
      expect(topSetOther(lbAthlete.top_lift!, viewer)).toBe("142.9 kg");
      expect(formatTopSetDual(lbAthlete.top_lift!, viewer)).toBe("315 lb (142.9 kg) × 1");
      expect(workoutStats(lbAthlete, viewer).find((s) => s.label === "Volume")).toEqual({ value: "17,902 lb", label: "Volume", sub: "8,120 kg" });
    }
  });

  it("a kg athlete's lift leads in kg, whether a kg or an lb viewer is looking", () => {
    for (const viewer of ["kg", "lb"] as const) {
      expect(formatTopSetDual(kgAthlete.top_lift!, viewer)).toBe("142.5 kg (314.2 lb) × 3");
      expect(workoutStats(kgAthlete, viewer).find((s) => s.label === "Volume")).toEqual({ value: "8,120 kg", label: "Volume", sub: "17,902 lb" });
    }
  });

  it("a mixed athlete's lifts each read in their own unit (kg competition lifts, lb accessories)", () => {
    const squat = ex({ name: "Competition Squat", best_load_kg: 175, best_reps: 2, best_unit: "kg" });
    const rdl = ex({ name: "RDL", best_load_kg: mirrorKg(185, "lb"), best_reps: 8, best_unit: "lb" });
    for (const viewer of ["kg", "lb"] as const) {
      expect(exerciseBestLines(squat, viewer)).toEqual({ main: "175 kg × 2", other: "385.8 lb" });
      expect(exerciseBestLines(rdl, viewer)).toEqual({ main: "185 lb × 8", other: "83.9 kg" });
    }
    const card = buildShareCardFields({ stats: stats({ unit: "lb", exercises: [squat, rdl] }), unit: "kg", athleteName: "Alyssa", dateLabel: "Mon, Nov 16" });
    expect(card.exercises).toEqual([
      { name: "Competition Squat", detail: "175 kg × 2", pr: false, alt: "385.8 lb" },
      { name: "RDL", detail: "185 lb × 8", pr: false, alt: "83.9 kg" },
    ]);
    expect(card.volume).toBe("17,902 lb");
    expect(card.volumeOther).toBe("8,120 kg");
  });

  it("a PR celebration leads with the PR's own unit", () => {
    const s = stats({ pr_count: 1, prs: [{ exercise_name: "Competition Deadlift", reps: 1, load_kg: mirrorKg(495, "lb"), unit: "lb", scope: "atpr" }] });
    for (const viewer of ["kg", "lb"] as const) {
      expect(pickWorkoutWin(s, viewer)).toMatchObject({ kind: "pr", detail: "495 lb × 1", other: "224.5 kg" });
    }
  });

  it("a hidden weight stays hidden: no load, no other unit", () => {
    const s = stats({ top_lift: { exercise_name: "Bench", reps: 5, load_kg: null, unit: "lb" } });
    expect(formatTopSet(s.top_lift!, "kg")).toBe("5 reps");
    expect(topSetOther(s.top_lift!, "kg")).toBeNull();
    expect(pickWorkoutWin(s, "kg").other).toBeNull();
  });

  it("the comparison with last time stays in today's set's unit on both sides", () => {
    const s = stats({
      unit: "lb",
      tonnage_kg: 6000,
      top_lift: { exercise_name: "Bench", reps: 5, load_kg: mirrorKg(235, "lb"), unit: "lb" },
      prev: { completed_at: "2026-11-09T14:00:00Z", tonnage_kg: 6000, working_sets: 18, unit: "lb", top_lift: { exercise_name: "Bench", reps: 5, load_kg: mirrorKg(225, "lb"), unit: "lb" } },
    });
    const p = progressVsLast(s, "kg")!;
    expect(p.headline).toBe("+10 lb");
    expect(p.sub).toBe("heavier on Bench (+4.5 kg)");
    const x = buildCardExtras({ ...s, tonnage_kg: 9000 }, "kg");
    expect(x.progress?.bars.map((b) => [b.value, b.other])).toEqual([
      ["13,228 lb", "6,000 kg"],
      ["19,842 lb", "9,000 kg"],
    ]);
  });

  it("Wins' crew-wide total is in the crew's unit for everyone, with the other under it", () => {
    const w: WinsStats = {
      week_of: "2026-11-09", roster: 16, opened: 15, trained: 12, sessions: 36, sessions_prev: 32, prs: 41, pr_people: 9,
      volume_kg: 100_000, reps: 6015, streaks: 10, bodyweight: 9, checkins: 4, busiest_day: "Friday",
    };
    expect(CREW_UNIT).toBe("lb");
    expect(winsHero(w)).toMatchObject({ amount: "220,462", unit: "lbs", other: "100,000 kg" });
  });

  it("a film slide's set carries its weight in the other unit, never when weights are hidden", () => {
    const film = [{ path: "u/film/1.mp4", exercise: "Competition Squat", set: 1, set_name: "Top set", kg: mirrorKg(455, "lb"), label: "455 lb × 1 @ RPE 6", label_no_load: "1 rep @ RPE 6" }];
    const post = { media_path: "u/film/1.mp4", media_thumb_path: null, media_type: "video" as const, media_width: 1080, media_height: 1920, extra_media: [], film };
    expect(postSlides(post)[0].caption).toEqual({ title: "Competition Squat", detail: "Top set · 455 lb × 1 @ RPE 6", other: "206.4 kg" });
    expect(postSlides({ ...post, hide_loads: true, is_mine: false })[0].caption).toMatchObject({ detail: "Top set · 1 rep @ RPE 6", other: null });
  });
});

describe("every surface goes through it", () => {
  it("the feed cards, the workout page, stories and the Home deck show the other unit", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("{win.other && <WeightOther");
    expect(card).toContain("<WeightOther className={cn(\"mt-1 block\", big ? \"text-[15px]\" : \"text-[13px]\")}>{topSetOther(lift.detail, unit)}</WeightOther>");
    expect(card).toContain("<SubLine sub={n.sub} row={nums}");
    expect(card).toContain("<SetDetail detail={slideSet.detail} other={slideSet.other}");
    expect(card).toContain("<SetDetail detail={caption.detail} other={caption.other}");
    expect(read("src/components/community/post-detail.tsx")).toContain("dualTotal(s.tonnage_kg, recordedUnit(s.unit, unit))");
    expect(read("src/components/community/crew-stories.tsx")).toContain("{win.other && <span data-weight-other");
    expect(read("src/components/community/community-entry.tsx")).toContain("formatTopSetDual(lift.detail, unit)");
    expect(read("src/lib/story-reply.ts")).toContain("withOther(win.detail, win.other)");
  });

  it("the canvas cards draw it, and Wins / Recap pictures no longer depend on who's looking", () => {
    const share = read("src/lib/workout-share-card.ts");
    expect(share).toContain("withOther(r.detail.toUpperCase(), r.other)");
    expect(read("src/lib/instagram-cards.ts")).toContain("hero.other");
    expect(read("src/lib/post-art.ts")).toContain('new Set<IgCard>(["workout"])');
    expect(read("src/lib/workout-story-card.ts")).toContain("if (s.sub) {");
  });

  it("the recap's records read in the unit their set was typed in", () => {
    expect(read("src/components/workout-day/WorkoutDayView.tsx")).toContain("setUnit={setUnitOf}");
    expect(read("src/components/records/training-records.tsx")).toContain("recordedLoad(kg, setUnit?.(setId), unit)");
  });

  it("the database names each weight's unit without changing a record", () => {
    const sql = read("supabase/migrations/20270408090000_post_weights_recorded_unit.sql");
    expect(sql).toContain("coalesce(r.entered_unit, r.actual_load_unit) AS unit");
    expect(sql).toContain("''best_unit'', best.unit");
    expect(sql).toContain("mode() WITHIN GROUP (ORDER BY coalesce(r.entered_unit, r.actual_load_unit))");
    // derived data only: no training record is written
    expect(sql).not.toMatch(/UPDATE\s+public\.pl_row_results/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.pl_row_results/i);
    expect(sql).toContain("DELETE FROM public.community_workout_stats_cache;");
  });
});
