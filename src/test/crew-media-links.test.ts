import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createSignedUrlCache,
  localSignedUrlStorage,
  type SignedUrlEntry,
} from "@/lib/signed-url-cache";
import {
  CREW_SIGN_SECONDS,
  CREW_URLS_STORAGE_KEY,
  cachedCommunityUrls,
  crewUrlCache,
  signCommunityPaths,
} from "@/lib/community-media";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

function memoryLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

describe("Crew's links stay the same across app opens", () => {
  it("signed for a day, kept on the phone, refreshed an hour early, cleared on sign-out", () => {
    expect(CREW_SIGN_SECONDS).toBe(24 * 3600);
    expect(CREW_URLS_STORAGE_KEY).toBe("jf-crew-signed-urls-v1");
    const media = read("src/lib/community-media.ts");
    expect(media).toContain("const CREW_REUSE_MS = (CREW_SIGN_SECONDS - 3600) * 1000;");
    expect(media).toContain("storage: localSignedUrlStorage(CREW_URLS_STORAGE_KEY)");
    const sw = read("src/lib/pwa/register-sw.ts");
    expect(sw).toContain("m.clearCrewSignedUrls()");
    expect(sw).toContain("m.clearAvatarSignedUrls()");
  });

  it("a page whose links are all on the phone paints on its first frame, with no round trip", async () => {
    crewUrlCache.seed("u/a.jpg", "https://x/sign/a?token=1");
    crewUrlCache.seed("u/film/1.mp4", "https://x/sign/1?token=1");
    expect(cachedCommunityUrls(["u/a.jpg", null, "u/film/1.mp4", "app:card.png", "https://gif/x.gif"])).toEqual({
      "u/a.jpg": "https://x/sign/a?token=1",
      "u/film/1.mp4": "https://x/sign/1?token=1",
      "app:card.png": "/card.png",
      "https://gif/x.gif": "https://gif/x.gif",
    });
    // one missing: the page signs it first (undefined = no head start)
    expect(cachedCommunityUrls(["u/a.jpg", "u/new.jpg"])).toBeUndefined();
    expect(cachedCommunityUrls([null])).toBeUndefined();
    // and signing what's already there asks the server for nothing
    await expect(signCommunityPaths(["u/a.jpg", "u/film/1.mp4"])).resolves.toEqual({
      "u/a.jpg": "https://x/sign/a?token=1",
      "u/film/1.mp4": "https://x/sign/1?token=1",
    });
    crewUrlCache.clear();
  });

  it("every feed read starts from the links on the phone", () => {
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("initialData: () => cachedCommunityUrls([...covers, ...extras]),");
    expect(q).toContain("initialData: () => (path ? cachedCommunityUrls([path])?.[path] : undefined),");
    expect(q.match(/initialDataUpdatedAt: \(\) => Date\.now\(\),/g)?.length).toBe(4);
  });
});

describe("photos: one request for every face on screen, kept for a day", () => {
  it("signed in batches and kept on the phone", () => {
    const av = read("src/components/user-avatar.tsx");
    expect(av).toContain('createSignedUrls(paths, AVATAR_SIGN_SECONDS)');
    expect(av).not.toContain(".createSignedUrl(value");
    expect(av).toContain("storage: localSignedUrlStorage(AVATAR_URLS_STORAGE_KEY)");
    expect(av).toContain("return avatarUrlCache.ensure([...b]);");
  });

  it("a cache keeps at most what it's told on the phone, the ones lasting longest", async () => {
    const ls = memoryLocalStorage();
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    try {
      let t = 1_000;
      const cache = createSignedUrlCache(
        async (paths) => Object.fromEntries(paths.map((p) => [p, `url:${p}`])),
        { ttlMs: 60_000, now: () => t, storage: localSignedUrlStorage("k"), maxStored: 2 },
      );
      await cache.ensure(["a"]);
      t += 10;
      await cache.ensure(["b"]);
      t += 10;
      await cache.ensure(["c"]);
      await new Promise((r) => setTimeout(r, 450));
      const saved = JSON.parse(ls.raw.get("k")!) as Array<[string, SignedUrlEntry]>;
      expect(saved.map(([p]) => p)).toEqual(["c", "b"]);
      // the next launch starts with them
      const again = createSignedUrlCache(async () => ({}), { ttlMs: 60_000, now: () => t, storage: localSignedUrlStorage("k") });
      expect(again.get("c")).toBe("url:c");
      expect(again.get("a")).toBeUndefined();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
