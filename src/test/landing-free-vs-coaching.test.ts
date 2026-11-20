import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COACHING_APPLY_TO,
  COACHING_CTA,
  COACHING_TO,
  JOIN_CTA,
  JOIN_TO,
  LANDING_COPY,
} from "@/components/landing/landing-page";

const page = readFileSync("src/components/landing/landing-page.tsx", "utf8");
/** What a visitor reads: the file without its comments. */
const visible = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the landing page says what's free and what's paid", () => {
  it("says it in the hero, before anything else", () => {
    const hero = visible.slice(visible.indexOf("data-landing-hero"), visible.indexOf("data-landing-proof"));
    expect(hero).toContain("The app is free. Coaching with me is the paid part.");
    // both ways in, the free app first and in the brand red, coaching beside it
    expect(hero.indexOf("<PrimaryCta to={JOIN_TO}")).toBeGreaterThan(-1);
    expect(hero.indexOf("<SecondaryCta to={COACHING_TO}")).toBeGreaterThan(hero.indexOf("<PrimaryCta to={JOIN_TO}"));
  });

  it("never sells the whole thing as free", () => {
    expect(visible).not.toContain("Free to join · No card");
    expect(visible).not.toMatch(/\["\$0"/);
    expect(visible).not.toContain("free training app and crew");
  });

  it("puts the two side by side, coaching marked paid", () => {
    expect(visible).toContain('data-landing-plan="free"');
    expect(visible).toContain('data-landing-plan="coaching"');
    expect(visible).toMatch(/1:1 coaching<\/h3>\s*<div[^>]*>Paid<\/div>/);
    expect(LANDING_COPY.COACHING[0]).toBe("Everything in the app");
    expect(LANDING_COPY.FAQ.map((f) => f.q)).toEqual(
      expect.arrayContaining(["What's actually free?", "What does coaching cost?", "Can I start free and get coaching later?"]),
    );
  });

  it("each way in goes where it says", () => {
    expect(JOIN_TO).toBe("/join");
    expect(COACHING_APPLY_TO).toBe("/coaching/apply");
    expect(COACHING_TO).toBe("/coaching");
    expect(JOIN_CTA).toBe("Join free");
    expect(COACHING_CTA).toBe("Apply for coaching");
  });

  it("claims only what's checked (Nov 20 2026)", () => {
    // 15 published programs, 13,730 sets logged, 1,969 of 2,050 exercises with a video
    expect(LANDING_COPY.FREE[0]).toContain("15 full programs");
    expect(LANDING_COPY.PROOF.map((p) => p[0])).toEqual(["8", "2×", "100+", "13,000+"]);
    expect(visible).toContain("Over 2,000 exercises, almost every one with a how-to video.");
  });

  it("reads like a person wrote it", () => {
    const words = [
      ...LANDING_COPY.FREE,
      ...LANDING_COPY.COACHING,
      ...LANDING_COPY.FAQ.flatMap((f) => [f.q, f.a]),
      visible,
    ].join(" ");
    for (const cliche of [
      /unlock/i,
      /elevate/i,
      /journey/i,
      /transform your/i,
      /game.?changer/i,
      /take your .* to the next level/i,
      /level up/i,
      /seamless/i,
      /empower/i,
    ]) {
      expect(words).not.toMatch(cliche);
    }
    // no em dashes in anything a visitor reads
    expect(visible).not.toContain("—");
  });
});

describe("the rest of the way in says it the same way", () => {
  it("the free application says coaching is paid", () => {
    const join = readFileSync("src/components/join/membership-application.tsx", "utf8");
    expect(join).toContain("Coaching is paid and optional. The app is free either way.");
  });

  it("the coaching page points people who aren't ready at the free app", () => {
    const coaching = readFileSync("src/routes/coaching.index.tsx", "utf8");
    expect(coaching).toContain('q: "Is there a free option?"');
  });

  it("the page's title and description name both", () => {
    const route = readFileSync("src/routes/index.tsx", "utf8");
    expect(route).toContain("Free Training App + 1:1 Coaching with Jared McIntyre");
    expect(route).toContain("1:1 coaching with Jared is paid, by application.");
  });
});
