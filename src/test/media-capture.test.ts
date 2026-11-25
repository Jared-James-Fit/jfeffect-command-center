import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAPTURE_RATIOS,
  CAPTURE_SETTINGS_KEY,
  PURPOSES,
  captureCrop,
  captureProfile,
  coverView,
  focusAt,
  focusPoint,
  framingForCrop,
  guideRect,
  levelAngle,
  purposeAccept,
  purposeStart,
  ratioValue,
  readCaptureSettings,
  sanitizeCaptureSettings,
  saveCaptureSettings,
  slideZoom,
  DEFAULT_CAPTURE_SETTINGS,
} from "@/lib/media/capture";
import { cropRect } from "@/lib/photo-frame";
import { bakeKey } from "@/lib/media/bake-key";

const read = (p: string) => readFileSync(p, "utf8");

describe("one capture layer, each place's defaults", () => {
  it("a post fills the screen, a story is 9:16, progress and check-ins 3:4 with the grid, a profile a square selfie", () => {
    expect(PURPOSES.post.ratio).toBe("screen");
    expect(PURPOSES.story.ratio).toBe("9:16");
    expect(PURPOSES.progress).toMatchObject({ ratio: "3:4", grid: true, video: false });
    expect(PURPOSES.checkin).toMatchObject({ ratio: "3:4", grid: true });
    expect(PURPOSES.profile).toMatchObject({ ratio: "1:1", facing: "user", video: false });
    expect(PURPOSES.chat.ratio).toBe("original");
    expect(PURPOSES.post.max).toBe(10);
  });
  it("the ratios on offer, in order", () => {
    expect(CAPTURE_RATIOS).toEqual(["screen", "original", "9:16", "4:5", "3:4", "1:1", "16:9"]);
  });
  it("what a picker for a place accepts", () => {
    expect(purposeAccept("profile")).toBe("image/*");
    expect(purposeAccept("post")).toBe("image/*,video/*");
  });
  it("a place opens with what was last used there, else its defaults", () => {
    const s = sanitizeCaptureSettings({ ratios: { post: "4:5" }, facing: { post: "user" } });
    expect(purposeStart("post", s)).toEqual({ ratio: "4:5", facing: "user", grid: false });
    expect(purposeStart("profile", s)).toEqual({ ratio: "1:1", facing: "user", grid: false });
    expect(purposeStart("progress", s).grid).toBe(true);
  });
});

describe("the camera's settings", () => {
  it("anything odd stored falls back to Auto, no timer, nothing on", () => {
    expect(sanitizeCaptureSettings(null)).toEqual(DEFAULT_CAPTURE_SETTINGS);
    expect(sanitizeCaptureSettings({ mode: "turbo", timer: 5, quality: "8k", fps: 120, ratios: { post: "2:1" } })).toEqual(DEFAULT_CAPTURE_SETTINGS);
    expect(sanitizeCaptureSettings({ mode: "max", timer: 10, level: true, quality: "4k", fps: 60 })).toMatchObject({ mode: "max", timer: 10, level: true, quality: "4k", fps: 60 });
  });
  it("kept on the phone and read back", () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveCaptureSettings({ ...DEFAULT_CAPTURE_SETTINGS, mode: "fast", ratios: { story: "9:16" } }, st);
    expect(store.has(CAPTURE_SETTINGS_KEY)).toBe(true);
    expect(readCaptureSettings(st)).toMatchObject({ mode: "fast", ratios: { story: "9:16" } });
  });
  it("Maximum quality asks for the most the camera says it can do, never more (no upscaling)", () => {
    const fourK = { width: { max: 3840 }, height: { max: 2160 }, frameRate: { max: 60 } };
    const hd = { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } };
    expect(captureProfile({ mode: "max", quality: null, fps: 30 }, fourK, true)).toEqual({ quality: "4k", fps: 30, still: "photo" });
    expect(captureProfile({ mode: "max", quality: null, fps: 60 }, hd, false)).toEqual({ quality: "1080p", fps: 30, still: "frame" });
    expect(captureProfile({ mode: "fast", quality: null, fps: 30 }, fourK, true)).toEqual({ quality: "1080p", fps: 30, still: "frame" });
    expect(captureProfile({ mode: "fast", quality: "4k", fps: 30 }, fourK, true).quality).toBe("1080p");
    expect(captureProfile({ mode: "auto", quality: null, fps: 60 }, fourK, true)).toEqual({ quality: "1080p", fps: 60, still: "frame" });
    // a quality picked by hand wins where the camera can do it
    expect(captureProfile({ mode: "auto", quality: "4k", fps: 30 }, fourK, true).quality).toBe("4k");
    expect(captureProfile({ mode: "auto", quality: "4k", fps: 30 }, hd, true).quality).toBe("1080p");
  });
});

describe("the viewfinder: what's on the screen, the guide, the crop", () => {
  const picture = { w: 1080, h: 1920 }; // a 9:16 camera picture
  const screen = { w: 393, h: 852 }; // an iPhone, taller than 9:16

  it("full screen crops the sides of a 9:16 picture to the screen's shape", () => {
    const v = coverView(picture, screen);
    expect(v.h).toBeCloseTo(1920, 3);
    expect(v.w / v.h).toBeCloseTo(screen.w / screen.h, 5);
    expect(v.x).toBeCloseTo((1080 - v.w) / 2, 5);
  });
  it("the guide is the middle band of the ratio's shape", () => {
    const g = guideRect(screen, 1);
    expect(g.w).toBeCloseTo(393, 5);
    expect(g.h).toBeCloseTo(393, 5);
    expect(g.y).toBeCloseTo((852 - 393) / 2, 5);
    expect(guideRect(screen, null)).toEqual({ x: 0, y: 0, w: 393, h: 852 });
  });
  it("a shot keeps what its ratio showed: Original the whole picture, Full screen the screen, 1:1 the square", () => {
    expect(captureCrop(picture, screen, "original")).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    const full = captureCrop(picture, screen, "screen");
    expect(full.w / full.h).toBeCloseTo(screen.w / screen.h, 5);
    const sq = captureCrop(picture, screen, "1:1");
    expect(sq.w).toBeCloseTo(sq.h, 5);
    expect(sq.x + sq.w / 2).toBeCloseTo(540, 3);
    expect(sq.y + sq.h / 2).toBeCloseTo(960, 3);
    // 16:9 on an upright phone: the widest 16:9 of the whole picture (never a sliver scaled up)
    const wide = captureCrop(picture, screen, "16:9");
    expect(wide.w).toBeCloseTo(1080, 3);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9, 5);
  });
  it("ratios as numbers; Full screen and Original from the screen and the picture", () => {
    expect(ratioValue("4:5", {})).toBeCloseTo(0.8);
    expect(ratioValue("screen", { screen })).toBeCloseTo(393 / 852);
    expect(ratioValue("original", { picture })).toBeCloseTo(9 / 16);
    expect(ratioValue("original", {})).toBeNull();
  });
  it("the shot starts framed as its guide showed it, and stays whole (non-destructive)", () => {
    const crop = captureCrop(picture, screen, "1:1");
    const f = framingForCrop(picture, crop, 1);
    const r = cropRect(f, picture, 1);
    expect(r.sw).toBeCloseTo(crop.w, 0);
    expect(r.sh).toBeCloseTo(crop.h, 0);
    expect(r.sx).toBeCloseTo(crop.x, 0);
    // posted at 9:16 instead, the frame fits inside what the screen showed
    const full = captureCrop(picture, screen, "screen");
    const g = cropRect(framingForCrop(picture, full, 9 / 16), picture, 9 / 16);
    expect(g.sw).toBeLessThanOrEqual(full.w + 1);
  });
});

describe("focus, the level and the zoom", () => {
  it("a tap is a point of the picture, mirrored for a selfie", () => {
    const p = focusPoint({ x: 196.5, y: 426 }, { w: 393, h: 852 }, { w: 1080, h: 1920 });
    expect(p.x).toBeCloseTo(0.5, 3);
    expect(p.y).toBeCloseTo(0.5, 3);
    const left = focusPoint({ x: 0, y: 0 }, { w: 393, h: 852 }, { w: 1080, h: 1920 });
    expect(left.x).toBeGreaterThan(0); // the screen doesn't show the picture's edges
    const mirrored = focusPoint({ x: 0, y: 0 }, { w: 393, h: 852 }, { w: 1080, h: 1920 }, true);
    expect(mirrored.x).toBeCloseTo(1 - left.x, 5);
  });
  it("tap to focus only where the camera and the browser can (no square that does nothing)", () => {
    const p = { x: 0.4, y: 0.6 };
    expect(focusAt(p, { focusMode: ["continuous", "single-shot"] }, { pointsOfInterest: true })).toEqual({ pointsOfInterest: [p], focusMode: "single-shot" });
    expect(focusAt(p, { focusMode: ["continuous"], exposureMode: ["continuous"] }, { pointsOfInterest: true })).toMatchObject({ focusMode: "continuous", exposureMode: "continuous" });
    expect(focusAt(p, { focusMode: ["single-shot"] }, {})).toBeNull();
    expect(focusAt(p, {}, { pointsOfInterest: true })).toBeNull();
  });
  it("the level reads 0 when straight, upright or on its side, and how far off otherwise", () => {
    expect(levelAngle(0, -9.8)).toBeCloseTo(0, 5);
    expect(Math.abs(levelAngle(9.8, 0)!)).toBeCloseTo(0, 5);
    const five = levelAngle(Math.sin((5 * Math.PI) / 180) * 9.8, -Math.cos((5 * Math.PI) / 180) * 9.8)!;
    expect(Math.abs(five)).toBeCloseTo(5, 0);
    expect(levelAngle(0.1, 0.1)).toBeNull(); // flat on a table: no reading
  });
  it("sliding up while filming zooms in, down zooms out, within the camera's range", () => {
    expect(slideZoom(1, -180, { min: 1, max: 10 })).toBe(2);
    expect(slideZoom(2, 180, { min: 1, max: 10 })).toBe(1);
    expect(slideZoom(1, 400, { min: 1, max: 10 })).toBe(1);
    expect(slideZoom(1, -5000, { min: 1, max: 6 })).toBe(6);
  });
});

describe("every place captures through the one camera", () => {
  it("New post's Camera is the app's own camera (a post's defaults), the phone's only where it can't open", () => {
    const composer = read("src/components/community/post-composer.tsx");
    expect(composer).toContain('purpose: "post"');
    expect(composer).toContain('if (how === "camera" && camera.start()) return;');
    expect(composer).toContain("framingForCrop(s.picture, s.crop, POST_ASPECTS[aspect])");
  });
  it("chat, progress photos, check-ins and profile photos use it with their own defaults", () => {
    expect(read("src/components/message-thread.tsx")).toContain('purpose: "chat"');
    expect(read("src/components/group-message-thread.tsx")).toContain('purpose: "chat"');
    const progress = read("src/components/progress/progress-section.tsx");
    expect(progress).toContain('purpose: "progress"');
    expect(progress).toContain('if (mediaType === "photo" && photoCamera.start()) return;');
    expect(read("src/components/forms/client-form-renderer.tsx")).toContain('purpose: video ? undefined : "checkin"');
    expect(read("src/components/profile-picture-capture.tsx")).toContain('purpose: "profile"');
    expect(read("src/components/profile-picture-capture.tsx")).toContain("if (profileCamera.start()) return;");
  });
  it("the set camera keeps its own flow (video only, tap to start and stop)", () => {
    const cam = read("src/components/camera/film-camera.tsx");
    expect(cam).toContain('data-film-shutter={recording ? "recording" : "ready"}');
    expect(cam).toContain("if (!purpose) saveFilmSettings(s);");
    expect(read("src/components/workout-day/set-video-cell.tsx")).not.toContain("capture={");
  });
  it("the capture camera: tap for a photo, hold to film, tap to focus, a guide, a level, a timer, the flash", () => {
    const cam = read("src/components/camera/film-camera.tsx");
    for (const k of ["data-capture-shutter", "data-capture-guide", "data-capture-focus", "data-capture-level", "data-capture-count", "data-capture-flash", "data-capture-mode", "data-capture-ratio", "data-capture-timer"])
      expect(cam).toContain(k);
    expect(cam).toContain("HOLD_TO_RECORD_MS");
  });
});

describe("making a post's slides: once, from the latest edits", () => {
  it("the same edits give the same key; any change to them makes the slide again", () => {
    const base = { kind: "image" as const, framing: { z: 1.2, cx: 0.4, cy: 0.5 }, grade: null };
    expect(bakeKey(base, 9 / 16)).toBe(bakeKey({ ...base, framing: { ...base.framing } }, 9 / 16));
    expect(bakeKey(base, 9 / 16)).not.toBe(bakeKey(base, 4 / 5));
    expect(bakeKey(base, 9 / 16)).not.toBe(bakeKey({ ...base, framing: { ...base.framing, r: 90 } }, 9 / 16));
    expect(bakeKey(base, 9 / 16)).not.toBe(bakeKey({ ...base, framing: { ...base.framing, cx: 0.41 } }, 9 / 16));
    const clip = { kind: "video" as const, trim: { start: 1, end: 4 }, muted: false };
    expect(bakeKey(clip, 1)).not.toBe(bakeKey({ ...clip, muted: true }, 1));
    expect(bakeKey(clip, 1)).not.toBe(bakeKey({ ...clip, trim: { start: 1, end: 5 } }, 1));
  });
  it("a retry keeps the edits on the slide and makes nothing twice; tiles use small copies", () => {
    const tray = read("src/components/community/slide-tray.tsx");
    expect(tray).toContain("if (it.baked && it.baked === key) return slide;");
    expect(tray).toContain("patch(it.id, { baked: key, slide: next });");
    expect(tray).not.toContain("patch(it.id, { cover: null, framing: null, slide: next });");
    expect(tray).toContain('patch(id, { status: "done", progress: 100, slide, baked: null });');
    expect(tray).toContain("tile: m.kind === \"image\" && m.thumb ? URL.createObjectURL(m.thumb) : null,");
    expect(read("src/components/community/post-composer.tsx")).toContain("src={it.tile ?? it.preview}");
  });
});
