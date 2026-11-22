import { describe, expect, it } from "vitest";
import { JF_HANDLE, SHARE_DESTINATIONS, promoLine, withPromo, workoutShareCaption } from "@/lib/share-out";
import { STORY_ASPECT, storyCanFit, storyStartsWhole, wholeRect } from "@/lib/photo-frame";
import { planVideo } from "@/lib/video-edit/plan";
import { sameGrade, newerDefaults, sanitizeDefaults } from "@/lib/media-filter-prefs";
import type { SourceInfo } from "@/lib/video-edit/plan";

describe("share outside: the caption written from the workout", () => {
  const lift = { name: "2-Count Pause Bench Press", detail: "107.5 kg × 6", prLabel: null };
  it("a normal session: its block and week, the lift and the set, then the handle", () => {
    expect(workoutShareCaption({ workoutTitle: "Block 1 · Week 1", lift, isPr: false })).toBe("Block 1 · Week 1\n\n2-Count Pause Bench Press\n107.5 kg × 6\n\n@jfeffect");
  });
  it("a PR leads with it, the handle as 'Tracked with'", () => {
    expect(workoutShareCaption({ workoutTitle: "Block 1 · Week 1", lift: { ...lift, prLabel: "6-rep ATPR" }, isPr: true })).toBe("New PR. 107.5 kg × 6.\n\n2-Count Pause Bench Press\n\nTracked with @jfeffect");
    expect(promoLine({ isPr: true, lift: { ...lift, prLabel: "PR" } })).toBe(`Tracked with ${JF_HANDLE}`);
  });
  it("the promo line is optional and removable, whatever else was typed", () => {
    const c = workoutShareCaption({ workoutTitle: "Block 1 · Week 1", lift, isPr: false }, { promo: false });
    expect(c).not.toContain("@jfeffect");
    const typed = `${c}\n\nheavy one today`;
    expect(withPromo(typed, JF_HANDLE, true)).toBe(`${typed}\n\n@jfeffect`);
    expect(withPromo(withPromo(typed, JF_HANDLE, true), JF_HANDLE, false)).toBe(typed);
    expect(withPromo(`${c}\n\nTracked with @jfeffect`, JF_HANDLE, false)).toBe(c);
  });
  it("a post that hides its weights never puts them in the caption", () => {
    const c = workoutShareCaption({ workoutTitle: "Block 1 · Week 1", lift: { ...lift, prLabel: "PR" }, isPr: true, hideLoads: true });
    expect(c).not.toMatch(/107\.5|kg/);
    expect(c).toContain("2-Count Pause Bench Press");
  });
  it("only a tap that says it copies the caption copies it; each picture goes at its destination's shape", () => {
    for (const d of SHARE_DESTINATIONS) {
      if (d.copies) expect(d.sub.toLowerCase()).toMatch(/cop|paste/);
    }
    expect(SHARE_DESTINATIONS.find((d) => d.key === "ig_post")?.format).toBe("feed");
    expect(SHARE_DESTINATIONS.find((d) => d.key === "ig_story")?.format).toBe("story");
    expect(SHARE_DESTINATIONS.find((d) => d.key === "tiktok")?.format).toBe("story");
    expect(SHARE_DESTINATIONS.find((d) => d.key === "ig_story")?.copies).toBe(false);
  });
});

describe("story canvas: always the whole 9:16, never stretched or barred", () => {
  it("a phone's own portrait shot fills it; a landscape or square one starts whole over its blur", () => {
    expect(storyStartsWhole({ w: 1080, h: 1920 })).toBe(false);
    expect(storyStartsWhole({ w: 1440, h: 1920 })).toBe(false); // 3:4 trims 25%: fills
    expect(storyStartsWhole({ w: 1920, h: 1080 })).toBe(true);
    expect(storyStartsWhole({ w: 1200, h: 1200 })).toBe(true);
  });
  it("Fill / Fit is only offered when they'd differ", () => {
    expect(storyCanFit({ w: 1080, h: 1920 })).toBe(false);
    expect(storyCanFit({ w: 1440, h: 1920 })).toBe(true);
  });
  it("whole keeps the picture's own shape, centred", () => {
    const r = wholeRect({ w: 1920, h: 1080 }, { w: 1080, h: 1920 });
    expect(r.w).toBe(1080);
    expect(Math.round(r.h)).toBe(608);
    expect(Math.round(r.y)).toBe(656);
    expect(r.w / r.h).toBeCloseTo(1920 / 1080, 5);
    expect(STORY_ASPECT).toBeCloseTo(9 / 16);
  });
});

describe("a filtered clip is always re-encoded with its filter", () => {
  const lean: SourceInfo = { duration: 20, width: 720, height: 1280, bytes: 3_000_000, fps: 30, hasAudio: true, codec: "avc1", audioCodec: "aac", container: "mp4" };
  it("a small clip that would go as it is goes through the encoder once filtered, with no copy to fall back on", () => {
    expect(planVideo(lean, null, "post", { canEncode: true }).mode).toBe("original");
    const p = planVideo(lean, null, "post", { canEncode: true, graded: true });
    expect(p.mode).toBe("transcode");
    if (p.mode === "transcode") expect(p.copyFallback).toBeNull();
  });
  it("a phone that can't encode is planned as before (the filter isn't offered there)", () => {
    expect(planVideo(lean, null, "post", { canEncode: false, graded: true }).mode).toBe("original");
  });
});

describe("default filter: saved on the account, never a picture's measurements", () => {
  it("keeps only the filter, strength and adjustments", () => {
    const d = sanitizeDefaults({ post: { filter: "auto", intensity: 0.8, stats: { p50: 0.2 } }, story: { filter: "bogus" }, updatedAt: "2026-11-22T10:00:00Z" });
    expect(d).toEqual({ post: { filter: "auto", intensity: 0.8 }, story: null, updatedAt: "2026-11-22T10:00:00Z" });
  });
  it("the newer copy wins; the account's on a tie", () => {
    const a = { post: null, story: null, updatedAt: "2026-11-22T10:00:00Z" };
    const b = { post: { filter: "flash" as const, intensity: 1 }, story: null, updatedAt: "2026-11-22T11:00:00Z" };
    expect(newerDefaults(a, b)).toBe(b);
    expect(newerDefaults(b, a)).toBe(b);
  });
  it("this photo's own measurements don't make it a different filter from the default", () => {
    expect(sameGrade({ filter: "auto", intensity: 1, stats: { p02: 0, p10: 0, p50: 0.3, p90: 0.8, p98: 0.9, sat: 0.2, wb: [1, 1, 1], skin: 0 } }, { filter: "auto", intensity: 1 })).toBe(true);
    expect(sameGrade({ filter: "auto", intensity: 0.5 }, { filter: "auto", intensity: 1 })).toBe(false);
    expect(sameGrade(null, { filter: "original", intensity: 1 })).toBe(true);
  });
});
