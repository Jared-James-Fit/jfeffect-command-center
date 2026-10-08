import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compressVideoForChat, compressionBudgetMs, planCompression, projectedTooSlow, MIN_BYTES_TO_COMPRESS, TARGET_LONG_EDGE,
} from "@/lib/video-compress";

const MB = 1024 * 1024;

describe("planCompression (when shrinking a video is worth it)", () => {
  it("shrinks a 10s 4K portrait iPhone clip to 720p and 30 fps", () => {
    expect(planCompression({ bytes: 55 * MB, durationSec: 10, displayWidth: 2160, displayHeight: 3840, fps: 60 }))
      .toEqual({ height: TARGET_LONG_EDGE, frameRate: 30 });
  });

  it("shrinks a 10s 1080p landscape clip by width and keeps 30 fps as is", () => {
    expect(planCompression({ bytes: 12 * MB, durationSec: 10, displayWidth: 1920, displayHeight: 1080, fps: 30 }))
      .toEqual({ width: TARGET_LONG_EDGE });
  });

  it("re-encodes a 720p clip only when its bitrate is high", () => {
    expect(planCompression({ bytes: 30 * MB, durationSec: 10, displayWidth: 1280, displayHeight: 720, fps: 30 })).toEqual({});
    expect(planCompression({ bytes: 5 * MB, durationSec: 20, displayWidth: 1280, displayHeight: 720, fps: 30 })).toBeNull();
  });

  it("leaves small, very long or unreadable videos alone", () => {
    expect(planCompression({ bytes: MIN_BYTES_TO_COMPRESS - 1, durationSec: 5, displayWidth: 3840, displayHeight: 2160 })).toBeNull();
    expect(planCompression({ bytes: 900 * MB, durationSec: 11 * 60, displayWidth: 1920, displayHeight: 1080 })).toBeNull();
    expect(planCompression({ bytes: 20 * MB, durationSec: 0, displayWidth: 1920, displayHeight: 1080 })).toBeNull();
    expect(planCompression({ bytes: 20 * MB, durationSec: 10, displayWidth: 0, displayHeight: 0 })).toBeNull();
  });
});

describe("slow-device bailout", () => {
  it("allows at least 10s, or 1.5x the clip length", () => {
    expect(compressionBudgetMs(4)).toBe(10_000);
    expect(compressionBudgetMs(30)).toBe(45_000);
  });
  it("gives up early when the measured pace would blow the budget, but not during warm-up", () => {
    const budget = compressionBudgetMs(10); // 15s
    expect(projectedTooSlow(1_000, 0.01, budget)).toBe(false); // warm-up
    expect(projectedTooSlow(3_000, 0.5, budget)).toBe(false); // on pace for 6s
    expect(projectedTooSlow(3_000, 0.1, budget)).toBe(true); // on pace for 30s
  });
});

describe("compressVideoForChat fallbacks", () => {
  it("returns null (upload the original) where the browser has no video encoder", async () => {
    const f = new File([new Uint8Array(5 * MB)], "clip.mov", { type: "video/quicktime" });
    expect(await compressVideoForChat(f)).toBeNull();
  });

  it("refuses conversions that would drop a track, gives up when slow, and keeps only clearly smaller results", () => {
    const src = readFileSync("src/lib/video-compress.ts", "utf8");
    expect(src).toContain("if (conv.discardedTracks.length > 0) {");
    expect(src).toContain("return done(`dropped:");
    expect(src).toContain("projectedTooSlow(Date.now() - startedAt, clamped, limitMs)");
    expect(src).toContain("if (buffer.byteLength > file.size * 0.8) return done(`not-smaller:");
    expect(src).toContain('return (await compressVideoDetailed(file, "avc", opts)).file;');
    expect(src).toContain('fastStart: "in-memory"');
    expect(src).toContain('await import("mediabunny")'); // lazy: only loaded when a video is sent
  });
});

describe("chat uploads use it", () => {
  it("starts the poster, the original upload and the compressed copy together", () => {
    const shared = readFileSync("src/components/chat-shared.tsx", "utf8");
    expect(shared).toContain("captureVideoPoster(file)");
    expect(shared).toContain('compressVideoDetailed(file, "avc", { onProgress: p, signal: sig })');
    expect(shared).toContain("raceVideoUpload(");
    expect(shared.indexOf("captureVideoPoster(file)")).toBeLessThan(shared.indexOf("raceVideoUpload("));
  });

  it("warms the encoder while the picker is open, and lets big group videos through to be shrunk", () => {
    const menu = readFileSync("src/components/composer-plus-menu.tsx", "utf8");
    expect(menu.match(/preloadVideoCompressor\(\)/g)?.length).toBe(2);
    const group = readFileSync("src/components/group-message-thread.tsx", "utf8");
    expect(group).toContain('!f.type.startsWith("video/")');
  });

  it("pins the dependency in both package.json and Lovable's bun.lock", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies.mediabunny).toBe("1.61.3");
    expect(readFileSync("bun.lock", "utf8")).toContain('"mediabunny": ["mediabunny@1.61.3"');
  });
});
