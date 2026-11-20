import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultStoryLook,
  fitStoryFrame,
  storyLookLabel,
  storyLookOrder,
  storyLooks,
} from "@/lib/quick-story";
import { buildShareCardFields, type WorkoutShareStats } from "@/lib/community";
import { explainWorkoutScore } from "@/lib/workout-summary";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 18 2026: finishing a workout posted a story by itself (144 in 30 days,
 * seen by 0.9 people each) while the recap offered Share to Crew under "On
 * your story for 24 hours", and nobody had made a story by hand in 60 days.
 * Now the recap paints the story for them and it goes up only on Share to
 * Story; the Crew post is the full studio.
 */
describe("the quick story opens on the look that fits the workout", () => {
  const all = ["pr", "photo", "progress", "stats", "volume", "plain"] as const;
  it("a PR leads with the record, whatever look they used last", () => {
    expect(defaultStoryLook([...all], { isPr: true, liftLoaded: true }, "volume")).toBe("pr");
  });
  it("else the look they shared in last time, when this workout has it", () => {
    expect(defaultStoryLook([...all], { isPr: false, liftLoaded: true }, "volume")).toBe("volume");
    // a look this workout can't fill is never used
    expect(defaultStoryLook(["photo", "stats"], { isPr: false, liftLoaded: true }, "volume")).toBe(
      "stats",
    );
  });
  it("else a strength day's summary of its lifts, and the clean card for a run or bodyweight work", () => {
    expect(defaultStoryLook([...all], { isPr: false, liftLoaded: true }, null)).toBe("stats");
    expect(defaultStoryLook(["photo", "plain"], { isPr: false, liftLoaded: false }, null)).toBe(
      "photo",
    );
    expect(defaultStoryLook([], { isPr: false, liftLoaded: false }, null)).toBeNull();
  });
  it("offers 'No filter' only with a photo, never the transparent sticker; the row keeps its order", () => {
    expect(storyLooks(["pr", "photo", "sticker", "plain"], false)).toEqual(["pr", "photo"]);
    expect(storyLooks(["pr", "photo", "sticker", "plain"], true)).toEqual(["pr", "photo", "plain"]);
    expect(storyLookOrder(["photo", "stats", "volume"], "stats")).toEqual([
      "stats",
      "photo",
      "volume",
    ]);
    expect(storyLookLabel("photo", false)).toBe("Clean");
    expect(storyLookLabel("photo", true)).toBe("Photo");
    expect(storyLookLabel("stats", false)).toBe("Summary");
  });
  it("the editor shows it as big as 9:16 fits", () => {
    expect(fitStoryFrame({ w: 375, h: 500 })).toEqual({ w: 281, h: 500 });
    expect(fitStoryFrame({ w: 200, h: 900 })).toEqual({ w: 200, h: 355 });
  });
});

describe("a story goes up only when they share it", () => {
  const quick = read("src/components/community/quick-story.tsx");
  const recap = read("src/components/community/recap-post.tsx");
  const sql = read("supabase/migrations/20270407090000_workout_story_explicit.sql");
  it("finishing no longer posts one by itself: off unless switched on, everyone moved off the untouched default", () => {
    expect(sql).toContain(
      "ALTER TABLE public.community_profiles ALTER COLUMN auto_share_workouts SET DEFAULT false;",
    );
    expect(sql).toContain(
      "UPDATE public.community_profiles SET auto_share_workouts = false WHERE auto_share_workouts;",
    );
    expect(sql).toContain(
      "INSERT INTO public.community_profiles (user_id, auto_share_workouts) VALUES (uid, coalesce(_on, false))",
    );
    expect(sql).toContain(
      "'auto_share_workouts', coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = auth.uid()), false),",
    );
    // stories already posted are left alone
    expect(sql).not.toMatch(/DELETE FROM public\.community_posts|UPDATE public\.community_posts/);
    expect(read("src/lib/community.queries.ts")).toContain(
      "return (data ?? { auto_share_workouts: false, private_views: false }) as MyCommunitySettings;",
    );
  });
  it("it's a story-only post (24h, never the feed), the same picture the editor shows, one at a time", () => {
    expect(quick).toContain(
      "createCommunityPost(qc, { userId: user.id, caption: caption.trim(), visibility: audience, photo: file, story: true })",
    );
    expect(quick).toContain("paintShareCard(canvas, card, logo, opts.scale);");
    expect(quick).toContain("if (!paint(c, { scale: 1 })) throw new Error");
    expect(quick).toContain("if (busyRef.current || !data || !look) return null;");
    // closing the editor never posts
    expect(quick).toContain('aria-label="Close without sharing"');
    expect(quick).toContain("Nothing posts until you tap Share.");
  });
  it("one Add photo with the phone's own choices; a photo stays on the phone until Share; a video is a Crew post", () => {
    expect(quick).toContain('accept="image/*" capture="environment"');
    expect(quick).toContain('label="Take photo"');
    expect(quick).toContain('label="Post a video instead"');
    expect(quick).toContain('sub="Videos go on a Crew post"');
    expect(quick).toContain("const url = URL.createObjectURL(file);");
    // no upload on pick: the only upload is the story itself
    expect(quick.match(/createCommunityPost\(/g)?.length).toBe(1);
    expect(quick).not.toContain("uploadPicked");
    expect(quick).not.toContain("useEarlyUpload");
  });
  it("the recap's footer: the story row, then Create Crew Post and Done", () => {
    expect(recap).toContain('"Share to Story"');
    expect(recap).toContain('{inFeed ? "Edit Crew post" : "Create Crew Post"}');
    expect(recap.indexOf("data-recap-story=")).toBeLessThan(recap.indexOf("data-recap-crew-post"));
  });
});

describe("share cards say both units and never cut a lift's name", () => {
  const stats = {
    completion_id: "c",
    completed_at: "2026-11-18T18:00:00Z",
    workout_title: "Block 2 · Week 3",
    workout_name: null,
    duration_min: 62,
    working_sets: 14,
    tonnage_kg: 9000,
    pr_count: 0,
    prs: [],
    top_lift: { exercise_name: "Competition Squat", reps: 1, load_kg: 206.384 },
    month_sessions: 9,
    week_sessions: 2,
    exercises: [
      { name: "Competition Squat", sets: 3, best_load_kg: 206.384, best_reps: 1, pr: null },
      { name: "Plank", sets: 2, best_load_kg: null, best_reps: null, max_seconds: 60, pr: null },
    ],
  } as unknown as WorkoutShareStats;
  it("the featured lift and each loaded exercise carry the other unit, smaller; a hold carries none", () => {
    const f = buildShareCardFields({
      stats,
      unit: "lb",
      athleteName: "Jared",
      workoutTitle: "x",
      dateLabel: null,
    });
    // the other unit to one decimal from the stored kg (dual-weight.ts), never plate-rounded
    expect(f.lift).toMatchObject({ detail: "455 lb × 1", alt: "206.4 kg" });
    expect(f.exercises[0]).toMatchObject({ detail: "455 lb × 1", alt: "206.4 kg" });
    expect(f.exercises[1].alt).toBeNull();
    const kg = buildShareCardFields({
      stats,
      unit: "kg",
      athleteName: null,
      workoutTitle: "x",
      dateLabel: null,
    });
    // these sets never said their unit, so they fall back to the viewer's
    expect(kg.lift).toMatchObject({ detail: "206.5 kg × 1", alt: "455 lb" });
    // a set that says it was typed in lb reads in lb for a kg viewer too
    const typed = { ...stats, top_lift: { exercise_name: "Competition Squat", reps: 1, load_kg: 206.3845, unit: "lb" } } as WorkoutShareStats;
    expect(buildShareCardFields({ stats: typed, unit: "kg", athleteName: null, workoutTitle: "x", dateLabel: null }).lift).toMatchObject({ detail: "455 lb × 1", alt: "206.4 kg" });
  });
  it("the painter wraps a long name to two lines and puts the other unit under the load", () => {
    const card = read("src/lib/workout-share-card.ts");
    expect(card).toContain("const lines = wrapLines(ctx, r.name, Math.max(120, nameMax), 2);");
    expect(card).toContain("ctx.fillText(r.alt, W - PAD, ry + 104);");
    expect(card).toContain('const alt = detail ? (lift?.alt ?? "").trim() : "";');
    expect(card).toContain("if (liftAlt && dw + altW <= innerW) {");
  });
});

describe("the recap explains its score without changing it", () => {
  it("the share of planned sets, pain and a note, and what the stars are", () => {
    const s = { score: 93, completedSets: 14, prescribedSets: 15, completionPct: 93 };
    expect(explainWorkoutScore(s)).toEqual([
      "Sets logged: 14 of 15 planned (93%). That's the score.",
      "Reporting pain takes 10 off.",
      "A note for your coach adds 3. Weights and effort don't change it: it's how much of the plan got done.",
      "Stars: the score out of 5.",
    ]);
    expect(explainWorkoutScore(s, { pain: true, ownRating: 4 })[1]).toBe("Pain reported: 10 off.");
    expect(explainWorkoutScore(s, { ownRating: 4 })[3]).toBe(
      "Stars: the score out of 5, or your own rating when it's higher.",
    );
    // the formula itself is untouched
    const src = read("src/lib/workout-summary.ts");
    expect(src).toContain("if (opts.hasPain) score -= 10;");
    expect(src).toContain("if (opts.hasNote) score += 3;");
  });
  it("the milestone is one line each", () => {
    const m = read("src/components/portal/new-achievement-reveal.tsx");
    expect(m).toContain('<BadgeIcon icon={b.icon_key} rarity={b.rarity} size="sm" />');
    expect(m).not.toContain("border-2 border-primary/40");
  });
});
