import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCREEN_FILL_MAX_TRIM, screenFit } from "@/lib/photo-frame";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const clip = (width: number | null, height: number | null) => ({ type: "video" as const, width, height });
const photo = (width: number, height: number) => ({ type: "image" as const, width, height });

describe("a post's screen is the canvas (TikTok / Reels)", () => {
  // the screens on a phone: under Crew's bar to the tab bar, and the first one under the story rail
  const later = 390 / 657; // ~0.59 on a notched iPhone
  const first = 390 / 560; // ~0.70 with the story rail above

  it("a phone's 9:16 clip fills the screen, centred, a little off its top and bottom", () => {
    expect(screenFit(clip(1080, 1920), later)).toBe("cover");
    expect(screenFit(clip(1080, 1920), first)).toBe("cover"); // ~19% trimmed, under the cap
    expect(SCREEN_FILL_MAX_TRIM).toBe(0.25);
  });

  it("a wider clip shows whole across the screen with black above and below", () => {
    expect(screenFit(clip(1920, 1080), later)).toBe("contain"); // 16:9
    expect(screenFit(clip(1080, 1080), later)).toBe("contain"); // square
    expect(screenFit(clip(1080, 1350), later)).toBe("contain"); // 4:5
    // a clip exactly the screen's shape fills it, nothing cut
    expect(screenFit(clip(390, 657), later)).toBe("cover");
  });

  it("on a tall phone's whole screen a 9:16 clip fills it, a little off its sides (TikTok's); a 3:4 one shows whole", () => {
    const whole = 390 / 844; // ~0.46: the screen under the status bar, the bars floating over it
    expect(screenFit(clip(1080, 1920), whole)).toBe("cover"); // ~18% of its sides
    expect(screenFit(clip(1080, 1920), 430 / 842)).toBe("cover"); // a Pro Max home-screen app
    expect(screenFit(clip(1080, 1440), whole)).toBe("contain"); // 3:4 would lose 38%
    expect(screenFit(clip(1080, 1350), whole)).toBe("contain");
  });

  it("never trims more than a quarter: a tall clip on a short screen shows whole", () => {
    expect(screenFit(clip(1080, 1920), 0.8)).toBe("contain"); // would lose 30%
    expect(screenFit(clip(1080, 1920), 0.75)).toBe("cover"); // loses exactly 25%
  });

  it("a photo fills the screen only when it was framed for it (9:16); any other photo shows whole, as does a clip of unknown shape", () => {
    expect(screenFit(photo(1080, 1350), 1.2)).toBe("contain");
    expect(screenFit(photo(1080, 1350), later)).toBe("contain"); // 4:5
    expect(screenFit(photo(1440, 1920), later)).toBe("contain"); // an older 3:4 photo: never cut
    expect(screenFit(photo(1080, 1920), later)).toBe("cover"); // framed 9:16: a sliver off
    expect(screenFit(photo(1080, 1920), 390 / 714)).toBe("cover");
    expect(screenFit(clip(null, null), later)).toBe("contain");
    expect(screenFit(clip(1080, 1920), null)).toBe("contain");
  });

  it("the page is the canvas: each slide fits on its own, the screen measured as it changes (a sheet opening)", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("const fits = slides.map((sl) => screenFit(sl, screenRatio));");
    expect(card).toContain('<div ref={screenRef} className="absolute inset-0 overflow-hidden bg-black" data-screen-canvas data-fit={fits[0]}>');
    expect(card).toContain("const ro = new ResizeObserver(([e]) => read(e.contentRect.width, e.contentRect.height));");
    expect(card).toContain("fit={fits?.[j]}");
    // a photo on its screen shows whole; in a frame at its own shape it fills either way
    expect(card).toContain('whole ? "object-contain" : "object-cover"');
    // the card feed keeps every clip whole in its frame
    expect(card).toContain('fit = "contain",');
  });
});
