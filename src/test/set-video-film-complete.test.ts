import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIDEO_BUDGETS } from "@/lib/video-edit/limits";
import { AS_IS_MAX_SHARE, planVideo, type SourceInfo } from "@/lib/video-edit/plan";
import { filmLeftOutStatus, filmNotes } from "@/lib/workout-film";

/**
 * Nov 18 2026: Jared filmed 6 sets on Monday. His Belt Squat (an iPhone 4K
 * clip, 69 s, 143.6 MB) was 3.6 MB over the coach chat's 140 MB target, so the
 * phone had no "send it as it is" to fall back on and sat 6.5 minutes
 * re-encoding it, again from the start each time the app was left; it reached
 * the coach two days later. His Pull Up (58.5 MB, 31 s) went to the coach as
 * it was, the app was left before its 720p copy for Crew was made, and the
 * phone wouldn't look for it again for up to 6 hours, and only on a fresh
 * launch, so the film in the feed showed 5 of his 6 sets and said nothing.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MB = 1024 * 1024;
const fourK = (seconds: number, bytes: number): SourceInfo => ({
  duration: seconds,
  bytes,
  width: 2160,
  height: 3840,
  codec: "hevc",
  audioCodec: "aac",
  hasAudio: true,
  fps: 30,
  container: "mov",
});

describe("a slow phone sends a clip as it is whenever the server takes it", () => {
  it("the Belt Squat: a whole clip a little over the target can go as it is if encoding is too slow", () => {
    const p = planVideo(fourK(68.7, 143.6 * MB), null, "coach", { canEncode: true });
    expect(p.mode).toBe("transcode");
    if (p.mode === "transcode") expect(p.copyFallback?.estBytes).toBe(143.6 * MB);
  });
  it("never past the server's limit; a cut's estimate keeps a margin under it", () => {
    const max = VIDEO_BUDGETS.coach.max;
    const over = planVideo(fourK(90, max + MB), null, "coach", { canEncode: true });
    if (over.mode === "transcode") expect(over.copyFallback).toBeNull();
    // a cut estimated just under the limit: an estimate can run over, so no
    const cut = planVideo(fourK(200, Math.round(max * 2)), { start: 0, end: 98 }, "coach", { canEncode: true });
    expect(cut.mode).toBe("transcode");
    if (cut.mode === "transcode") expect(cut.copyFallback).toBeNull();
    const smallCut = planVideo(fourK(200, Math.round(max * 2)), { start: 0, end: 60 }, "coach", { canEncode: true });
    if (smallCut.mode === "transcode") expect(smallCut.copyFallback?.estBytes).toBeLessThanOrEqual(max * AS_IS_MAX_SHARE);
  });
  it("a feed copy still never falls back (nobody waits on it)", () => {
    expect(read("src/lib/set-videos/feed-copy.ts")).toContain("return { ...plan, copyFallback: null };");
  });
});

describe("a clip waiting on its copy for Crew gets it, and the film says so", () => {
  it("the phone looks again when the app comes back and when the film asks, not just on a launch", () => {
    const resume = read("src/lib/set-videos/resume.tsx");
    expect(resume).toContain('document.addEventListener("visibilitychange", onReturn);');
    expect(resume).toContain("window.addEventListener(FEED_COPY_CATCH_UP_EVENT, onAsk);");
    // one look at a time
    expect(resume).toContain("if (cancelled || looking) return;");
    const up = read("src/lib/set-videos/uploader.ts");
    expect(up).toContain("clearCatchUpChecked(job.userId);");
    const client = read("src/lib/workout-film-client.ts");
    expect(client).toContain("askFeedCopyCatchUp(userId);");
    expect(client).toContain("preparing: shrink ? forSize : 0,");
  });
  it("says what's true: a clip being made smaller isn't 'over 90 seconds'", () => {
    const none = { preparing: 0, tooBig: 0, tooLong: 0, overMax: 0 };
    expect(filmNotes(none)).toEqual([]);
    expect(filmNotes({ ...none, preparing: 1 })).toEqual([
      "1 more is getting ready for Crew. Keep the app open a minute or two.",
    ]);
    expect(filmNotes({ ...none, preparing: 2, tooLong: 1 })).toEqual([
      "2 more are getting ready for Crew. Keep the app open a minute or two.",
      "1 over 90 seconds stays in your coach chat only",
    ]);
    expect(filmNotes({ ...none, tooBig: 2 })).toEqual(["2 too big for Crew stay in your coach chat only"]);
    expect(filmNotes({ ...none, overMax: 1 })).toEqual(["1 more stays in your coach chat (a post holds 10)"]);
    expect(filmLeftOutStatus({ ...none, preparing: 1 })).toMatch(/^Getting it ready for Crew/);
    expect(filmLeftOutStatus({ ...none, tooLong: 1 })).toBe("Over 90 seconds, so it stays in your coach chat");
    expect(read("src/components/workout/shared/workout-film.tsx")).not.toContain("over 90 seconds stay in your coach chat only");
  });
});
