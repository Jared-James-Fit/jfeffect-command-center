import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HD_LEAN_BITRATE, HD_LONG_EDGE, HD_MIN_BITRATE, HD_VIDEO_BITRATE, TARGET_LONG_EDGE, isLean, planVideo, type SourceInfo } from "@/lib/video-edit/plan";
import { VIDEO_BUDGETS } from "@/lib/video-edit/limits";

const MB = 1024 * 1024;
/** The Crew camera's own recording: 1080 × 1920 H.264 at ~6.2 Mbps (recorderBitrate), 30 fps. */
const camClip = (seconds: number, over: Partial<SourceInfo> = {}): SourceInfo => ({
  duration: seconds,
  bytes: Math.round((seconds * 6_350_000) / 8),
  width: 1080,
  height: 1920,
  codec: "avc1.640028",
  audioCodec: "aac",
  hasAudio: true,
  fps: 30,
  container: "mp4",
  ...over,
});
/** An iPhone's own 4K60 HEVC clip from Photos (~45 Mbps). */
const photos4k = (seconds: number): SourceInfo => ({ duration: seconds, bytes: Math.round((seconds * 45_000_000) / 8), width: 2160, height: 3840, codec: "hevc", audioCodec: "aac", hasAudio: true, fps: 60, container: "mov" });

describe("Crew clips keep 1080p (Nov 23 2026)", () => {
  it("the camera's own 1080p recording goes up as it is: no re-encode, no lost detail", () => {
    expect(isLean(camClip(20), true)).toBe(true);
    expect(isLean(camClip(20), false)).toBe(false);
    expect(planVideo(camClip(20), null, "story", { canEncode: true, hd: true })).toEqual({ mode: "original" });
    // trimmed: cut without re-encoding
    expect(planVideo(camClip(40), { start: 5, end: 25 }, "post", { canEncode: true, hd: true }).mode).toBe("copy");
  });

  it("without hd (a comment, a coach chat, a phone without a 1080p encoder) it's 720p as before", () => {
    const p = planVideo(camClip(20), null, "story", { canEncode: true });
    expect(p.mode).toBe("transcode");
    if (p.mode === "transcode") expect(Math.max(p.width, p.height)).toBe(TARGET_LONG_EDGE);
    // hd asked for but the phone can't encode: never a 1080p plan
    expect(planVideo(photos4k(20), null, "story", { canEncode: false, hd: true }).mode).not.toBe("transcode");
  });

  it("a heavy clip from Photos is re-encoded at 1080p while the place's budget gives it the bits", () => {
    const story = planVideo(photos4k(60), null, "story", { canEncode: true, hd: true });
    expect(story.mode).toBe("transcode");
    if (story.mode !== "transcode") return;
    expect(Math.max(story.width, story.height)).toBe(HD_LONG_EDGE);
    expect(story.width / story.height).toBeCloseTo(9 / 16, 2);
    expect(story.videoBitrate).toBeGreaterThanOrEqual(HD_MIN_BITRATE);
    expect(story.videoBitrate).toBeLessThanOrEqual(HD_VIDEO_BITRATE);
    expect(story.estBytes).toBeLessThanOrEqual(VIDEO_BUDGETS.crew.target);
    expect(story.frameRate).toBe(30);
    const short = planVideo(photos4k(15), null, "post", { canEncode: true, hd: true });
    if (short.mode === "transcode") expect(short.videoBitrate).toBe(HD_VIDEO_BITRATE);
  });

  it("a long post squeezes into 720p rather than a starved 1080p", () => {
    const p = planVideo(photos4k(180), null, "post", { canEncode: true, hd: true });
    expect(p.mode).toBe("transcode");
    if (p.mode === "transcode") {
      expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(TARGET_LONG_EDGE);
      expect(p.estBytes).toBeLessThanOrEqual(VIDEO_BUDGETS.crew.target * 1.01);
    }
  });

  it("never upscales: a 720p source stays 720p", () => {
    const small: SourceInfo = { ...photos4k(30), width: 720, height: 1280, bytes: 30 * 4 * MB };
    const p = planVideo(small, null, "story", { canEncode: true, hd: true });
    if (p.mode === "transcode") expect(Math.max(p.width, p.height)).toBe(1280);
  });

  it("a 1080p clip heavier than a phone camera's own bitrate is still re-encoded", () => {
    const heavy = camClip(20, { bytes: Math.round((20 * (HD_LEAN_BITRATE + 3_000_000)) / 8) });
    expect(isLean(heavy, true)).toBe(false);
    expect(planVideo(heavy, null, "story", { canEncode: true, hd: true }).mode).toBe("transcode");
  });

  it("Crew uploads ask for it (never a comment); the set videos' film copies and chats don't", () => {
    const cm = readFileSync("src/lib/community-media.ts", "utf8");
    expect(cm).toMatch(/v\.context !== "comment" && \(await canEncodeHd\(/);
    expect(cm).toContain("hd }), poster: null");
    expect(readFileSync("src/lib/video-edit/pipeline.ts", "utf8")).toContain("graded, hd: o.hd }");
    expect(readFileSync("src/lib/set-videos/feed-copy.ts", "utf8")).not.toMatch(/hd:/);
    expect(readFileSync("src/components/chat-shared.tsx", "utf8")).not.toMatch(/hd:/);
  });
});

import { crewQualities, needsDownscale, qualityLabel, readCrewQuality, recordSize, saveCrewQuality, CREW_QUALITY_KEY } from "@/lib/camera/crew-quality";

describe("the Crew camera's HD · 4K switch (Nov 23 2026)", () => {
  it("offers 4K only where the camera reaches it; one that won't say is offered both", () => {
    expect(crewQualities({ width: { max: 4032 }, height: { max: 3024 } })).toEqual(["hd", "4k"]);
    expect(crewQualities({ width: { max: 3840 }, height: { max: 2160 } })).toEqual(["hd", "4k"]);
    expect(crewQualities({ width: { max: 1920 }, height: { max: 1080 } })).toEqual(["hd"]);
    expect(crewQualities(null)).toEqual(["hd", "4k"]);
  });

  it("says what the camera is giving, by the picture's short side, never what was asked for", () => {
    expect(qualityLabel(2160, 3840)).toBe("4K");
    expect(qualityLabel(1080, 1920)).toBe("HD");
    expect(qualityLabel(1440, 1920)).toBe("HD");
    expect(qualityLabel(720, 1280)).toBe("720p");
    expect(qualityLabel(480, 640)).toBe("SD");
    expect(qualityLabel(0, 0)).toBeNull();
  });

  it("a clip is recorded at most 1080p: a 4K camera is drawn down, its shape kept", () => {
    expect(recordSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(recordSize(3024, 4032)).toEqual({ width: 1440, height: 1920 });
    expect(recordSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(needsDownscale(2160, 3840)).toBe(true);
    expect(needsDownscale(1080, 1920)).toBe(false);
  });

  it("HD to start, 4K remembered on the phone", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readCrewQuality(s)).toBe("hd");
    saveCrewQuality("4k", s);
    expect(store.get(CREW_QUALITY_KEY)).toBe("4k");
    expect(readCrewQuality(s)).toBe("4k");
    expect(readCrewQuality({ getItem: () => "8k" })).toBe("hd");
  });

  it("the camera asks for the quality picked, the tap that opens it asks the same, and the switch sits top right", () => {
    const prime = readFileSync("src/lib/camera/camera-prime.ts", "utf8");
    expect(prime).toContain("quality: CrewQuality = readCrewQuality()");
    const studio = readFileSync("src/components/community/share-studio.tsx", "utf8");
    expect(studio).toContain("takePrimedCamera(studioCameraAsk(facing, null, quality))");
    expect(studio).toContain("}, [shooting, video, facing, camTry, quality]);");
    expect(studio).toContain("data-studio-quality=");
    expect(studio).toContain('toast("This camera films in HD here")');
    // the compositor never records bigger than 1080p
    const comp = readFileSync("src/lib/camera/zoom-compositor.ts", "utf8");
    expect(comp).toContain("const out = recordSize(vw, vh, maxLong);");
  });
});
