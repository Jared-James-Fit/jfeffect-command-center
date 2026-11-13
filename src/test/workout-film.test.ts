import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FILM_CLIP_MAX_BYTES,
  filmCaption,
  filmLabels,
  filmPaths,
  filmCaptionFor,
  filmPostCaption,
  filmUpToDate,
  isFilmPath,
  isOwnFilmCaption,
  pickFilmClips,
} from "@/lib/workout-film";
import { postSlides } from "@/lib/community";

const clip = (id: string, order: number, set: number, extra: Partial<{ duration_s: number | null; size_bytes: number | null; created_at: string }> = {}) => ({
  id,
  order,
  set_index: set,
  created_at: extra.created_at ?? "2026-11-12T10:00:00Z",
  duration_s: extra.duration_s ?? 20,
  size_bytes: extra.size_bytes ?? 5_000_000,
});

describe("which clips go on the film", () => {
  it("in the order they were trained: exercise, then set", () => {
    const { picked } = pickFilmClips([clip("b2", 2, 1), clip("a2", 1, 2), clip("a1", 1, 1)]);
    expect(picked.map((c) => c.id)).toEqual(["a1", "a2", "b2"]);
  });
  it("a clip too long or too big for a workout post stays out, and is counted", () => {
    const { picked, tooLong } = pickFilmClips([clip("ok", 1, 1), clip("long", 1, 2, { duration_s: 140 }), clip("big", 1, 3, { size_bytes: FILM_CLIP_MAX_BYTES + 1 })]);
    expect(picked.map((c) => c.id)).toEqual(["ok"]);
    expect(tooLong).toBe(2);
  });
  it("ten at most", () => {
    const many = Array.from({ length: 12 }, (_, i) => clip(`c${i}`, 1, i + 1));
    const { picked, overMax } = pickFilmClips(many);
    expect(picked).toHaveLength(10);
    expect(overMax).toBe(2);
  });
});

describe("each clip's caption", () => {
  const values = { load: 145, unit: "kg" as const, reps: 5, rpe: 8, rir: null, loadType: "external" as const, durationSec: null };
  it("the exercise, then the set and what was lifted", () => {
    const labels = filmLabels(values, null);
    expect(labels).toEqual({ label: "145 kg × 5 @ RPE 8", label_no_load: "5 reps @ RPE 8" });
    expect(filmCaption({ exercise: "Competition Squat", set: 2, ...labels }, false)).toEqual({ title: "Competition Squat", detail: "Set 2 · 145 kg × 5 @ RPE 8" });
  });
  it("a post that hides weights never shows them", () => {
    const labels = filmLabels(values, null);
    expect(filmCaption({ exercise: "Competition Squat", set: 2, ...labels }, true).detail).toBe("Set 2 · 5 reps @ RPE 8");
  });
  it("falls back to the clip's own label when the set's numbers can't be read", () => {
    expect(filmLabels(null, "100 kg × 5 @ RPE 8")).toEqual({ label: "100 kg × 5 @ RPE 8", label_no_load: "5 reps @ RPE 8" });
  });
  it("the post's caption when they haven't written one", () => {
    expect(filmPostCaption("Lower A (Squat Focus)", 3)).toBe("Lower A (Squat Focus) · 3 sets on film 🎥");
    expect(filmPostCaption(null, 1)).toBe("1 set on film 🎥");
  });
  it("ours keeps up with the clips on the post; theirs is never touched", () => {
    const t = "Thursday — Secondary Squat + Primary Bench";
    // Jared's Nov 12 film: 4 clips at first, 9 once the big ones had their 720p copies
    expect(filmCaptionFor(`${t} · 4 sets on film 🎥`, t, 9)).toBe(`${t} · 9 sets on film 🎥`);
    expect(filmCaptionFor("1 set on film 🎥", null, 3)).toBe("3 sets on film 🎥");
    expect(filmCaptionFor("", t, 2)).toBe(`${t} · 2 sets on film 🎥`);
    expect(filmCaptionFor(null, null, 1)).toBe("1 set on film 🎥");
    // their own words stay, even when they mention the film
    expect(filmCaptionFor("new bench PR 💪", t, 9)).toBe("new bench PR 💪");
    expect(filmCaptionFor("Leg day · 4 sets on film 🎥", t, 9)).toBe("Leg day · 4 sets on film 🎥");
    expect(readFileSync("src/lib/workout-film.functions.ts", "utf8")).toContain("const caption = filmCaptionFor(post?.caption,");
  });
  it("on a post's screen ours isn't said twice: the workout's own line already names it (Fionna's Nov 12 film, Nov 13 2026)", () => {
    const names = ["Glutes + Legs", "Block 3 · Week 2"];
    expect(isOwnFilmCaption("Glutes + Legs · 3 sets on film 🎥", names)).toBe(true);
    expect(isOwnFilmCaption("1 set on film 🎥", names)).toBe(true);
    // their own words, or another name, always show
    expect(isOwnFilmCaption("hip thrust PR, felt strong today", names)).toBe(false);
    expect(isOwnFilmCaption("Leg day · 4 sets on film 🎥", names)).toBe(false);
    expect(isOwnFilmCaption(null, names)).toBe(false);
    const card = readFileSync("src/components/community/post-card.tsx", "utf8");
    expect(card).toContain("!(visual && s && isOwnFilmCaption(post.caption, [s.workout_name, s.workout_title])) && (");
  });
});

describe("the film on the post", () => {
  it("copies live in the athlete's own community folder, one per set video", () => {
    expect(filmPaths("u1", "c1", "v1", "client/set-videos/v1.MOV")).toEqual({ path: "u1/film/c1/v1.mov", thumb: "u1/film/c1/v1-poster.jpg" });
    expect(isFilmPath("u1/film/c1/v1.mov")).toBe(true);
    expect(isFilmPath("u1/photo.jpg")).toBe(false);
  });
  it("is up to date only when every clip that should be on it is", () => {
    expect(filmUpToDate([{ path: "a" }, { path: "b" }], ["a", "b"])).toBe(true);
    expect(filmUpToDate([{ path: "a" }], ["a", "b"])).toBe(false);
  });
  it("every slide carries its own caption (each swipe its own), weights hidden when the post hides them", () => {
    const post = {
      media_path: "u/film/c/1.mp4", media_thumb_path: null, media_type: "video" as const, media_width: 720, media_height: 1280,
      extra_media: [{ path: "u/film/c/2.mp4", thumb: null, type: "video" as const, width: 720, height: 1280 }],
      film: [
        { path: "u/film/c/1.mp4", exercise: "Squat", set: 1, label: "140 kg × 5", label_no_load: "5 reps" },
        { path: "u/film/c/2.mp4", exercise: "Squat", set: 2, label: "145 kg × 5", label_no_load: "5 reps" },
      ],
    };
    expect(postSlides(post).map((s) => s.caption?.detail)).toEqual(["Set 1 · 140 kg × 5", "Set 2 · 145 kg × 5"]);
    expect(postSlides({ ...post, hide_loads: true }).map((s) => s.caption?.detail)).toEqual(["Set 1 · 5 reps", "Set 2 · 5 reps"]);
    expect(postSlides({ ...post, film: null })[0].caption).toBeUndefined();
  });
  it("the athlete always sees their own weights on their film", () => {
    const post = {
      media_path: "u/film/c/1.mp4", media_thumb_path: null, media_type: "video" as const, media_width: 720, media_height: 1280, extra_media: [],
      film: [{ path: "u/film/c/1.mp4", exercise: "Squat", set: 1, label: "140 kg × 5", label_no_load: "5 reps" }],
      hide_loads: true,
    };
    expect(postSlides({ ...post, is_mine: true })[0].caption?.detail).toBe("Set 1 · 140 kg × 5");
    expect(postSlides({ ...post, is_mine: false })[0].caption?.detail).toBe("Set 1 · 5 reps");
  });
});

describe("who sees it: Crew or Coach only", () => {
  const options = readFileSync("src/components/workout/shared/film-audience-options.tsx", "utf8");
  const film = readFileSync("src/components/workout/shared/workout-film.tsx", "utf8");
  const settings = readFileSync("src/components/community/privacy-settings.tsx", "utf8");
  it("is one two-way choice, in the review and in Crew settings, that says the coach gets every clip either way", () => {
    expect(options).toContain('{ key: "crew", label: "Crew", icon: Users }');
    expect(options).toContain('{ key: "coach", label: "Coach only", icon: UserRound }');
    expect(options).toContain("Stays in your coach chat. You can share it to Crew later from the workout.");
    expect(film).toContain("your coach gets every clip either way");
    expect(film).toContain('when="after your review"');
    expect(settings).toContain("Your coach gets every clip either way, in your chat.");
    expect(settings).toContain('from "@/components/workout/shared/film-audience-options"');
    expect(settings).toContain('from "@/lib/workout-film-pref"');
  });
  it("Coach only can still go to Crew later, from the workout's card and its recap", () => {
    expect(film).toMatch(/film\.autoOn === false && !film\.hidden\)[\s\S]*?Coach only[\s\S]*?<ShareButton/);
    expect(film).toContain("Share to Crew");
  });
});

describe("posting it", () => {
  const fn = readFileSync("src/lib/workout-film.functions.ts", "utf8");
  const card = readFileSync("src/components/workout/shared/completed-workout-actions.tsx", "utf8");
  const sql = readFileSync("supabase/migrations/20270307090000_workout_film.sql", "utf8");
  it("only the athlete posts their own film, and a post they took out of Crew stays out", () => {
    expect(fn).toContain('if (!client || client.user_id !== userId) throw new Error("Only you can post your film.");');
    expect(fn).toContain('if (data.auto && autoOn === false) return { status: "off", clips: 0, skipped: 0 };');
    expect(fn).toMatch(/if \(data\.auto && post && !post\.auto_shared && \(post\.archived_at \|\| !crewVisible\(post\.visibility\)\)\)/);
  });
  it("copies are recorded as checked, so the post's video guard holds them to a workout post's limits", () => {
    expect(fn).toContain('context: "workout",');
    expect(fn).toContain('.from("media_video_checks").upsert(');
  });
  it("posts by itself only after the review (where they pick), or once it was clearly skipped", () => {
    expect(card).toContain("auto={hasReview || (!!completedAt && Date.now() - Date.parse(completedAt) > FILM_REVIEW_WAIT_MS)}");
  });
  it("Crew unless they pick Coach only, and the post carries each clip's caption", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS auto_post_film boolean NOT NULL DEFAULT true");
    expect(sql).toContain("''film'', CASE WHEN jsonb_typeof(n.film) = ''array''");
  });
});
