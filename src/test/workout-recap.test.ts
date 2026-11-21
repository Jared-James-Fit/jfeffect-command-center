import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RECAP_MAX_LIFTS,
  exerciseSetRows,
  recapDay,
  recapExercises,
  recapIndex,
  recapKeyLifts,
  recapMeta,
  recapMoreLabel,
  recapPr,
  splitBestSet,
  setLoad,
  setText,
  summaryStats,
  workoutTotals,
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
});

describe("the recap's last row", () => {
  it("says how many exercises the sheet has when some aren't on the recap, else that every set is there", () => {
    expect(recapMoreLabel(9, 4)).toBe("All 9 exercises");
    expect(recapMoreLabel(3, 3)).toBe("Every set");
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

const ex = (name: string, over: Partial<CommunityExercise> = {}): CommunityExercise => ({
  name,
  sets: 3,
  best_load_kg: 100,
  best_reps: 5,
  best_unit: "lb",
  max_reps: 5,
  max_seconds: null,
  pr: null,
  ...over,
});

describe("the compact recap (Nov 21 2026)", () => {
  it("says how long and how many sets in one line (the day is the post's own), leaving out what isn't there", () => {
    expect(recapMeta(stats())).toBe("1h 12m · 18 sets");
    expect(recapMeta(stats({ duration_min: null, working_sets: 1 }))).toBe("1 set");
  });

  it("splits a best set into the load (the big number) and its reps", () => {
    expect(splitBestSet("455 lb × 1")).toEqual({ big: "455 lb", small: "× 1" });
    expect(splitBestSet("BW + 20 kg × 8")).toEqual({ big: "BW + 20 kg", small: "× 8" });
    expect(splitBestSet("12 reps")).toEqual({ big: "12 reps", small: null });
    expect(splitBestSet("1:15")).toEqual({ big: "1:15", small: null });
  });

  it("shows at most four key lifts, in training order, the headline PR and any record always making the cut", () => {
    const list = [
      ex("Competition Squat", { pr: "atpr", best_reps: 1 }),
      ex("Competition Bench"),
      ex("Pause Squat"),
      ex("Close Grip Bench"),
      ex("Cable Row"),
      ex("Leg Extension", { pr: "atpr", best_reps: 15 }),
    ];
    expect(RECAP_MAX_LIFTS).toBe(4);
    const four = recapKeyLifts(list, stats());
    expect(four.map((l) => l.exercise.name)).toEqual([
      "Competition Squat",
      "Competition Bench",
      "Pause Squat",
      "Leg Extension",
    ]);
    expect(four.map((l) => l.index)).toEqual([0, 1, 2, 5]);
    // two rows of room: the headline PR, then the other record
    expect(recapKeyLifts(list, stats(), 2).map((l) => l.exercise.name)).toEqual([
      "Competition Squat",
      "Leg Extension",
    ]);
    expect(recapKeyLifts([], stats())).toEqual([]);
  });

  it("says the headline PR loud and any other record quietly, never a PR an exercise doesn't have", () => {
    expect(recapPr(ex("Competition Squat", { pr: "atpr" }), stats())).toEqual({
      label: "All-time PR",
      loud: true,
    });
    // an accessory's 15-rep best is real, it just never headlines
    expect(recapPr(ex("Leg Extension", { pr: "atpr" }), stats())).toEqual({
      label: "All-time PR",
      loud: false,
    });
    expect(recapPr(ex("Belt Squat", { pr: "block_pr" }), stats())).toEqual({
      label: "Block PR",
      loud: false,
    });
    expect(recapPr(ex("Competition Bench"), stats())).toBeNull();
    // Jared's Nov 16 workout: a 12-rep belt squat all-time PR, no headline (a rep-out)
    expect(
      recapPr(
        ex("Belt Squat", { pr: "atpr" }),
        stats({
          prs: [
            { exercise_name: "Belt Squat", reps: 12, load_kg: 115.67, unit: "lb", scope: "atpr" },
          ],
        }),
      ),
    ).toEqual({ label: "All-time PR", loud: false });
  });
});

describe("every set, in the post's sheet (Nov 21 2026)", () => {
  it("reads a set's weight as typed with the other unit, bodyweight and assisted as such, nothing for a hidden weight", () => {
    expect(setLoad({ v: 455, u: "lb", kg: 206.3845 }, "kg")).toEqual({
      main: "455 lb",
      other: "206.4 kg",
    });
    expect(setLoad({ v: 72.5, u: "lb", kg: 32.885 }, "kg")).toEqual({
      main: "72.5 lb",
      other: "32.9 kg",
    });
    expect(setLoad({ v: 20, u: "kg", kg: 20, lt: "bodyweight" }, "lb")).toEqual({
      main: "BW + 20 kg",
      other: "44.1 lb",
    });
    expect(setLoad({ v: 0, u: "kg", kg: 0, lt: "bodyweight" }, "lb")).toBeNull();
    expect(setLoad({ v: 20, u: "lb", kg: 9.0718, lt: "assisted" }, "lb")).toEqual({
      main: "−20 lb",
      other: "−9.1 kg",
    });
    // a post that hides its weights sends neither the number nor the kg
    expect(setLoad({ u: "lb", reps: 5 }, "lb")).toBeNull();
    // no unit said: the kg mirror in the viewer's unit
    expect(setLoad({ kg: 100 }, "kg")).toEqual({ main: "100 kg", other: "220.5 lb" });
  });

  it("writes a set as weight × reps, reps alone, BW × reps or a time, its RPE apart", () => {
    expect(setText({ v: 455, u: "lb", kg: 206.3845, reps: 1, rpe: 6 }, "lb")).toEqual({
      main: "455 lb × 1",
      other: "206.4 kg",
      rpe: "@ 6",
    });
    expect(setText({ u: "lb", reps: 5, rpe: 7.5 }, "lb")).toEqual({
      main: "5 reps",
      other: null,
      rpe: "@ 7.5",
    });
    expect(setText({ v: 0, kg: 0, reps: 12, lt: "bodyweight" }, "lb")).toEqual({
      main: "BW × 12",
      other: null,
      rpe: null,
    });
    expect(setText({ secs: 75 }, "lb")).toEqual({ main: "1:15", other: null, rpe: null });
    expect(setText({ v: 20, u: "kg", kg: 20, secs: 45 }, "lb")).toEqual({
      main: "20 kg · 0:45",
      other: "44.1 lb",
      rpe: null,
    });
  });

  it("says identical sets in a row once with their numbers, so a top set and its back-offs read apart", () => {
    const squat = ex("Competition Squat", {
      set_list: [
        { v: 455, u: "lb", kg: 206.3845, reps: 1, rpe: 6 },
        { v: 375, u: "lb", kg: 170.0971, reps: 4, rpe: 6 },
        { v: 375, u: "lb", kg: 170.0971, reps: 4, rpe: 6 },
        { v: 375, u: "lb", kg: 170.0971, reps: 4, rpe: 6 },
        { v: 375, u: "lb", kg: 170.0971, reps: 4, rpe: 7 },
      ],
    });
    expect(exerciseSetRows(squat, "lb").map((r) => [r.label, r.count, r.main, r.rpe])).toEqual([
      ["1", 1, "455 lb × 1", "@ 6"],
      ["2–4", 3, "375 lb × 4", "@ 6"],
      ["5", 1, "375 lb × 4", "@ 7"],
    ]);
    // an older read with no sets: nothing to list (the best set stands in)
    expect(exerciseSetRows(ex("Row"), "lb")).toEqual([]);
  });

  it("opens with how many exercises and the volume, in the unit it was typed in with the other apart", () => {
    expect(workoutTotals(stats(), 6, "kg")).toEqual({
      text: "6 exercises · 17,902 lb lifted",
      other: "8,120 kg",
    });
    expect(workoutTotals(stats({ tonnage_kg: 0 }), 1, "kg")).toEqual({
      text: "1 exercise",
      other: null,
    });
  });
});

describe("the post's screen wiring (Nov 20 2026, Nov 21 2026)", () => {
  const card = readFileSync(
    new URL("../components/community/post-card.tsx", import.meta.url),
    "utf8",
  );
  const sheet = readFileSync(
    new URL("../components/community/reactors-sheet.tsx", import.meta.url),
    "utf8",
  );
  const recap = readFileSync(
    new URL("../components/community/workout-recap.tsx", import.meta.url),
    "utf8",
  );
  const postSheet = readFileSync(
    new URL("../components/community/post-sheet.tsx", import.meta.url),
    "utf8",
  );
  const screen = readFileSync(
    new URL("../components/community/community-screen.tsx", import.meta.url),
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

  it("is a glance, never the whole workout: no numbers grid, no eyebrow, no month chip, no big button", () => {
    expect(recap).not.toContain("data-recap-stats");
    expect(recap).not.toContain("data-recap-eyebrow");
    expect(recap).not.toContain("data-recap-highlights");
    expect(recap).not.toContain("Best set");
    expect(recap).toContain("data-recap-meta");
    expect(recap).toContain("recapKeyLifts(exercises, s, feature ? FEATURE_MAX : cap)");
    // the whole slide, edge to edge like a clip, never a card floating in it (Nov 21 2026)
    expect(recap).toContain('className="absolute inset-0 bg-card text-foreground"');
    expect(recap).not.toContain("rounded-2xl");
    expect(recap).not.toContain("max-w-[420px]");
    // between Crew's bar and the post's words, clear of the buttons down the right
    expect(recap).toContain('top: "calc(var(--feed-bar-room) + 0.75rem)"');
    expect(recap).toContain('bottom: "calc(var(--feed-words-room, 0px) + 0.25rem)"');
    // one unit on the slide (as typed); both are in the sheet
    expect(recap).not.toContain("best.other");
  });

  it("opens every set in the post's sheet over the post (its Workout tab), never a page, from a tap on the card or its last row", () => {
    expect(card).toContain(
      "const openSets = () => (onOpenWorkout ? onOpenWorkout(post) : onOpen(post));",
    );
    expect(card).toContain("onOpenWorkout={openSets}");
    expect(card).toContain('closest?.("[data-recap-card]")');
    expect(screen).toContain(
      'const openWorkoutSheet = useCallback((p: CommunityPost) => setSheet({ post: p, at: "workout" }), []);',
    );
    expect(screen).toContain("onOpenWorkout={openWorkoutSheet}");
    expect(postSheet).toContain('export type PostSheetAt = "caption" | "comments" | "workout";');
    expect(postSheet).toContain("<WorkoutDetails post={item.post} unit={unit} />");
    // both tabs stay mounted: a half-typed comment survives a look at the sets
    expect(postSheet).toContain('!onWorkout && "hidden"');
    expect(postSheet).toContain('onWorkout && "hidden"');
  });

  it("has no workout chip in the words: the counter and the swipe are the way to the recap", () => {
    expect(card).not.toContain("data-page-workout\n");
    expect(card).not.toContain("data-page-prs");
    expect(card).toContain("data-page-workout-context data-page-set");
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

describe("a clip a little taller than the room fills its width (Nov 21 2026)", () => {
  it("zooms a 3:4 set video to the room's width, giving up at most 15% of its height, never its sides", async () => {
    const { CLIP_ZOOM_MAX_TRIM, photoZoomBox } = await import("@/lib/photo-frame");
    expect(CLIP_ZOOM_MAX_TRIM).toBe(0.15);
    const box = photoZoomBox(3 / 4, 0.5, CLIP_ZOOM_MAX_TRIM)!;
    expect(box.width).toBe("min(100cqw, calc(100cqh * 0.75 / 0.85))");
    expect(box.top).toBe("calc((100cqh - min(calc(100cqw / 0.75), calc(100cqh / 0.85))) * 0.5)");
    const video = readFileSync(
      new URL("../components/community/inline-video.tsx", import.meta.url),
      "utf8",
    );
    // only a clip shown whole between the bars, never one framed in the studio (its frame is its own)
    expect(video).toContain(
      "const zoom = between && !frame ? photoZoomBox(media, focusY, CLIP_ZOOM_MAX_TRIM) : null;",
    );
    expect(video).toContain('data-clip-fit="zoom"');
  });
});
