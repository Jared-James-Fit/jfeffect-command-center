import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSignedUrlCache } from "@/lib/signed-url-cache";
import { fitWithin } from "@/lib/video-poster";
import { isIOSWebKit, playNativeFullscreen } from "@/lib/native-video-fullscreen";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");
const groupThread = readFileSync("src/components/group-message-thread.tsx", "utf8");
const image = readFileSync("src/components/chat-media-attachment.tsx", "utf8");
const tile = readFileSync("src/components/chat-video-tile.tsx", "utf8");
const shared = readFileSync("src/components/chat-shared.tsx", "utf8");

function makeCache() {
  let t = 1_000;
  const calls: string[][] = [];
  const cache = createSignedUrlCache(
    async (paths) => {
      calls.push(paths);
      return Object.fromEntries(paths.map((p) => [p, `https://signed/${p}?t=${calls.length}`]));
    },
    { ttlMs: 1000, now: () => t },
  );
  return { cache, calls, advance: (ms: number) => { t += ms; } };
}

describe("signed URL cache (stops chat media from blinking/reloading)", () => {
  it("signs a path once and returns the identical URL when other messages arrive", async () => {
    const { cache, calls } = makeCache();
    await cache.ensure(["a", "b"]);
    const first = cache.get("a");
    await cache.ensure(["a", "b", "c"]); // a new message adds a path
    expect(calls).toEqual([["a", "b"], ["c"]]); // only the new one is requested
    expect(cache.get("a")).toBe(first);
  });

  it("shares one request between concurrent callers", async () => {
    const { cache, calls } = makeCache();
    await Promise.all([cache.ensure(["a"]), cache.ensure(["a", "b"]), cache.ensure(["b"])]);
    expect(calls.flat().sort()).toEqual(["a", "b"]);
  });

  it("refreshes a URL only after it nears expiry", async () => {
    const { cache, calls, advance } = makeCache();
    await cache.ensure(["a"]);
    advance(500);
    expect(cache.missing(["a"])).toEqual([]);
    advance(600);
    expect(cache.missing(["a"])).toEqual(["a"]);
    await cache.ensure(["a"]);
    expect(calls.length).toBe(2);
  });

  it("uses a seeded local URL without any request (sender's own media)", async () => {
    const { cache, calls } = makeCache();
    cache.seed("mine.jpg", "blob:local");
    await cache.ensure(["mine.jpg"]);
    expect(cache.get("mine.jpg")).toBe("blob:local");
    expect(calls).toEqual([]);
  });

  it("survives a failed request so callers can fall back", async () => {
    const cache = createSignedUrlCache(async () => { throw new Error("offline"); });
    await expect(cache.ensure(["a"])).resolves.toBeUndefined();
    expect(cache.missing(["a"])).toEqual(["a"]);
  });
});

describe("video poster + native playback helpers", () => {
  it("fits a poster inside the max size without upscaling", () => {
    expect(fitWithin(1080, 1920, 720)).toEqual({ width: 405, height: 720 });
    expect(fitWithin(300, 200, 720)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(0, 0, 720)).toEqual({ width: 0, height: 0 });
  });

  it("only takes over playback on iOS; elsewhere the in-app viewer is used", () => {
    expect(isIOSWebKit()).toBe(false); // node test env
    expect(playNativeFullscreen("https://x/y.mp4")).toBe(false);
  });
});

describe("opening a chat", () => {
  it("scrolls to the latest message before paint and only follows while the reader is at the bottom", () => {
    expect(thread).toContain("useLayoutEffect(() => {");
    expect(thread).toContain("pinnedRef");
    expect(thread).toContain("onScroll={onThreadScroll}");
    expect(thread).not.toContain("setTimeout(pin, 1500)"); // the old force-pin timers
    expect(groupThread).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(scrollerRef\.current\)/);
  });

  it("never resets a loaded image just because its signed URL string changed", () => {
    expect(image).toContain("}, [stableKey]);");
    expect(image).not.toContain("}, [stableKey, initialSignedUrl]);");
    expect(image).toContain("deferSign");
  });

  it("draws videos from a poster and plays them in one tap", () => {
    expect(tile).toContain("playNativeFullscreen(src, fallback)");
    expect(tile).toContain("expectPoster");
    expect(shared).toContain("captureVideoPoster(file)");
    expect(shared).toContain("thumbnail_storage_path");
  });
});
