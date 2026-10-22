import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { autoPostHasArt, extraBirthday, isAutoPost, type CommunityPost } from "@/lib/community";
import { postArtCard } from "@/lib/instagram-export";
import { splitHeadline, wordsCardText } from "@/lib/instagram-cards";
import { POST_ART_VERSION, loadPostArt, peekPostArt, postArtAlt, postArtKey, resetPostArt } from "@/lib/post-art";
import { PICTURE_CAPTION_LIMITS } from "@/components/community/note-caption";

const read = (f: string) => readFileSync(f, "utf8");
const jared = { user_id: "j", name: "Jared McIntyre", avatar_url: null, is_coach: true };
const nicole = { user_id: "n", name: "Nicole", avatar_url: null, is_coach: false };
const post = (x: Partial<CommunityPost> & Record<string, unknown> = {}) =>
  ({ id: "p1", created_at: "2026-10-22T17:00:00Z", kind: "note", is_mine: false, author: jared, caption: "hi", media_path: null, media_thumb_path: null, media_type: null, media_width: null, media_height: null, stats: null, mentions: [], ...x }) as unknown as CommunityPost;
const wins = { week_of: "2026-10-12", roster: 16, opened: 15, trained: 12, sessions: 36, sessions_prev: 32, prs: 68, pr_people: 9, volume_kg: 204215, reps: 6015, streaks: 10, bodyweight: 9, checkins: 4, busiest_day: "Friday" };
const recap = { ...wins, kind: "recap", planned: 43, planned_done: 35, hit: 7, active: 12, days: [8, 3, 5, 4, 9, 3, 4], completed: 36, fully_logged: 25, top: [], improve: null };
const lessonExtra = { track: "fix", title: "Hips shooting up before the bar moves", visual: { kind: "deadlift_start", fault: "hips_low" } };

describe("which posts are automated, and what picture each gets", () => {
  it("the series, lessons, holidays and birthday posts are automated; a coach's own note, a workout, a photo or a story aren't", () => {
    expect(isAutoPost(post({ series: "wednesday_wins" }))).toBe(true);
    expect(isAutoPost(post({ series: "lesson" }))).toBe(true);
    expect(isAutoPost(post({ series: "holiday" }))).toBe(true);
    expect(isAutoPost(post({ series_data: { birthday: { name: "Amanda", user_id: "a" } } as never }))).toBe(true);
    expect(isAutoPost(post())).toBe(false);
    expect(isAutoPost(post({ kind: "workout", author: nicole }))).toBe(false);
    expect(isAutoPost(post({ series: "wednesday_wins", story: true }))).toBe(false);
  });
  it("whose birthday it is comes from the server's stamp, only on a post with no series", () => {
    expect(extraBirthday(post({ series_data: { birthday: { name: "Amanda", user_id: "a" } } as never }))).toEqual({ name: "Amanda", user_id: "a" });
    expect(extraBirthday(post({ series: "lesson", series_data: { birthday: { name: "x" } } as never }))).toBeNull();
    expect(extraBirthday(post({ series_data: wins as never }))).toBeNull();
    expect(extraBirthday(post())).toBeNull();
  });
  it("each kind gets its card; a photo the coach put on it is the picture (a lesson keeps its card first)", () => {
    expect(postArtCard(post({ series: "wednesday_wins", series_data: wins as never }))).toBe("wins");
    expect(postArtCard(post({ series: "wednesday_wins" }))).toBe("words");
    expect(postArtCard(post({ series: "sunday_recap", series_data: recap as never }))).toBe("recap");
    expect(postArtCard(post({ series: "tuesday_tips", series_extra: { observation: "frequency", habit: "sessions", outcome: "prs", a: 4, b: 7, x: 21, y: 10 } as never }))).toBe("compare");
    expect(postArtCard(post({ series: "tuesday_tips", series_extra: { kind: "cue" } as never }))).toBe("words");
    expect(postArtCard(post({ series: "try_it_thursday", series_extra: { feature: "bodyweight", title: "Log your bodyweight", where: ["Home"] } as never }))).toBe("feature");
    expect(postArtCard(post({ series: "monday_motivation", quote: "Do the work." }))).toBe("words");
    expect(postArtCard(post({ series_data: { birthday: { name: "Amanda" } } as never }))).toBe("birthday");
    expect(postArtCard(post({ series: "holiday", series_extra: { holiday: "thanksgiving", name: "Thanksgiving", image: "/community/holidays/thanksgiving.jpg" } as never }))).toBe("holiday");
    expect(postArtCard(post({ series: "saturday_spirit", series_extra: { scene: "keep_digging" } as never }))).toBe("scene");
    expect(postArtCard(post({ series: "saturday_spirit", series_extra: { scene: "keep_digging" } as never, media_path: "a.jpg", media_type: "image" }))).toBeNull();
    expect(postArtCard(post({ series: "lesson", series_extra: lessonExtra as never, media_path: "a.jpg", media_type: "image" }))).toBe("lesson");
    expect(postArtCard(post())).toBeNull();
    // the grid / Home decide without loading the painters
    expect(autoPostHasArt(post({ series: "saturday_spirit", media_type: "image" }))).toBe(false);
    expect(autoPostHasArt(post({ series: "lesson", media_type: "image" }))).toBe(true);
    expect(autoPostHasArt(post({ series: "wednesday_wins" }))).toBe(true);
  });
});

describe("one picture per post, painted once", () => {
  it("is named by what's on it: a new caption or new numbers make a new one; the unit only where numbers show", () => {
    const a = post({ series: "wednesday_wins", series_data: wins as never });
    expect(postArtKey(a, "wins", "lb")).toBe(postArtKey({ ...a }, "wins", "lb"));
    expect(postArtKey(a, "wins", "lb")).not.toBe(postArtKey(a, "wins", "kg"));
    expect(postArtKey(a, "wins", "lb")).not.toBe(postArtKey({ ...a, caption: "edited" }, "wins", "lb"));
    expect(postArtKey(a, "wins", "lb")).not.toBe(postArtKey({ ...a, series_data: { ...wins, prs: 69 } as never }, "wins", "lb"));
    const l = post({ series: "lesson", series_extra: lessonExtra as never });
    expect(postArtKey(l, "lesson", "lb")).toBe(postArtKey(l, "lesson", "kg"));
    expect(postArtKey(l, "lesson", "lb").startsWith(`v${POST_ART_VERSION}.p1.lesson.`)).toBe(true);
  });
  it("says what it shows for screen readers", () => {
    expect(postArtAlt(post({ series: "lesson", series_extra: lessonExtra as never }), "lesson")).toBe("Hips shooting up before the bar moves");
    expect(postArtAlt(post({ series_data: { birthday: { name: "Amanda" } } as never }), "birthday")).toBe("Happy birthday Amanda");
    expect(postArtAlt(post({ series: "monday_motivation", quote: "Do the work." }), "words")).toBe("“Do the work.”");
  });

  describe("kept and shared", () => {
    let n = 0;
    beforeEach(() => {
      resetPostArt();
      n = 0;
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: () => {} }));
    });
    afterEach(() => vi.unstubAllGlobals());
    it("two asks at once paint once, and it's ready right away after (Save image needs it inside the tap)", async () => {
      const paint = vi.fn(async () => new Blob(["x"], { type: "image/jpeg" }));
      const [a, b] = await Promise.all([loadPostArt("k1", "a.jpg", paint), loadPostArt("k1", "a.jpg", paint)]);
      expect(paint).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
      expect(peekPostArt("k1")?.file.name).toBe("a.jpg");
      expect(peekPostArt("k1")?.file.type).toBe("image/jpeg");
      // a failed paint is just no picture (the post shows its words), never a throw
      expect(await loadPostArt("k2", "b.jpg", async () => null)).toBeNull();
      expect(await loadPostArt("k3", "c.jpg", async () => Promise.reject(new Error("no canvas")))).toBeNull();
    });
  });
});

describe("the words card reads like a post, not a wall of text", () => {
  it("a whole tip on one line leads with its first sentence", () => {
    expect(splitHeadline("cue to test on squats this week: spread the floor. push your feet out to the sides like youre trying to rip the floor apart, without your feet actually moving.")).toEqual({
      head: "cue to test on squats this week: spread the floor.",
      rest: "push your feet out to the sides like youre trying to rip the floor apart, without your feet actually moving.",
    });
    expect(splitHeadline("Short line stays whole.")).toEqual({ head: "Short line stays whole.", rest: "" });
  });
  it("a Tuesday tip says what kind it is, unless its words already do", () => {
    expect(wordsCardText(post({ series: "tuesday_tips", series_extra: { kind: "habit" } as never, caption: "Rest 3 minutes on your top sets" })).kicker).toBe("Workout habit");
    expect(wordsCardText(post({ series: "tuesday_tips", series_extra: { kind: "cue" } as never, caption: "cue to test on squats this week: spread the floor." })).kicker).toBeNull();
  });
});

describe("in the app", () => {
  const card = read("src/components/community/post-card.tsx");
  const detail = read("src/components/community/post-detail.tsx");
  it("the feed and the post's page: the picture edge to edge, then the coach's name and words (Instagram's short preview)", () => {
    expect(card).toContain("<AutoPostHero post={post} thumbUrl={thumbUrl} unit={unit} />");
    expect(card).toContain("{auto && <AutoPostCaption post={post} clamp onOpenPerson={onOpenAuthor} />}");
    expect(detail).toContain("<AutoPostHero post={post} thumbUrl={thumb} unit={unit} full />");
    expect(detail).toContain('<AutoPostCaption post={post} clamp={false} onOpenPerson={onOpenAuthor} className="px-4" />');
    expect(card).toContain("lead={post.author.name} limits={PICTURE_CAPTION_LIMITS}");
    expect(PICTURE_CAPTION_LIMITS).toEqual({ all: 4, cut: 3, min: 1 });
    // what's only for the crew (the Recap's "work on this week") stays in the app, under the words
    expect(card).toContain("const improve = isRecapStats(post.series_data) ? post.series_data.improve : null;");
  });
  it("the grid and Home show the same picture, loading the painters only when one shows", () => {
    const tile = read("src/components/community/post-tile.tsx");
    expect(tile).toContain('const AutoPostTile = lazyWithRetry(() => import("@/components/community/post-art").then((m) => ({ default: m.AutoPostTile })), { fallback: ArtBlank });');
    expect(tile).toContain("{autoPostHasArt(post) ? (");
    expect(read("src/components/community/community-entry.tsx")).toContain("const art = autoPostHasArt(post);");
  });
  it("the coach's Save image hands over the very file on screen; Share to Instagram sends the same one", () => {
    const actions = read("src/components/community/post-actions.tsx");
    expect(actions).toContain("const art = artCard ? peekPostArt(postArtKey(post, artCard, unit)) : null;");
    expect(actions).toContain("void sendToInstagram([art.file], null)");
    expect(actions).toContain("<DropdownMenuItem onSelect={act(saveImage)} data-save-image>");
    const sheet = read("src/components/community/instagram-share-sheet.tsx");
    expect(sheet).toContain('? (await loadPostArt(postArtKey(post, card, unit), instagramFileName(post, 0, "image/jpeg"), () => paintCardFile(post, card, "feed", unit, artHost)))?.file');
  });
  it("the lesson planner shows the lesson as the crew will see it: its card, then his words", () => {
    expect(read("src/components/community/coach-lessons.tsx")).toContain('<PostArtImage post={preview} card="lesson" unit="lb" eager />');
  });
});

describe("birthday posts say whose birthday it is", () => {
  const sql = read("supabase/migrations/20261227100000_birthday_post_marker.sql");
  it("stamped when the draft is posted, and on the ones already up, never over a post's own series data", () => {
    expect(sql).toContain("AFTER UPDATE OF post_id ON public.community_birthday_posts");
    expect(sql).toContain("WHERE p.id = NEW.post_id AND p.series IS NULL AND p.series_data IS NULL;");
    expect(sql).toContain("WHERE b.post_id = p.id AND p.series IS NULL AND p.series_data IS NULL;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_birthday_marker(uuid, text) FROM PUBLIC, anon, authenticated;");
    // the name the post uses ("happy birthday Amanda", not her crew name "Alyssa Amanda"), else the crew's
    expect(sql).toContain("WHERE nullif(btrim(t.n), '') IS NOT NULL AND strpos(lower(coalesce(_caption, '')), lower(btrim(t.n))) > 0");
    expect(sql).toContain("SET series_data = public.community_birthday_marker(NEW.client_id, p.caption)");
  });
});
