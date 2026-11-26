/**
 * Analytics in plain words (Nov 23 2026): the muscle training map's five
 * levels, how a supporting muscle counts (half a set by default, the
 * athlete's choice), a tap's period numbers against the period before, and
 * no program-design jargon in what an athlete reads.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPPORT_CREDIT,
  MUSCLE_LEVELS,
  buildMuscleRead,
  fmtSets,
  muscleLevel,
  muscleWindowChanges,
  periodChangeWords,
} from "@/lib/analytics/muscle-read";
import type { LoadSet, MuscleLoad } from "@/lib/analytics/training-load";

const read = (p: string) => readFileSync(p, "utf8");

/** A bench set: chest is what it's aimed at, triceps helps. */
const bench = (day: string, n = 1): LoadSet[] =>
  Array.from({ length: n }, () => ({
    day,
    dayId: null,
    rowId: null,
    exerciseId: null,
    exercise: "Competition Bench",
    primary: ["chest"],
    secondary: ["triceps"],
    rowFamily: "bench",
    competitionLiftType: "bench",
    isCompetitionLift: true,
    exerciseFamily: "bench",
    dbPattern: "horizontal_press",
    category: "strength",
    countsTowardVolume: true,
    fallbackMuscle: null,
    reps: 5,
    loadKg: 100,
    rpe: 8,
    rir: null,
  })) as LoadSet[];

describe("the muscle training map's five levels", () => {
  it("are relative to the most-trained muscle, never a size, strength or growth", () => {
    expect(MUSCLE_LEVELS.map((l) => l.label)).toEqual([
      "Not trained",
      "Lightly trained",
      "Moderately trained",
      "Heavily trained",
      "Most trained",
    ]);
    expect(muscleLevel(0)).toBe(0);
    expect(muscleLevel(0.1)).toBe(1);
    expect(muscleLevel(0.45)).toBe(2);
    expect(muscleLevel(0.7)).toBe(3);
    expect(muscleLevel(1)).toBe(4);
    const map = read("src/components/analytics/muscle-map.tsx");
    expect(map).toContain("They show training, not muscle size, strength or growth.");
  });
});

describe("how a supporting muscle counts", () => {
  const sets = [...bench("2026-11-02", 6), ...bench("2026-11-09", 6), ...bench("2026-11-16", 6)];
  const muscles: MuscleLoad[] = [
    { muscle: "Chest", perWeek: 6, directPerWeek: 6, lastWeek: 6, frequency: 1, topSessionShare: 1, changePct: null },
    { muscle: "Triceps", perWeek: 3, directPerWeek: 0, lastWeek: 3, frequency: 0, topSessionShare: 1, changePct: null },
  ];
  const at = (credit: 0 | 0.5 | 1) =>
    buildMuscleRead({
      muscles,
      sets,
      weeks: 3,
      partial: false,
      profile: "powerlifting",
      start: "2026-11-02",
      end: "2026-11-22",
      coached: false,
      supportCredit: credit,
    }).rows.find((r) => r.muscle === "Triceps")!;
  it("is half a set by default, with direct and supporting sets kept apart", () => {
    expect(DEFAULT_SUPPORT_CREDIT).toBe(0.5);
    const t = at(0.5);
    expect(t.period).toMatchObject({ total: 9, direct: 0, supporting: 18, days: 3, exerciseCount: 1 });
    expect(t.perWeek).toBe(3);
  });
  it("follows the athlete's choice everywhere: the totals, the weekly number and the colour", () => {
    expect(at(1).period.total).toBe(18);
    expect(at(1).perWeek).toBe(6);
    const none = at(0);
    expect(none.period.total).toBe(0);
    expect(none.perWeek).toBe(0);
    expect(none.level).toBe(0);
    expect(none.period.days).toBe(0);
  });
  it("the setting explains itself with the bench-and-triceps example and lives in a small menu", () => {
    const map = read("src/components/analytics/muscle-map.tsx");
    expect(map).toContain("How supporting muscles are counted");
    expect(map).toContain("For example, bench press mainly trains your");
    expect(map).toContain("We count supporting muscles as half a set by default.");
    expect(map).toContain("data-muscle-settings");
    const dash = read("src/components/analytics/client-analytics-dashboard.tsx");
    expect(dash).toContain('title="Muscle training map"');
    expect(map).toContain("data-muscle-overview");
    expect(map).toContain("data-muscle-metric-select");
    expect(dash).toContain("data-analytics-section-select");
    expect(dash).toContain("supportCredit,");
  });
});

describe("a muscle against the period before", () => {
  it("compares the same number of days just before the period, counted the same way", () => {
    const sets = [...bench("2026-10-20", 4), ...bench("2026-11-03", 6)];
    const r = buildMuscleRead({
      muscles: [],
      sets: bench("2026-11-03", 6),
      history: sets,
      weeks: 2,
      partial: false,
      profile: "powerlifting",
      start: "2026-11-02",
      end: "2026-11-15",
      coached: false,
    }).rows.find((x) => x.muscle === "Chest")!;
    expect(r.period.before).toMatchObject({ total: 4, start: "2026-10-19", end: "2026-11-01" });
    expect(r.period.changePct).toBe(50);
    expect(periodChangeWords(r.period, "Oct 19 – Nov 1")).toBe(
      "Up 50% from Oct 19 – Nov 1 (4 → 6 sets).",
    );
  });
  it("says so when there's nothing earlier, and reads a half set as a half", () => {
    const r = buildMuscleRead({
      muscles: [],
      sets: bench("2026-11-03", 2),
      weeks: 2,
      partial: false,
      profile: "powerlifting",
      start: "2026-11-02",
      end: "2026-11-15",
      coached: false,
    }).rows.find((x) => x.muscle === "Chest")!;
    expect(r.period.before).toBeNull();
    expect(periodChangeWords(r.period)).toBeNull();
    expect(fmtSets(9)).toBe("9");
    expect(fmtSets(4.5)).toBe("4.5");
  });
  it("Cleo's six-week window reads the same counts", () => {
    const out = muscleWindowChanges({
      sets: [...bench("2026-10-01", 10), ...bench("2026-11-10", 15)],
      start: "2026-10-12",
      end: "2026-11-22",
      profile: "physique",
    });
    expect(out.find((m) => m.muscle === "Chest")).toMatchObject({
      total: 15,
      before: 10,
      changePct: 50,
      role: "prime",
    });
  });
});

describe("plain words on every athlete screen", () => {
  const files = [
    "src/components/analytics/client-analytics-dashboard.tsx",
    "src/components/analytics/muscle-map.tsx",
    "src/components/analytics/sbd-workload-chart.tsx",
    "src/components/analytics/strength-trend-chart.tsx",
    "src/components/analytics/performance-calendar.tsx",
    "src/components/analytics/records-view.tsx",
    "src/components/analytics/sbd-donut.tsx",
    "src/components/analytics/block-comparison-card.tsx",
    "src/components/analytics/overview-pieces.tsx",
    "src/components/performance-card.tsx",
  ];
  it("no e1RM, tonnage, per-week shorthand or the old muscle-map labels", () => {
    for (const f of files) {
      const src = read(f);
      // what an athlete reads: JSX text and string literals, not identifiers
      const text = [...src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g), ...src.matchAll(/"([^"\n]*[a-z] [^"\n]*)"/g)]
        .map((m) => m[1])
        .join("\n");
      expect(text, f).not.toMatch(/\be1RM\b|\bTonnage\b|sets\/wk|\/wk\b/);
      expect(text, f).not.toMatch(/Training each muscle got|Secondary muscles count as|vs your most-trained/);
    }
  });
  it("a change is a sentence with what it's measured against", () => {
    const chart = read("src/components/analytics/strength-trend-chart.tsx");
    expect(chart).toContain("data-strength-sentence");
    expect(chart).toContain("since {fmtDay(trend.from.day)} ({r(trend.from.value)} → {r(trend.to.value)} {unit}).");
  });
  it("an ⓘ is a bottom sheet on a phone and a popover on a computer, with a comfortable tap", () => {
    const tip = read("src/components/analytics/info-tip.tsx");
    expect(tip).toContain('side="bottom"');
    expect(tip).toContain("swipeToClose");
    expect(tip).toContain("h-8 w-8");
    expect(read("src/components/analytics/viz.tsx")).toContain("info?: ReactNode;");
  });
  it("Cleo says whether a finding is counted or estimated, in the athlete's words", () => {
    const card = read("src/components/analytics/overview-pieces.tsx");
    expect(card).toContain("Estimated from your workouts");
    expect(card).toContain("Counted from your workouts");
    const load = read("src/lib/analytics/training-load.ts");
    expect(load).toContain("athlete: {");
    const obs = read("src/lib/analytics/performance-observation.ts");
    expect(obs).toContain("i.insight.athlete?.observation ?? i.insight.observation");
  });
});
