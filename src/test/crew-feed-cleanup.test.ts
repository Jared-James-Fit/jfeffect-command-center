import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inFeed, isWorkoutCard } from "@/lib/community";
import { PHOTO_FILL_MAX_TRIM, PHOTO_ZOOM_MAX_TRIM, cleanFocus, photoZoomBox, screenFit } from "@/lib/photo-frame";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20270428090000_crew_feed_no_workout_cards.sql");

describe("Crew is what people post, never an activity log (Nov 20 2026)", () => {
  const bare = { kind: "workout" as const, media_path: null, extra_media: [], caption: null };

  it("a workout post that's only its generated card is never in Crew, Following or a profile", () => {
    // a session that posted itself, and one shared with nothing of their own
    expect(isWorkoutCard({ ...bare, auto: true })).toBe(true);
    expect(isWorkoutCard(bare)).toBe(true);
    expect(isWorkoutCard({ ...bare, caption: "   " })).toBe(true);
    expect(inFeed(bare)).toBe(false);
    expect(inFeed({ ...bare, auto: true, stats: {} })).toBe(false);
    // their own photo, clip, words, GIF or voice memo makes it theirs
    expect(isWorkoutCard({ ...bare, media_path: "u/p.jpg" })).toBe(false);
    expect(isWorkoutCard({ ...bare, extra_media: [{ path: "u/film/c/v.mp4", thumb: null, type: "video", width: 720, height: 1280 }] })).toBe(false);
    expect(isWorkoutCard({ ...bare, caption: "new PR!" })).toBe(false);
    expect(isWorkoutCard({ ...bare, gif_url: "https://media.giphy.com/x.gif" })).toBe(false);
    expect(isWorkoutCard({ ...bare, audio: { path: "u/a.m4a", duration: 3 } })).toBe(false);
    expect(inFeed({ ...bare, media_path: "u/p.jpg" })).toBe(true);
    // a lock in, a story and anyone's note aren't workout cards
    expect(isWorkoutCard({ ...bare, locked_in_at: "2026-11-20T12:00:00Z" })).toBe(false);
    expect(isWorkoutCard({ ...bare, story: true })).toBe(false);
    expect(isWorkoutCard({ kind: "note", media_path: null, caption: null })).toBe(false);
    expect(read("src/components/community/profile-view.tsx")).toContain(".filter((p) => !p.story && !isWorkoutCard(p))");
  });

  it("the old ones are archived, never deleted: likes, comments and the workout itself stay; the League points they earned stay", () => {
    // the same rule on the server, with a backup first
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.community_is_workout_card(_post_id uuid)");
    expect(migration).toContain("AND (coalesce(p.auto_shared, false)");
    expect(migration).toContain("INSERT INTO public.community_feed_cleanup_backup");
    expect(migration).toContain("SET archived_from = p.visibility, visibility = 'private', archived_at = now(), archived_reason = b.reason");
    expect(migration).not.toMatch(/DELETE FROM public\.community_posts/i);
    // League points: the cleanup's archive keeps what was earned; the function is replaced before the archive runs
    expect(migration).toContain("or (cp.archived_reason = 'workout_card' and cp.archived_from in ('community', 'followers')))");
    expect(migration.indexOf("FUNCTION public.community_post_xp_sync")).toBeLessThan(migration.indexOf("UPDATE public.community_posts p"));
    // Archived isn't filled with cards they never chose, and a card can't go back in the feed
    expect(migration).toContain("AND p.archived_reason IS DISTINCT FROM 'workout_card'");
    expect(migration).toContain("RAISE EXCEPTION 'Add a photo or clip to share this workout again'");
    // anything that brings a post back clears why it was archived
    expect(migration).toContain("IF NEW.archived_at IS NULL THEN NEW.archived_reason := NULL; END IF;");
    // the one older post that can't show well: the 540x450 Saturday cartoon, its author can put it back
    expect(migration).toContain("'d6e0aa8e-9c9d-4191-ba81-af47be8306fd'");
    expect(read("docs/rollback/2026-11-20-crew-feed-cleanup-rollback.sql")).toContain("FROM public.community_feed_cleanup_backup b");
  });

  it("nothing makes a card-only workout post again", () => {
    // the server refuses one to anyone but the athlete
    expect(migration).toContain("IF NOT v_lock AND _visibility <> 'private'");
    expect(migration).toContain("RAISE EXCEPTION 'Add a photo or clip to post this workout'");
    // the studio asks for a photo or clip and offers the story for the card on its own
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain('const needsMedia = !story && !!post?.needsMedia && visibility !== "private" && !shot && tray.items.length === 0 && !post.hasCover;');
    expect(studio).toContain("Add a photo or clip to post this to Crew. The card on its own can go on your story.");
    expect(studio).toContain("disabled={!!busy || posted || !post || !hasContent || needsMedia || att.recorder.recording}");
    expect(read("src/components/community/use-workout-studio.ts")).toContain("needsMedia: true,");
    expect(read("src/components/community/share-composer.tsx")).toContain('disabled={posting || (!hasMedia && visibility !== "private")}');
  });
});

describe("photos on a post's screen", () => {
  const photo = (width: number, height: number) => ({ type: "image" as const, width, height });

  it("one framed for the whole screen fills it, edge to edge, like a clip (a real iPhone home-screen app's screen)", () => {
    const iphone = 393 / 709; // under the notch to the tab bar
    expect(screenFit(photo(1080, 1920), iphone)).toBe("cover");
    expect(screenFit(photo(2268, 4032), iphone)).toBe("cover");
    expect(PHOTO_FILL_MAX_TRIM).toBe(0.12);
    // an older story card saved as a 9:16 photo, its own words where the post's go: shown whole (the audit's "fit": "whole")
    expect(cleanFocus({ x: 0.5, y: 0.5, fit: "whole" })).toEqual({ x: 0.5, y: 0.5, whole: true });
    expect(screenFit({ ...photo(1080, 1920), focus: { x: 0.5, y: 0.5, whole: true } }, iphone)).toBe("contain");
    expect(screenFit({ type: "video", width: 1080, height: 1920, focus: { x: 0.5, y: 0.5, whole: true } }, iphone)).toBe("cover");
    expect(read("supabase/migrations/20270428091000_crew_feed_whole_photo.sql")).toContain("WHERE id = '8901bf28-80bf-4f48-b14a-2b20750e076c'");
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain('page && !shrunk && fit === "cover" ? (');
    expect(card).toContain('data-photo-fit="cover"');
  });

  it("a little taller than the room between Crew's bar and the words: zoomed to its width, at most 10% of its height trimmed, never stretched or cut at the sides", () => {
    expect(PHOTO_ZOOM_MAX_TRIM).toBe(0.1);
    const box = photoZoomBox(2 / 3)!;
    // as wide as the room, unless that would trim more than 10% of its height
    expect(box.width).toBe("min(100cqw, calc(100cqh * 0.6667 / 0.9))");
    // the height follows the same shape (never stretched)
    expect(box.height).toBe("min(calc(100cqw / 0.6667), calc(100cqh / 0.9))");
    expect(box.left).toBe(`calc((100cqw - ${box.width}) / 2)`);
    expect(box.top).toBe(`calc((100cqh - ${box.height}) * 0.5)`);
    // its focus decides which part of a trimmed height stays
    expect(photoZoomBox(9 / 16, 0)!.top).toBe(`calc((100cqh - min(calc(100cqw / 0.5625), calc(100cqh / 0.9))) * 0)`);
    // unknown shape: shown whole, as before
    expect(photoZoomBox(null)).toBeNull();
    expect(photoZoomBox(0)).toBeNull();

    // the arithmetic the CSS does, on a 393 x 531 room
    const fit = (a: number, W = 393, H = 531, keep = 0.9) => {
      const w = Math.min(W, (H * a) / keep);
      const h = Math.min(W / a, H / keep);
      return { w, h, trimH: Math.max(0, 1 - H / h), trimW: Math.max(0, 1 - W / w) };
    };
    const twoThirds = fit(2 / 3); // fills the width, ~10% of its height off
    expect(twoThirds.w).toBe(393);
    expect(twoThirds.trimH).toBeLessThanOrEqual(0.1 + 1e-9);
    const fourFive = fit(4 / 5); // wider than the room: the full width, black above and below, nothing cut
    expect(fourFive.w).toBe(393);
    expect(fourFive.h).toBeCloseTo(393 / 0.8);
    expect(fourFive.trimH).toBe(0);
    const tall = fit(9 / 16); // far taller: only 10% of its height, the rest stays black at its sides
    expect(tall.trimH).toBeCloseTo(0.1);
    expect(tall.w).toBeLessThan(393);
    for (const a of [0.5, 9 / 16, 2 / 3, 3 / 4, 4 / 5, 1, 16 / 9]) expect(fit(a).w / fit(a).h).toBeCloseTo(a); // never stretched
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("const zoom = page && !isVideo ? photoZoomBox(slideAspect(slide), cleanFocus(slide.focus)?.y ?? 0.5) : null;");
    expect(card).toContain('data-photo-fit="zoom"');
  });
});
