import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));

import {
  NOTICE_GAP_MS,
  NOTICE_KEY,
  autoplayNoticeWords,
  noteAutoplayRefused,
  resetAutoplayNotice,
  shouldShowAutoplayNotice,
} from "@/lib/autoplay-notice";

describe("when it's time to say why videos need a tap", () => {
  const now = 1_800_000_000_000;
  it("the first time it happens on this phone, while the app is on screen", () => {
    expect(
      shouldShowAutoplayNotice({ shownThisLaunch: false, lastShownAt: null, visible: true }, now),
    ).toBe(true);
    expect(
      shouldShowAutoplayNotice({ shownThisLaunch: false, lastShownAt: null, visible: false }, now),
    ).toBe(false);
  });

  it("once a launch, and not again on this phone for a week", () => {
    expect(
      shouldShowAutoplayNotice({ shownThisLaunch: true, lastShownAt: null, visible: true }, now),
    ).toBe(false);
    expect(
      shouldShowAutoplayNotice(
        { shownThisLaunch: false, lastShownAt: now - NOTICE_GAP_MS + 1, visible: true },
        now,
      ),
    ).toBe(false);
    expect(
      shouldShowAutoplayNotice(
        { shownThisLaunch: false, lastShownAt: now - NOTICE_GAP_MS, visible: true },
        now,
      ),
    ).toBe(true);
  });

  it("names Low Power Mode on an iPhone and where to turn it off; a saver elsewhere", () => {
    const ios = autoplayNoticeWords(true);
    expect(ios.body).toContain("Low Power Mode");
    expect(ios.body).toContain("Settings → Battery");
    expect(ios.body).toContain("Tap a video to play it");
    const other = autoplayNoticeWords(false);
    expect(other.body).not.toContain("Low Power Mode");
    expect(other.body).toContain("Tap a video to play it");
    for (const w of [ios, other]) expect(`${w.title} ${w.body}`).not.toMatch(/—|–/);
  });
});

describe("noteAutoplayRefused shows one toast, then holds", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    toast.mockReset();
    resetAutoplayNotice();
    store = {};
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
    };
    (globalThis as unknown as { document: unknown }).document = { visibilityState: "visible" };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it("every refused clip on a screen is one heads-up, remembered on the phone", async () => {
    await noteAutoplayRefused(1000);
    await noteAutoplayRefused(1001);
    await noteAutoplayRefused(1002);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1]).toMatchObject({ id: NOTICE_KEY, action: { label: "Got it" } });
    expect(store[NOTICE_KEY]).toBe("1000");
    // the next launch inside the week: nothing
    resetAutoplayNotice();
    await noteAutoplayRefused(1000 + NOTICE_GAP_MS - 1);
    expect(toast).toHaveBeenCalledTimes(1);
    // a week on: once more
    await noteAutoplayRefused(1000 + NOTICE_GAP_MS);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("blocked storage still holds it to once a launch", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };
    await noteAutoplayRefused(1);
    await noteAutoplayRefused(2);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe("every place a clip can be refused says so", () => {
  it("the feed's pool, the full-screen clips and stories", () => {
    expect(read("src/lib/video-pool.ts")).toContain("if (on) noteAutoplayRefused();");
    const reels = read("src/components/community/reels-viewer.tsx");
    expect(reels.match(/noteAutoplayRefused\(\);/g)?.length).toBe(2);
    expect(read("src/components/community/crew-stories.tsx")).toContain(
      'if ((e as { name?: string } | null)?.name === "NotAllowedError") noteAutoplayRefused();',
    );
  });
});
