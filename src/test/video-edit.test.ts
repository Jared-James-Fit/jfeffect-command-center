import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_MAX_SECONDS, VIDEO_BUDGETS, VIDEO_LIMITS, formatClock, limitWords, videoBudget, videoLimit } from "@/lib/video-edit/limits";
import {
  MIN_BYTES_TO_COMPRESS, TARGET_LONG_EDGE, copyBytes, defaultTrim, encodeTooSlow, isLean, maxSelectable, needsTrim, outputSize, planVideo, sourceProblem, type SourceInfo,
} from "@/lib/video-edit/plan";
import {
  centerSelectionOn, clampView, edgePan, needsOverview, normalizeSelection, setEnd, setStart, shiftSelection, tileGrid, timeToX, viewAround, viewSpan, xToTime,
} from "@/lib/video-edit/timeline";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MB = 1024 * 1024;

/** An iPhone recording: 1080p60 HEVC MOV at ~15 Mbps (what real uploads in chat looked like). */
const iphone = (seconds: number, over: Partial<SourceInfo> = {}): SourceInfo => ({
  duration: seconds,
  bytes: Math.round(seconds * 1.9 * MB),
  width: 1080,
  height: 1920,
  codec: "hevc",
  audioCodec: "aac",
  hasAudio: true,
  fps: 60,
  container: "mov",
  ...over,
});

describe("limits: what you can pick vs what gets published", () => {
  it("matches the agreed limits per place", () => {
    expect(SOURCE_MAX_SECONDS).toBe(1200);
    expect(videoLimit("post")).toBe(180);
    expect(videoLimit("story")).toBe(60);
    expect(videoLimit("dm")).toBe(300);
    expect(videoLimit("coach")).toBe(600);
    expect(videoLimit("workout")).toBe(90);
    expect(videoLimit("demo")).toBe(180);
    // Crew never goes over the storage bucket's 50 MB
    expect(videoBudget("post").max).toBe(50 * MB);
    for (const k of Object.keys(VIDEO_BUDGETS) as (keyof typeof VIDEO_BUDGETS)[]) expect(VIDEO_BUDGETS[k].target).toBeLessThan(VIDEO_BUDGETS[k].max);
  });

  it("the server and the database hold every place to the same numbers", () => {
    const sql = read("supabase/migrations/20261210090000_video_limits.sql");
    expect(sql).toContain("v_max numeric := CASE WHEN NEW.story_only THEN 60 WHEN NEW.completion_id IS NOT NULL THEN 90 ELSE 180 END;");
    expect(sql).toContain("public.media_video_allowed('community-media', NEW.media_path, v_max, 52428800)");
    expect(sql).toContain("public.media_video_allowed('community-media', NEW.media_path, 60, 52428800)");
    expect(sql).toContain("public.chat_attachments_video_guard(NEW.attachments, CASE WHEN TG_OP = 'UPDATE' THEN OLD.attachments END, 600, 209715200)");
    expect(sql).toContain("CASE WHEN v_kind IN ('direct', 'crew') THEN 125829120 ELSE 209715200 END");
    expect(sql).toContain("CASE WHEN v_kind IN ('direct', 'crew') THEN 300 ELSE 600 END");
    expect(sql).toContain("public.media_video_allowed('progress-media', NEW.storage_path, 600, 209715200)");
    expect(sql).toContain("public.media_video_allowed('form-uploads', NEW.storage_path, 600, 209715200)");
    expect(sql).toContain("public.media_video_allowed('broadcast-media', NEW.video_path, 600, 209715200)");
    expect(VIDEO_BUDGETS.dm.max).toBe(125829120);
    expect(VIDEO_BUDGETS.coach.max).toBe(209715200);
    expect(VIDEO_LIMITS.comment.seconds).toBe(60);
  });

  it("formats times the way the trimmer shows them", () => {
    expect(formatClock(42.4)).toBe("0:42");
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(725)).toBe("12:05");
    expect(limitWords(60)).toBe("60 seconds");
    expect(limitWords(180)).toBe("3 minutes");
    expect(limitWords(1200)).toBe("20 minutes");
  });
});

describe("plan: trim and shrink on the phone, never send what's thrown away", () => {
  it("opens the trimmer only when a clip is over its place's limit", () => {
    expect(needsTrim(iphone(45), "story", true)).toBe(false);
    expect(needsTrim(iphone(75), "story", true)).toBe(true);
    expect(needsTrim(iphone(75), "post", true)).toBe(false);
    expect(needsTrim(iphone(15 * 60), "coach", true)).toBe(true);
    expect(defaultTrim(iphone(15 * 60), "story", true)).toEqual({ start: 0, end: 60 });
  });

  it("refuses only what can't be opened: over 20 minutes, or unreadable", () => {
    expect(sourceProblem(iphone(19 * 60))).toBeNull();
    expect(sourceProblem(iphone(21 * 60))).toMatch(/under 20 minutes/);
    expect(sourceProblem({ bytes: 10, duration: 0 })).toMatch(/Couldn't read/);
  });

  it("re-encodes a heavy selection to 720p at 30 fps, sized for its budget (shape kept, never cropped)", () => {
    const p = planVideo(iphone(600), { start: 120, end: 300 }, "post", { canEncode: true });
    expect(p.mode).toBe("transcode");
    if (p.mode !== "transcode") return;
    expect(p.start).toBe(120);
    expect(p.end).toBe(300);
    expect(Math.max(p.width, p.height)).toBe(TARGET_LONG_EDGE);
    expect(p.width / p.height).toBeCloseTo(1080 / 1920, 2);
    expect(p.frameRate).toBe(30);
    expect(p.estBytes).toBeLessThanOrEqual(VIDEO_BUDGETS.crew.target);
    // a 3 minute copy (~340 MB) can't go to Crew: no copy to fall back on
    expect(p.copyFallback).toBeNull();
  });

  it("a short heavy selection has a copy to fall back on if this phone encodes too slowly", () => {
    const p = planVideo(iphone(300), { start: 30, end: 45 }, "story", { canEncode: true });
    expect(p.mode).toBe("transcode");
    if (p.mode === "transcode") expect(p.copyFallback?.estBytes).toBeGreaterThan(20 * MB);
  });

  it("sends a small or already lean clip as it is (whole) or cut without re-encoding (trimmed)", () => {
    const lean: SourceInfo = { ...iphone(40), width: 720, height: 1280, fps: 30, codec: "avc", container: "mp4", bytes: 40 * 300_000 };
    expect(isLean(lean)).toBe(true);
    expect(planVideo(lean, null, "post", { canEncode: true })).toEqual({ mode: "original" });
    expect(planVideo(lean, { start: 5, end: 20 }, "post", { canEncode: true }).mode).toBe("copy");
    const tiny = iphone(2, { bytes: MIN_BYTES_TO_COMPRESS - 1 });
    expect(planVideo(tiny, null, "dm", { canEncode: true })).toEqual({ mode: "original" });
  });

  it("a WebM (Android camera) cut is re-encoded when it can be: WebM has no edit lists to start on the exact frame", () => {
    const webm: SourceInfo = { ...iphone(50), width: 720, height: 1280, fps: 30, codec: "vp8", audioCodec: "opus", container: "webm", bytes: 50 * 250_000 };
    expect(planVideo(webm, null, "story", { canEncode: true })).toEqual({ mode: "original" });
    expect(planVideo(webm, { start: 10, end: 20 }, "story", { canEncode: true }).mode).toBe("transcode");
    expect(planVideo(webm, { start: 10, end: 20 }, "story", { canEncode: false }).mode).toBe("copy");
  });

  it("a phone that can't encode video sends a straight cut, as long as fits its budget (and says so)", () => {
    const src = iphone(600);
    const most = maxSelectable(src, "post", false);
    expect(most).toBeGreaterThan(15);
    expect(most).toBeLessThan(30);
    expect(needsTrim(src, "post", false)).toBe(true);
    const ok = planVideo(src, { start: 100, end: 100 + most }, "post", { canEncode: false });
    expect(ok.mode).toBe("copy");
    if (ok.mode === "copy") expect(ok.estBytes).toBeLessThanOrEqual(VIDEO_BUDGETS.crew.target);
    const no = planVideo(src, { start: 100, end: 160 }, "post", { canEncode: false });
    expect(no.mode).toBe("reject");
    if (no.mode === "reject") expect(no.reason).toMatch(/can't shrink video/);
  });

  it("never plans past a place's limit", () => {
    const p = planVideo(iphone(600), { start: 0, end: 75 }, "story", { canEncode: true });
    expect(p).toEqual({ mode: "reject", reason: expect.stringMatching(/60 seconds max/) });
  });

  it("a long coach video squeezes into its budget at a lower size before it would look bad", () => {
    const p = planVideo(iphone(1100), { start: 0, end: 600 }, "coach", { canEncode: true });
    expect(p.mode).toBe("transcode");
    if (p.mode !== "transcode") return;
    expect(p.estBytes).toBeLessThanOrEqual(VIDEO_BUDGETS.coach.target * 1.01);
    expect(p.videoBitrate).toBeGreaterThanOrEqual(700_000);
  });

  it("estimates a straight cut by its share of the file", () => {
    expect(copyBytes(iphone(100), null)).toBe(iphone(100).bytes);
    expect(copyBytes(iphone(100), { start: 0, end: 10 })).toBeGreaterThan(iphone(100).bytes / 10);
    expect(copyBytes(iphone(100), { start: 0, end: 10 })).toBeLessThan(iphone(100).bytes / 9);
    expect(outputSize({ width: 3840, height: 2160 }, TARGET_LONG_EDGE)).toEqual({ width: 1280, height: 720 });
    expect(outputSize({ width: 640, height: 360 }, TARGET_LONG_EDGE)).toEqual({ width: 640, height: 360 });
  });

  it("gives up a slow re-encode for the copy only once it clearly costs more time than the upload it saves", () => {
    const base = { copyBytes: 38 * MB, outBytes: 6 * MB, uplinkBytesPerSec: 1.25 * MB };
    // warm-up: never decided in the first seconds
    expect(encodeTooSlow({ ...base, elapsedMs: 2_600, progress: 0.03 })).toBe(false);
    // the real iPhone case: 3% after 2.7s held on to 5s → ~2.8 minutes projected for 25s saved
    expect(encodeTooSlow({ ...base, elapsedMs: 5_000, progress: 0.03 })).toBe(true);
    // ~1x real time on a 20s clip: worth it
    expect(encodeTooSlow({ ...base, elapsedMs: 5_000, progress: 0.2 })).toBe(false);
  });
});

describe("timeline: the trimmer's handles and filmstrip", () => {
  it("shows a short video whole, a long one in a window with an overview", () => {
    expect(viewSpan(45, 60)).toBe(45);
    expect(needsOverview(45, 60)).toBe(false);
    expect(viewSpan(600, 60)).toBe(90);
    expect(needsOverview(600, 60)).toBe(true);
    expect(viewSpan(240, 180)).toBe(240);
  });

  it("keeps the handles inside the video, in order, and never longer than allowed", () => {
    const sel = { start: 10, end: 40 };
    expect(setStart(sel, -5, 60, 100)).toEqual({ start: 0, end: 40 });
    expect(setStart(sel, 39.9, 60, 100).start).toBe(39);
    expect(setEnd(sel, 200, 60, 100)).toEqual({ start: 10, end: 70 });
    expect(setEnd(sel, 5, 60, 100).end).toBe(11);
    expect(setStart({ start: 70, end: 100 }, 10, 60, 100).start).toBe(40);
    expect(shiftSelection(sel, 80, 100)).toEqual({ start: 70, end: 100 });
    expect(shiftSelection(sel, -50, 100)).toEqual({ start: 0, end: 30 });
    expect(centerSelectionOn(sel, 50, 100)).toEqual({ start: 35, end: 65 });
    expect(normalizeSelection({ start: 5, end: 500 }, 60, 100)).toEqual({ start: 5, end: 65 });
    expect(normalizeSelection(null, 60, 30)).toEqual({ start: 0, end: 30 });
  });

  it("maps time to the strip and back", () => {
    expect(timeToX(30, 0, 60, 300)).toBe(150);
    expect(xToTime(150, 0, 60, 300)).toBe(30);
    expect(viewAround({ start: 500, end: 560 }, 90, 600)).toBe(485);
    expect(clampView(580, 90, 600)).toBe(510);
    expect(edgePan(5, 300, 90)).toBeLessThan(0);
    expect(edgePan(296, 300, 90)).toBeGreaterThan(0);
    expect(edgePan(150, 300, 90)).toBe(0);
  });

  it("lays frames on a fixed grid so panning reuses them", () => {
    const a = tileGrid(0, 90, 9, 600);
    const b = tileGrid(5, 90, 9, 600);
    expect(a[0]).toEqual({ t: 5, at: 0, step: 10 });
    expect(b[0].at).toBe(0);
    expect(b[1].t).toBe(15);
    expect(tileGrid(595, 90, 9, 600).at(-1)!.t).toBeLessThanOrEqual(600);
  });
});

describe("every place a video can be picked uses the trimmer and the pipeline", () => {
  it("Crew: studio (post / story / workout), composer, edit sheet, comments", () => {
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain('coverCount: card || shot ? 1 : 0, videoContext: story ? "story" : videoContext })');
    expect(studio).toContain("{tray.trimmer}");
    const picker = read("src/components/community/share-workout-picker.tsx");
    expect(picker).toContain('startAs={story ? "story" : "post"}');
    expect(picker).toContain('videoContext={activeMode === "workout" ? "workout" : "post"}');
    expect(read("src/components/community/community-screen.tsx")).toContain("trigger={t} story />");
    expect(read("src/components/community/share-composer.tsx")).toContain("pickMedia(file, { context: videoContext, trim: trimmer.request })");
    expect(read("src/components/community/comments-sheet.tsx")).toContain('pickMedia(file, { context: "comment", trim: trimmer.request })');
    expect(read("src/components/community/edit-post-sheet.tsx")).toContain('videoContext: post?.completion_id ? "workout" : "post"');
    const tray = read("src/components/community/slide-tray.tsx");
    expect(tray).toContain("const next = await retrimPicked(old, trimmer.request, videoContext);");
    expect(tray).toContain("job.ctl?.abort();");
  });

  it("chats: 10 minutes with the coach, 5 in member chats, trimmed before it's a chip", () => {
    const shared = read("src/components/chat-shared.tsx");
    expect(shared).toContain("export async function prepareChatFiles(files: File[], context: VideoContext, trim: TrimFn)");
    expect(shared).not.toContain("raceVideoUpload");
    expect(read("src/components/message-thread.tsx")).toContain('prepareChatFiles(Array.from(files), "coach", trimmer.request)');
    expect(read("src/components/direct-chat.tsx")).toContain('videoContext="dm"');
    expect(read("src/components/crew-chat.tsx")).toContain('videoContext="dm"');
    expect(read("src/components/composer-plus-menu.tsx").match(/preloadVideoEngine\(\)/g)?.length).toBe(2);
  });

  it("progress videos, check-in videos and broadcasts", () => {
    expect(read("src/components/progress/progress-section.tsx")).toContain('pickVideo(f, "coach", { trim: trimmer.request })');
    expect(read("src/components/forms/client-form-renderer.tsx")).toContain('pickVideo(file, "coach", { trim: trimmer.request })');
    expect(read("src/components/broadcast-composer.tsx")).toContain('pickVideo(f, "coach", { trim: trimmer.request })');
    expect(read("src/lib/native-forms.ts")).toContain('bucket: "form-uploads"');
    expect(read("src/lib/broadcasts.ts")).toContain('bucket: "broadcast-media"');
  });

  it("the trimmer: preview never cropped, handles as sliders, an overview for long videos", () => {
    const t = read("src/components/video-trimmer.tsx");
    expect(t).toContain('className="absolute inset-0 h-full w-full object-contain"');
    expect(t).toContain('aria-label="Start of clip"');
    expect(t).toContain('aria-label="End of clip"');
    expect(t).toContain("data-trim-overview");
    expect(t).toContain("selected · {formatClock(maxLen)} max");
  });

  it("uploads resume, and the server re-reads each video before it can be published", () => {
    const up = read("src/lib/lift-video-storage-upload.ts");
    expect(up).toContain("upload.resumeFromPreviousUpload(previous[0])");
    expect(up).toContain("fingerprint: async (f: File) => `jf-${bucket}/${path}:${f.size}`");
    const verify = read("src/lib/video-verify.functions.ts");
    expect(verify).toContain('db.rpc("media_video_object"');
    expect(verify).toContain("if (obj.owner !== userId)");
    expect(verify).toContain("new mb.UrlSource(signed.signedUrl");
  });
});
