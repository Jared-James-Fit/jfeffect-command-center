import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { burstTilt } from "@/components/community/reaction-button";
import { riseCount } from "@/components/community/engagement-pop";
import { isPhone, lockPortrait, phoneOnItsSide } from "@/lib/portrait-only";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const css = read("src/styles.css");

describe("likes and reposts animate the way Instagram's do (Nov 13 2026)", () => {
  it("a double-tap's ❤️ springs in where the finger was, tilted, then floats up and goes", () => {
    const btn = read("src/components/community/reaction-button.tsx");
    expect(btn).toContain("x = Math.round(e.clientX - r.left);");
    expect(btn).toContain('style={{ left: x ?? "50%", top: y ?? "50%", ["--burst-r" as string]: `${burstTilt(n)}deg` }}');
    expect(css).toContain("0% { transform: translate(-50%, -50%) rotate(var(--burst-r, 0deg)) scale(0.2); opacity: 0; }");
    expect(css).toContain("100% { transform: translate(-50%, calc(-50% - 120px)) rotate(var(--burst-r, 0deg)) scale(0.8); opacity: 0; }");
    // a different tilt each time, never past 15°
    const tilts = [1, 2, 3, 4, 5, 6].map(burstTilt);
    expect(new Set(tilts).size).toBe(tilts.length);
    for (const t of tilts) expect(Math.abs(t)).toBeLessThanOrEqual(15);
    // everywhere a post can be double-tapped: its screen, the cards, its page, the full-screen clips
    expect(read("src/components/community/post-card.tsx")).toContain("<ReactionBurst n={burst.n} x={burst.x} y={burst.y}");
    expect(read("src/components/community/post-detail.tsx")).toContain("<ReactionBurst n={burst.n} x={burst.x} y={burst.y}");
    expect(read("src/components/community/reels-viewer.tsx")).toContain("<ReactionBurst n={burst.n} x={burst.x} y={burst.y} emoji={REACTION.emoji} />");
  });

  it("the heart button springs; reposting turns the arrows once as they go green", () => {
    expect(css).toContain(".community-pop { animation: community-pop 0.45s cubic-bezier(0.2, 0.8, 0.2, 1); }");
    expect(css).toContain(".repost-spin { animation: repost-spin 0.55s cubic-bezier(0.2, 0.8, 0.2, 1); }");
    expect(read("src/components/community/repost-save.tsx")).toContain('<span key={pop} className={cn("inline-flex", pop > 0 && "repost-spin")}>');
  });

  it("a post people are reacting to: several of its reactions rise out of the heart, once it's actually showing", () => {
    expect(riseCount(1, 0)).toBe(3);
    expect(riseCount(1, 4)).toBe(4);
    expect(riseCount(2, 40)).toBe(6);
    expect(riseCount(5, 2)).toBe(5);
    const pop = read("src/components/community/engagement-pop.tsx");
    // never while the first post is under the stories (its buttons hidden): that's where it used to play unseen
    expect(pop).toContain("export function useEngagementPop<T extends HTMLElement>(post: CommunityPost, hidden = false) {");
    expect(pop).toContain("}, [engaged, on, post.id, hidden]);");
    expect(css).toContain("100% { opacity: 0; transform: translate(calc(-50% + var(--rise-x, 0px)), var(--rise-y, -52px)) scale(1.15) rotate(-8deg); }");
  });
});

describe("press and hold pauses a clip, Reels' way, everywhere a clip plays", () => {
  const gestures = read("src/components/community/clip-gestures.tsx");
  it("one hook for the feed's screens, the cards, a post's page and the full-screen clips", () => {
    expect(gestures).toContain("export function useHoldToPause<T>(");
    expect(read("src/components/community/post-card.tsx")).toContain("const hold = useHoldToPause<Element>(");
    expect(read("src/components/community/post-detail.tsx")).toContain("const hold = useHoldToPause<Element>(");
    expect(read("src/components/community/reels-viewer.tsx")).toContain("const hold = useHoldToPause<true>(");
  });

  it("the full-screen clips: a tap is the sound (said in the middle), a hold pauses with everything out of the way", () => {
    const reels = read("src/components/community/reels-viewer.tsx");
    expect(reels).toContain("flashSound(toggleSound());");
    expect(reels).toContain("(_t, on) => setPaused(on),");
    expect(reels).toContain("if (hold.justReleased()) return;");
    expect(reels).toContain('hold.holding && "opacity-0 [&_*]:pointer-events-none"');
    // no play button left behind: letting go plays it again
    expect(reels).not.toContain("<Play ");
  });
});

describe("phones stay upright", () => {
  const phone = { screenW: 393, screenH: 852, coarse: true };
  afterEach(() => vi.unstubAllGlobals());

  it("asks the browser to lock portrait on a phone (Android takes it), never on a tablet or computer, and never throws", async () => {
    expect(isPhone(phone)).toBe(true);
    expect(isPhone({ ...phone, coarse: false })).toBe(false);
    expect(isPhone({ screenW: 820, screenH: 1180, coarse: true })).toBe(false);
    const lock = vi.fn(async () => undefined);
    vi.stubGlobal("screen", { orientation: { type: "portrait-primary", lock } });
    expect(await lockPortrait(phone)).toBe(true);
    expect(lock).toHaveBeenCalledWith("portrait-primary");
    // an iPhone: no lock (or it refuses): nothing breaks, the turn-it-back screen covers it
    vi.stubGlobal("screen", { orientation: { type: "portrait-primary", lock: async () => Promise.reject(new Error("NotSupportedError")) } });
    expect(await lockPortrait(phone)).toBe(false);
    vi.stubGlobal("screen", { orientation: { type: "portrait-primary" } });
    expect(await lockPortrait(phone)).toBe(false);
    expect(await lockPortrait({ screenW: 1440, screenH: 900, coarse: false })).toBe(false);
    expect(phoneOnItsSide({ ...phone, type: "landscape-primary" })).toBe(true);
    const comp = read("src/components/portrait-only.tsx");
    expect(comp).toContain("void lockPortrait();");
    expect(comp).toContain('document.addEventListener("visibilitychange", back);');
  });
});
