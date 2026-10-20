import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CENTRED,
  GRID_ASPECT,
  POST_ASPECTS,
  clampFraming,
  cleanFocus,
  cropRect,
  feedAspect,
  focusPosition,
  framingFromGuide,
  gridWindow,
  guideBand,
  nextAspect,
  outputSize,
  panFocus,
  panFraming,
  pinchFraming,
  placement,
  snapFocus,
  snapToCentre,
  visibleShare,
} from "@/lib/photo-frame";
import { inFeed, postSlides } from "@/lib/community";

const read = (p: string) => readFileSync(p, "utf8");
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// a portrait iPhone photo, and the feed's 4:5 frame on a 390px-wide phone
const PHOTO = { w: 3024, h: 4032 };
const FRAME = { w: 390, h: 487.5 };

describe("framing a photo in its post's shape", () => {
  it("starts filling the frame, centred, and never shows an empty edge", () => {
    const p = placement(CENTRED, PHOTO, FRAME);
    expect(p.x).toBeLessThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(0);
    expect(p.x + p.w).toBeGreaterThanOrEqual(FRAME.w - 1e-6);
    expect(p.y + p.h).toBeGreaterThanOrEqual(FRAME.h - 1e-6);
    // dragged way past the edge: it stops at the edge
    const far = panFraming(CENTRED, 5000, 5000, PHOTO, FRAME);
    const q = placement(far, PHOTO, FRAME);
    expect(near(q.x, 0) || q.x < 0).toBe(true);
    expect(near(q.y, 0, 1e-6)).toBe(true);
  });
  it("follows the finger: dragging down by 20px moves the photo down by 20px", () => {
    const zoomed = clampFraming({ z: 2, cx: 0.5, cy: 0.5 }, PHOTO, FRAME);
    const before = placement(zoomed, PHOTO, FRAME);
    const after = placement(panFraming(zoomed, 0, 20, PHOTO, FRAME), PHOTO, FRAME);
    expect(after.y - before.y).toBeCloseTo(20, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
  });
  it("pinch zooms where the fingers are, between 1x and 5x", () => {
    const m = { x: 100, y: 120 };
    const z2 = pinchFraming(CENTRED, m, 100, m, 200, PHOTO, FRAME);
    expect(z2.z).toBeCloseTo(2, 6);
    // the spot under the fingers stays under them
    const s0 = placement(CENTRED, PHOTO, FRAME);
    const s1 = placement(z2, PHOTO, FRAME);
    const u0 = (m.x - s0.x) / s0.w;
    const u1 = (m.x - s1.x) / s1.w;
    expect(u1).toBeCloseTo(u0, 6);
    expect(pinchFraming(CENTRED, m, 100, m, 10, PHOTO, FRAME).z).toBe(1);
    expect(pinchFraming(CENTRED, m, 10, m, 1000, PHOTO, FRAME).z).toBe(5);
  });
  it("snaps dead centre within a few px and says which line it's on", () => {
    const off = clampFraming({ z: 2, cx: 0.5 + 3 / (PHOTO.w * (FRAME.w / PHOTO.w) * 2), cy: 0.4 }, PHOTO, FRAME);
    const s = snapToCentre(off, PHOTO, FRAME);
    expect(s.v).toBe(true);
    expect(s.framing.cx).toBe(0.5);
    expect(s.h).toBe(false);
    // an axis it can't move along never "snaps" (no guide for nothing)
    expect(snapToCentre(CENTRED, PHOTO, { w: 390, h: 520 }).v).toBe(false);
  });
  it("what's posted is exactly the part the frame shows", () => {
    const f = clampFraming({ z: 1.5, cx: 0.4, cy: 0.6 }, PHOTO, FRAME);
    const r = cropRect(f, PHOTO, FRAME.w / FRAME.h);
    expect(r.sw / r.sh).toBeCloseTo(4 / 5, 6);
    const vis = visibleShare(PHOTO, FRAME, f.z);
    expect(r.sx).toBeCloseTo((f.cx - vis.w / 2) * PHOTO.w, 6);
    expect(r.sy).toBeCloseTo((f.cy - vis.h / 2) * PHOTO.h, 6);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy + r.sh).toBeLessThanOrEqual(PHOTO.h + 1e-6);
    expect(outputSize(POST_ASPECTS.portrait)).toEqual({ w: 1080, h: 1350 });
    expect(outputSize(POST_ASPECTS.square)).toEqual({ w: 1080, h: 1080 });
    expect(outputSize(POST_ASPECTS.landscape)).toEqual({ w: 1080, h: 608 });
  });
  it("a camera shot starts framed the way the 4:5 guide showed it", () => {
    // a 3:4 camera frame in a 9:16 viewfinder: the sides are already cropped off on screen
    const shot = { w: 1440, h: 1920 };
    const view = { w: 390, h: 693 };
    const band = guideBand(view, 4 / 5);
    expect(band.w).toBe(390);
    expect(band.h).toBeCloseTo(487.5, 6);
    expect(band.y).toBeCloseTo((693 - 487.5) / 2, 6);
    const f = framingFromGuide(shot, view, band);
    // the guide showed the middle 390 px of a 520 px-wide picture: 75% of its width
    expect(visibleShare(shot, band, f.z).w).toBeCloseTo(390 / ((1440 * 693) / 1920), 6);
    expect(f.cx).toBe(0.5);
  });
  it("the shape button goes 4:5 → 1:1 → 16:9 → 4:5", () => {
    expect(nextAspect("portrait")).toBe("square");
    expect(nextAspect("square")).toBe("landscape");
    expect(nextAspect("landscape")).toBe("portrait");
  });
});

describe("the feed's shapes and the profile grid", () => {
  it("the feed shows posts between 4:5 and 16:9; the grid tile is the middle 3:4", () => {
    expect(feedAspect(2268, 4032)).toBe(0.8);
    expect(feedAspect(1080, 1350)).toBeCloseTo(0.8, 6);
    expect(feedAspect(1080, 1080)).toBe(1);
    expect(feedAspect(4000, 1000)).toBe(1.78);
    expect(GRID_ASPECT).toBe(0.75);
    const w = gridWindow(4 / 5);
    expect(w.h).toBe(1);
    expect(w.w).toBeCloseTo(0.9375, 6);
    expect(w.x).toBeCloseTo(0.03125, 6);
    const tall = gridWindow(9 / 16);
    expect(tall.w).toBe(1);
    expect(tall.h).toBeCloseTo(0.75, 6);
  });
  it("a clip's focus: drag it, centred snaps, CSS object-position, junk is ignored", () => {
    const clip = { w: 1080, h: 1920 };
    const frame = { w: 390, h: 487.5 };
    // the clip overflows the 4:5 frame vertically only
    const down = panFocus({ x: 0.5, y: 0.5 }, 0, 40, clip, frame);
    expect(down.x).toBe(0.5);
    expect(down.y).toBeLessThan(0.5);
    expect(snapFocus({ x: 0.5, y: 0.505 }, clip, frame).h).toBe(true);
    expect(focusPosition({ x: 0.5, y: 0.25 })).toBe("50% 25%");
    expect(focusPosition({ x: 0.5, y: 0.5 })).toBeUndefined();
    expect(focusPosition(null)).toBeUndefined();
    expect(cleanFocus({ x: "a", y: 1 })).toBeNull();
    expect(cleanFocus({ x: -1, y: 3 })).toEqual({ x: 0, y: 1 });
  });
  it("the cover's focus rides on its slide", () => {
    const slides = postSlides({ media_path: "u/a.mp4", media_thumb_path: "u/a.jpg", media_type: "video", media_width: 1080, media_height: 1920, extra_media: null, media_focus: { x: 0.5, y: 0.3 } });
    expect(slides[0].focus).toEqual({ x: 0.5, y: 0.3 });
  });
  it("grid tiles show a post's focus", () => {
    const tile = read("src/components/community/post-tile.tsx");
    expect(tile).toContain("const objectPosition = focusPosition(post.media_focus);");
    expect(tile).toContain("<TileImg src={thumb} onError={fail} position={objectPosition} />");
  });
});

describe("stories (STORY on the camera)", () => {
  it("live only in the story rail: never the feed, Home's deck or the profile grid", () => {
    expect(inFeed({ story: true })).toBe(false);
    expect(inFeed({ auto: true, stats: {} })).toBe(false);
    expect(inFeed({})).toBe(true);
    expect(read("src/components/community/community-screen.tsx")).toContain("const ownPosts = useMemo(() => posts.filter(inFeed), [posts]);");
    expect(read("src/components/community/profile-view.tsx")).toContain(".filter((p) => !p.story)");
  });
  it("are flagged in the same insert, for the crew or Close friends only, and left out of counts", () => {
    const sql = read("supabase/migrations/20261207100000_crew_stories_and_framing.sql");
    expect(sql).toContain("VALUES (v_author, v_client, 'note', _visibility, v_cap, coalesce(_story, false))");
    expect(sql).toContain("RAISE EXCEPTION 'A story is for the crew or Close friends';");
    expect(sql).toContain("AND NOT p.story_only");
    expect(sql).toContain("jsonb_build_object('media_focus', n.media_focus, 'story', n.story_only) || jsonb_build_object(");
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("...(i.story ? { _story: true } : {})");
  });
  it("the studio posts a story as one picture or clip, to the crew or Close friends", () => {
    const cam = read("src/components/community/share-studio.tsx");
    expect(cam).toContain("await createCommunityPost(qc, { userId: user.id, caption: \"\", visibility: audience, photo, extras, story: true, sharedPostId });");
    expect(cam).toContain('const STORY_AUDIENCE: CommunityVisibility[] = ["community", "close_friends"];');
    expect(cam).toContain("<ModeTabs modes={KINDS} mode={kind} onMode={(k) => pickKind(k as ShareKind)} />");
  });
});

describe("the studio frames what's posted", () => {
  const cam = read("src/components/community/share-studio.tsx");
  const framer = read("src/components/community/photo-framer.tsx");
  it("the editor's frame is the post's own shape, and the photo is baked into it", () => {
    expect(cam).toContain("const boxAspect = phase === \"shoot\" ? CARD_W / CARD_H : frameAspect;");
    expect(cam).toContain("const finalPhoto = () => framedFile(frameAspect,");
    expect(cam).toContain("<PhotoFramer");
    expect(cam).toContain("data-frame-shape={aspect}");
    // a post's card is the feed's 4:5, painted over the photo as it's framed
    expect(cam).toContain('const cardFormat: ShareFormat = story ? "story" : "feed";');
    expect(cam).not.toContain("remapStickers(");
  });
  it("the rule-of-thirds grid shows only while a finger is on it, with the profile grid's tile", () => {
    expect(framer).toContain('active ? "opacity-100" : "opacity-0"');
    expect(framer).toContain("left-1/3");
    expect(framer).toContain("top-2/3");
    expect(framer).toContain("Profile grid");
  });
  it("a clip gets Edit cover and a draggable framing", () => {
    expect(cam).toContain("<FocusFramer");
    expect(cam).toContain("data-edit-cover");
    expect(cam).toContain("<CoverPicker");
    const tray = read("src/components/community/slide-tray.tsx");
    expect(tray).toContain("const setCover = useCallback(");
    expect(tray).toContain("if (slide.thumb && !it.existing) void removeCommunityFiles([slide.thumb]);");
  });
});

describe("the feed: taps like Instagram's", () => {
  const card = read("src/components/community/post-card.tsx");
  it("a tap on a picture never opens the post; a tap on a clip is its sound; two taps ❤️", () => {
    expect(card).not.toContain('aria-label="Open workout"');
    expect(card).not.toContain("onKeyDown={(e) => e.key === \"Enter\" && onOpen(post)}");
    expect(card).toContain('if ((e.target as Element | null)?.closest?.("[data-inline-video]")) {');
    expect(card).toContain("toggleFeedSound();");
  });
  it("a member's photo post is edge to edge with the words under it; coach posts keep their note layout", () => {
    expect(card).toContain("return post.kind === \"note\" && !!post.media_type && !post.series && !post.quote && !post.author.is_coach;");
    expect(card).toContain("{isNote && !photo ? (");
  });
});
