import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  POST_ASPECTS,
  SCREEN_ZONES,
  cleanFocus,
  clipFrame,
  closestAspect,
  focusPosition,
  frameFocus,
  framedMediaStyle,
  nextAspect,
  screenFit,
  slideAspect,
} from "@/lib/photo-frame";
import { postMediaRatio } from "@/components/community/post-card";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const pct = (s: string) => Number(s.replace("%", ""));

describe("a post's shape, Instagram's way, with the Crew feed's full screen (Nov 13 2026)", () => {
  it("four shapes, 9:16 first (it fills a phone's screen in the feed); the corner button walks them", () => {
    expect(POST_ASPECTS.full).toBeCloseTo(9 / 16, 6);
    expect(nextAspect("full")).toBe("portrait");
    expect(nextAspect("landscape")).toBe("full");
  });

  it("a post starts at the shape closest to its first photo or clip, so nothing is cut that needn't be", () => {
    expect(closestAspect(1080, 1920)).toBe("full"); // a phone's clip or screenshot
    expect(closestAspect(3024, 4032)).toBe("portrait"); // an iPhone photo's 3:4
    expect(closestAspect(1080, 1080)).toBe("square");
    expect(closestAspect(1920, 1080)).toBe("landscape");
    expect(closestAspect(null, null)).toBe("portrait");
    // the studio: a library photo or the first clip sets it until the shape is picked by hand; the camera's shot is its 4:5 guide
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain('setAspect(s.live ? "portrait" : closestAspect(own.w, own.h));');
    expect(studio).toContain("if (aspectPicked.current || !firstShape) return;");
    expect(studio).toContain("aspectPicked.current = true;");
  });
});

describe("a clip framed in the studio keeps its frame (drag to place it, pinch to size it)", () => {
  it("is stored in its focus: the shape, the zoom and the middle of what shows; an older focus stays CSS object-position", () => {
    const f = frameFocus({ z: 1.5, cx: 0.4, cy: 0.62 }, 9 / 16);
    expect(f).toEqual({ x: 0.4, y: 0.62, z: 1.5, a: 0.5625 });
    expect(clipFrame(f)).toEqual({ a: 0.5625, z: 1.5, x: 0.4, y: 0.62 });
    expect(clipFrame({ x: 0.5, y: 0.3 })).toBeNull();
    // checked like the database's community_media_focus: a shape out of range is dropped, the zoom capped
    expect(cleanFocus({ x: 0.5, y: 0.5, a: 3, z: 2 })).toEqual({ x: 0.5, y: 0.5 });
    expect(cleanFocus({ x: 0.5, y: 0.5, a: 0.8, z: 9 })).toEqual({ x: 0.5, y: 0.5, a: 0.8, z: 5 });
    expect(cleanFocus({ x: 0.5, y: 0.5, a: 1 })).toEqual({ x: 0.5, y: 0.5, a: 1, z: 1 });
    // its poster is baked to the frame, so nothing crops it again by its focus
    expect(focusPosition(f)).toBeUndefined();
  });

  it("every screen shows exactly the part that was framed: the clip's own box placed inside the frame, in %", () => {
    // a 9:16 clip at 9:16, as it is: the whole clip
    expect(framedMediaStyle({ a: 0.5625, z: 1, x: 0.5, y: 0.5 }, 0.5625)).toEqual({ width: "100%", height: "100%", left: "0%", top: "0%" });
    // the same clip framed 4:5, centred: full width, a bit off its top and bottom
    const s = framedMediaStyle({ a: 0.8, z: 1, x: 0.5, y: 0.5 }, 0.5625);
    expect(pct(s.width)).toBeCloseTo(100, 2);
    expect(pct(s.height)).toBeCloseTo((0.8 / 0.5625) * 100, 2);
    expect(pct(s.top)).toBeCloseTo(50 - pct(s.height) / 2, 2);
    // pinched to 2x: twice the size, still centred
    const z = framedMediaStyle({ a: 0.8, z: 2, x: 0.5, y: 0.5 }, 0.5625);
    expect(pct(z.width)).toBeCloseTo(200, 2);
    expect(pct(z.left)).toBeCloseTo(-50, 2);
    // dragged to its top: the top edge sits at the frame's top, never further (no empty edges)
    expect(pct(framedMediaStyle({ a: 0.8, z: 1, x: 0.5, y: 0 }, 0.5625).top)).toBe(0);
    // Fionna's 3:4 clip framed 9:16 (full screen): full height, its sides off
    const full = framedMediaStyle({ a: 0.5625, z: 1, x: 0.5, y: 0.5 }, 0.75);
    expect(pct(full.height)).toBeCloseTo(100, 2);
    expect(pct(full.width)).toBeCloseTo((0.75 / 0.5625) * 100, 2);
  });

  it("the feed lays it out at its frame's shape: a 9:16 frame fills a post's screen, a 4:5 one sits whole above the words", () => {
    const later = 393 / 709; // an iPhone's post screen, under the status bar to the tab bar
    const clip = (w: number, h: number, focus?: object) => ({ type: "video" as const, width: w, height: h, focus: (focus ?? null) as never });
    expect(slideAspect(clip(1080, 1440, { x: 0.5, y: 0.5, a: 0.5625, z: 1 }))).toBeCloseTo(0.5625, 6);
    expect(screenFit(clip(1080, 1440, { x: 0.5, y: 0.5, a: 0.5625, z: 1 }), later)).toBe("cover");
    expect(screenFit(clip(1080, 1920, { x: 0.5, y: 0.5, a: 0.8, z: 1 }), later)).toBe("contain");
    // what was framed is never cut by more than a sliver, even on a shorter screen (an unframed 4:5 clip may lose a quarter there)
    expect(screenFit(clip(1080, 1920, { x: 0.5, y: 0.5, a: 0.8, z: 1 }), 393 / 650)).toBe("contain");
    expect(screenFit(clip(1080, 1350), 393 / 650)).toBe("cover");
    // and in the coach's feed of cards, at its frame (a clip's own range, 9:16 to 16:9)
    const post = { media_path: "u/a.mp4", media_thumb_path: "u/a.jpg", media_type: "video" as const, media_width: 1080, media_height: 1920, extra_media: null };
    expect(postMediaRatio({ ...post, media_focus: { x: 0.5, y: 0.5, a: 1, z: 1 } })).toBe(1);
    expect(postMediaRatio({ ...post, media_focus: null })).toBeCloseTo(0.5625, 6);
  });

  it("one box shows it wherever it plays: the feed's screens and cards, a post's page and the full-screen clips", () => {
    const box = read("src/components/community/clip-frame-box.tsx");
    expect(box).toContain('const w = fit === "cover" ? `max(100cqw, calc(100cqh * ${a}))` : `min(100cqw, calc(100cqh * ${a}))`;');
    expect(box).toContain('{children({ position: "absolute", ...framedMediaStyle(frame, media) })}');
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("{(style) => <div ref={host} style={style} data-clip-frame-host />}");
    expect(inline).toContain('el.style.objectFit = framed ? "cover" : fit === "contain" ? "contain" : "cover";');
    expect(read("src/components/community/post-card.tsx")).toContain("frame={clipFrame(slide.focus)}");
    expect(read("src/components/community/reels-viewer.tsx")).toContain("const frame = clipFrame(item.slide.focus);");
    // the database keeps it (every save path runs a slide's focus through community_media_focus)
    const sql = read("supabase/migrations/20270313090000_clip_frames.sql");
    expect(sql).toContain("WHEN jsonb_typeof(_f->'a') = 'number' AND (_f->>'a')::numeric BETWEEN 0.5 AND 1.8");
    expect(sql).toContain("THEN round(least(5, greatest(1, (_f->>'z')::numeric)), 4)");
  });
});

describe("the studio frames every slide, and what's posted is what it showed", () => {
  const studio = read("src/components/community/share-studio.tsx");
  const tray = read("src/components/community/slide-tray.tsx");

  it("a tap on a slide in the strip puts it in the frame (Instagram's); a clip plays there and is dragged and pinched like a photo", () => {
    expect(tray).toContain("onClick={() => (it.status === \"error\" ? tray.retry(it.id) : framable ? onSelect?.(it.id) : it.video ? void tray.edit(it.id) : undefined)}");
    expect(studio).toContain("onSelect={setSel}");
    expect(studio).toContain("onFraming={(f) => tray.setFraming(selItem.id, f)}");
    expect(read("src/components/community/photo-framer.tsx")).toContain("data-framed-clip");
    // the card stays painted underneath while another slide is framed
    expect(studio).toContain('className={cn("pointer-events-none absolute", selItem && "invisible")}');
  });

  it("Post frames each slide at the post's shape: a photo baked to it, a clip keeps its frame and gets a poster baked to it", () => {
    expect(studio).toContain("const extras = await tray.ready(frameAspect);");
    expect(tray).toContain("const { main, thumb: small } = await framedPhoto(src, f, shape);");
    // a phone holds a few big canvases, not ten: two slides at a time, the thumbnail drawn from the framed photo
    expect(tray).toContain("const FRAME_PARALLEL = 2;");
    expect(tray).toContain("const small = framedCanvas(big, { z: 1, cx: 0.5, cy: 0.5 }, aspect, thumbWidth(aspect));");
    expect(tray).toContain("const focus = frameFocus(f, shape);");
    expect(tray).toContain('const poster = src ? await framedFile(src, f, shape, thumbWidth(shape), "poster.jpg") : null;');
    // a photo already the post's shape and untouched goes as it was uploaded; a slide already on the post stays as it is
    expect(tray).toContain("if (Math.abs(size.w / size.h - shape) < 0.01 && f.z <= 1.001) return slide;");
    expect(tray).toContain("if (it.existing || !uid) return slide;");
  });

  it("the cover is picked as the frame shows it (placement and size are the frame's)", () => {
    const cover = read("src/components/community/cover-picker.tsx");
    expect(cover).toContain("const f = clampFraming(framing, size, frame);");
    expect(studio).toContain("framing={it.framing ?? CENTRED}");
  });

  it("at 9:16 the frame shows where Crew's bar, the caption and the buttons sit over it (TikTok's safe zone)", () => {
    expect(SCREEN_ZONES.top).toBeGreaterThan(0.08);
    expect(SCREEN_ZONES.bottom).toBeGreaterThan(0.12);
    const framer = read("src/components/community/photo-framer.tsx");
    expect(framer).toContain("const screen = gridPreview && Math.abs(aspect - POST_ASPECTS.full) < 0.01;");
    expect(framer).toContain("data-screen-zones");
  });
});
