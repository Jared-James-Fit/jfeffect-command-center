import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createSignedUrlCache, type SignedUrlEntry } from "@/lib/signed-url-cache";
import { PREFETCH_MAX_BYTES, pickReleases, shouldPrefetch } from "@/lib/chat-video-store";

const tile = readFileSync("src/components/chat-video-tile.tsx", "utf8");
const shared = readFileSync("src/components/chat-shared.tsx", "utf8");
const thread = readFileSync("src/components/message-thread.tsx", "utf8");
const upload = readFileSync("src/lib/lift-video-storage-upload.ts", "utf8");
const store = readFileSync("src/lib/chat-video-store.ts", "utf8");
const sw = readFileSync("src/lib/pwa/register-sw.ts", "utf8");
const urls = readFileSync("src/hooks/use-chat-signed-urls.ts", "utf8");

function memoryStorage(initial: Array<[string, SignedUrlEntry]> = []) {
  let saved = initial;
  return { load: () => saved, save: (e: Array<[string, SignedUrlEntry]>) => { saved = e; }, get: () => saved };
}

describe("chat links survive closing the app", () => {
  it("reuses stored links on launch instead of signing (and re-downloading) again", async () => {
    const t = 10_000;
    const disk = memoryStorage([
      ["a.jpg", { url: "https://signed/a?tok=1", expiresAt: t + 5_000 }],
      ["old.jpg", { url: "https://signed/old", expiresAt: t - 1 }],
    ]);
    const sign = vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}?tok=2`])));
    const cache = createSignedUrlCache(sign, { ttlMs: 1000, now: () => t, storage: disk });
    await cache.ensure(["a.jpg", "old.jpg"]);
    expect(cache.get("a.jpg")).toBe("https://signed/a?tok=1"); // same address: the phone's cache hits
    expect(sign).toHaveBeenCalledWith(["old.jpg"]); // only the expired one is re-signed
  });

  it("stores new links, never local blob: links, and forgets everything on sign-out", async () => {
    vi.useFakeTimers();
    const disk = memoryStorage();
    const cache = createSignedUrlCache(async (paths) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])), { storage: disk });
    cache.seed("mine.jpg", "blob:local");
    await cache.ensure(["b.jpg"]);
    vi.advanceTimersByTime(500);
    expect(disk.get().map(([p]) => p)).toEqual(["b.jpg"]);
    cache.clear();
    expect(disk.get()).toEqual([]);
    vi.useRealTimers();
  });

  it("signs chat links for a day and keeps them on the phone", () => {
    expect(urls).toContain("const SIGN_SECONDS = 24 * 3600;");
    expect(urls).toContain("storage: localStore");
  });
});

describe("chat videos kept on the phone", () => {
  it("downloads ahead only clips small enough, and never in data-saver mode", () => {
    expect(shouldPrefetch(4_000_000, false)).toBe(true);
    expect(shouldPrefetch(undefined, false)).toBe(true); // checked against content-length when it starts
    expect(shouldPrefetch(PREFETCH_MAX_BYTES + 1, false)).toBe(false);
    expect(shouldPrefetch(0, false)).toBe(false);
    expect(shouldPrefetch(4_000_000, true)).toBe(false);
  });

  it("releases the least recently watched clips first, never one just played", () => {
    const now = 1_000_000;
    const entries: Array<[string, { bytes: number; usedAt: number }]> = [
      ["old", { bytes: 50, usedAt: now - 3_600_000 }],
      ["mid", { bytes: 50, usedAt: now - 1_800_000 }],
      ["playing", { bytes: 50, usedAt: now - 1_000 }],
    ];
    expect(pickReleases(entries, 100, now)).toEqual(["old"]);
    expect(pickReleases(entries, 10, now)).toEqual(["old", "mid"]);
    expect(pickReleases(entries, 200, now)).toEqual([]);
  });

  it("plays the local copy on tap, streams (with the connection to itself) otherwise", () => {
    expect(tile).toContain("const localSrc = localChatVideoUrl(path);");
    expect(tile).toContain("if (!localSrc) pauseChatVideoPrefetch();");
    expect(tile).toContain("playNativeFullscreen(playSrc, fallback)");
    expect(tile).toContain("warmChatVideo(path, { url: src, size })");
    for (const src of [shared, thread]) expect(src).toContain("path={att.storage_path}");
    expect(shared).toContain("keepChatVideo(path, sentFile);");
  });

  it("isn't wiped by the launch-time cache cleanup, but is on sign-out", () => {
    expect(store).toContain('const CACHE_NAME = "chat-videos-v1";');
    expect(sw).toContain('k.startsWith("jf-")');
    expect(sw).toContain("m.clearChatVideos()");
  });
});

describe("upload cache header", () => {
  it("sends a real Cache-Control value so phones may keep chat media", () => {
    expect(upload).toContain('xhr.setRequestHeader("cache-control", `max-age=${CACHE_SECONDS}`);');
    expect(upload).not.toContain('setRequestHeader("cache-control", "3600")');
  });
});
