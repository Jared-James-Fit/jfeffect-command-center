import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  recapButtonLabel,
  recapDay,
  recapExercises,
  recapFit,
  recapHighlights,
  recapIndex,
  shortStatLabel,
  summaryStats,
} from "@/lib/workout-recap";
import type { CommunityExercise, WorkoutShareStats } from "@/lib/community";

const stats = (over: Partial<WorkoutShareStats> = {}): WorkoutShareStats => ({
  workout_title: "Block 2 · Week 4",
  workout_name: "Primary Squat + Bench",
  phase: "Strength",
  completed_at: "2026-11-19T18:30:00Z",
  duration_min: 72,
  working_sets: 18,
  tonnage_kg: 8120,
  top_lift: { exercise_name: "Competition Squat", reps: 1, load_kg: 206.38, unit: "lb" },
  pr_count: 2,
  prs: [
    { exercise_name: "Competition Squat", reps: 1, load_kg: 206.38, unit: "lb", scope: "atpr" },
    { exercise_name: "Leg Extension", reps: 15, load_kg: 40, unit: "lb", scope: "atpr" },
  ],
  unit: "lb",
  month_sessions: 9,
  ...over,
});

describe("summaryStats", () => {
  it("is the workout's numbers once each, the volume in the unit it was typed in with the other under it", () => {
    expect(summaryStats(stats(), "kg")).toEqual([
      { label: "Time", value: "1h 12m" },
      { label: "Working sets", value: "18" },
      { label: "Volume", value: "17,902 lb", sub: "8,120 kg" },
      { label: "PRs", value: "2", pr: true },
    ]);
  });

  it("leaves out what a workout doesn't have, never a 0", () => {
    expect(
      summaryStats(
        stats({ duration_min: null, tonnage_kg: 0, pr_count: 0, working_sets: 1 }),
        "kg",
      ),
    ).toEqual([{ label: "Working set", value: "1" }]);
  });

  it("says Sets on the recap", () => {
    expect(shortStatLabel("Working sets")).toBe("Sets");
    expect(shortStatLabel("Working set")).toBe("Sets");
    expect(shortStatLabel("Volume")).toBe("Volume");
  });
});

describe("recapHighlights", () => {
  it("names only the headline PR (an accessory's 15-rep best is on its own row) and the workout of the month", () => {
    expect(recapHighlights(stats())).toEqual([
      { kind: "pr", text: "All-time PR · Competition Squat" },
      { kind: "month", text: "9th workout this month" },
    ]);
  });

  it("has nothing to say for an ordinary first workout of the month with no records", () => {
    expect(recapHighlights(stats({ prs: [], pr_count: 0, month_sessions: 0 }))).toEqual([]);
  });
});

describe("recapFit", () => {
  it("shows the rows that fit whole, never half of one, and counts the rest", () => {
    expect(recapFit(48 * 4 + 20, 48, 9)).toEqual({ shown: 4, hidden: 5 });
    expect(recapFit(48 * 9, 48, 9)).toEqual({ shown: 9, hidden: 0 });
  });

  it("always shows one row, and everything before it's been measured", () => {
    expect(recapFit(10, 48, 6)).toEqual({ shown: 1, hidden: 5 });
    expect(recapFit(0, 48, 6)).toEqual({ shown: 6, hidden: 0 });
    expect(recapFit(300, 48, 0)).toEqual({ shown: 0, hidden: 0 });
  });

  it("says how many exercises the full workout has when some didn't fit", () => {
    expect(recapButtonLabel(9, 5)).toBe("All 9 exercises");
    expect(recapButtonLabel(4, 0)).toBe("Full workout");
  });
});

describe("the recap's place and contents", () => {
  it("is the slide right after the post's own photos and clips", () => {
    expect(recapIndex(0)).toBe(0);
    expect(recapIndex(1)).toBe(1);
    expect(recapIndex(4)).toBe(4);
  });

  it("lists every exercise with something done, in the order trained", () => {
    const e = (name: string, sets: number): CommunityExercise => ({
      name,
      sets,
      best_load_kg: null,
      best_reps: null,
      max_reps: null,
      max_seconds: null,
      pr: null,
    });
    expect(
      recapExercises(
        [e("Squat", 4), e("Nothing", 0), e("Plank", 0)].map((x, i) =>
          i === 2 ? { ...x, max_seconds: 60 } : x,
        ),
      ).map((x) => x.name),
    ).toEqual(["Squat", "Plank"]);
    expect(recapExercises(undefined)).toEqual([]);
  });

  it("dates it by the day it was trained", () => {
    expect(recapDay("2026-11-19T18:30:00Z")).toMatch(/^Thu, Nov 19$/);
    expect(recapDay("nope")).toBeNull();
    expect(recapDay(null)).toBeNull();
  });
});

describe("the post's screen wiring (Nov 20 2026)", () => {
  const card = readFileSync(
    new URL("../components/community/post-card.tsx", import.meta.url),
    "utf8",
  );
  const sheet = readFileSync(
    new URL("../components/community/reactors-sheet.tsx", import.meta.url),
    "utf8",
  );

  it("puts the recap after a workout's media, and after its card when it has none", () => {
    expect(card).toContain("pageTrail={recapSlide}");
    expect(card).toContain("<WorkoutCoverCard post={post} onRecap={toRecap}>");
    // a Pulse or a coach's note never gets one
    expect(card).toContain(
      'const recapOn = layout === "page" && !!s && !post.auto && post.kind !== "note";',
    );
  });

  it("never sends a tap on the workout card off to another page", () => {
    expect(card).not.toContain("[data-workout-open]");
    expect(card).not.toContain("WorkoutOpenCard");
    // the words' workout chip slides to the recap, the same as a swipe
    expect(card).toMatch(/onClick=\{toRecap\}[\s\S]{0,600}data-page-workout/);
  });

  it("shows who liked it on the post's screen, opening the Likes from the line and the heart's number alike", () => {
    expect(card).toContain(
      '<LikedBy post={post} onOpen={() => setLikesOpen(true)} variant="page" />',
    );
    expect(card).toContain("onOpenLikes={() => setLikesOpen(true)}");
    expect(card).toContain("<ReactorsSheet postId={likesOpen ? post.id : null}");
    // the count is never the part cut off a long "Liked by"
    expect(sheet).toContain("/^(.*?)( and \\d[\\d,]* others?)$/");
  });
});
