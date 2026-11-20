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

const read = (path: string) => readFileSync(path, "utf8");
/** What a visitor reads: the file without its comments. */
const visibleOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = read("src/components/landing/landing-page.tsx");
const visible = visibleOf(page);

/** Every public marketing page a visitor can read. */
const PUBLIC_PAGES = [
  "src/components/landing/landing-page.tsx",
  "src/routes/coaching.index.tsx",
  "src/routes/about.tsx",
  "src/routes/coaching.apply.tsx",
  "src/components/join/membership-application.tsx",
  "src/components/sales/public-header.tsx",
  "src/lib/public-nav.ts",
];

describe("the landing page sells the free app first and online coaching as its own offer", () => {
  it("leads with the app, Join free first and online coaching beside it", () => {
    const hero = visible.slice(
      visible.indexOf("data-landing-hero"),
      visible.indexOf("data-landing-proof"),
    );
    expect(LANDING_COPY.HERO.title).toBe("The training app built by a Team Canada powerlifter.");
    expect(LANDING_COPY.HERO.body).toContain("Use it free, or hire me to coach you online.");
    expect(hero.indexOf("<PrimaryCta to={JOIN_TO}")).toBeGreaterThan(-1);
    expect(hero.indexOf("<SecondaryCta to={COACHING_TO}")).toBeGreaterThan(
      hero.indexOf("<PrimaryCta to={JOIN_TO}"),
    );
    expect(hero).toContain("Online coaching");
  });

  it("never sells the whole thing as free, and never prices coaching in a table", () => {
    expect(visible).not.toContain("Free to join · No card");
    expect(visible).not.toMatch(/\["\$0"/);
    // coaching is its own section, not a "Paid" column beside the free one
    expect(visible).not.toMatch(/>Paid</);
    expect(visible).not.toContain("data-landing-plan");
    expect(visible).toContain("data-landing-coaching");
  });

  it("says what the coach does, and that it's paid, without a price list", () => {
    const titles = LANDING_COPY.COACHING.map((c) => c.title);
    expect(titles).toEqual([
      "Your program",
      "Weekly check-ins",
      "Nutrition",
      "Technique and questions",
      "Meet prep",
    ]);
    expect(visible).toContain("I'll run your training.");
    expect(visible).toContain("We go over price on a short call before you commit.");
    // replies are what the app's own coach chat promises, never "unlimited"
    expect(LANDING_COPY.COACHING.map((c) => c.body).join(" ")).toContain(
      "I usually reply within a day.",
    );
    expect(visible).not.toMatch(/unlimited/i);
    expect(LANDING_COPY.FAQ.map((f) => f.q)).toEqual(
      expect.arrayContaining([
        "What's free?",
        "What does coaching cost?",
        "How does online coaching work?",
      ]),
    );
  });

  it("asks for the coaching application while coaching is on screen", () => {
    expect(visible).toContain('data-cta-zone="coaching"');
    expect(visible).toContain("zones={HOME_CTA_ZONES} hideWhenInline");
    expect(visible).toContain("ctaZones={HOME_CTA_ZONES}");
  });

  it("each way in goes where it says", () => {
    expect(JOIN_TO).toBe("/join");
    expect(COACHING_APPLY_TO).toBe("/coaching/apply");
    expect(COACHING_TO).toBe("/coaching");
    expect(JOIN_CTA).toBe("Join free");
    expect(COACHING_CTA).toBe("Apply for coaching");
  });

  it("claims only what's checked (Nov 20 2026)", () => {
    // 15 live programs (4 beginner, 3 home), 1,969 of 2,050 exercises with a video
    expect(LANDING_COPY.PROOF.map((p) => p[0])).toEqual(["8", "2×", "100+", "15"]);
    expect(LANDING_COPY.FREE[0].text).toBe("2,000+ exercises, almost all with a how-to video");
    expect(LANDING_COPY.FAQ.find((f) => f.q.startsWith("I'm new"))?.a).toContain(
      "Four of my programs",
    );
  });
});

describe("the public site reads like Jared wrote it", () => {
  const words = PUBLIC_PAGES.map((p) => visibleOf(read(p))).join(" ");

  it("has none of the lines Jared called out, or the usual fitness-marketing words", () => {
    for (const line of [
      /Real programs/i,
      /Structure beats motivation/i,
      /crew that notices/i,
      /the paid part/i,
      /actually prep/i,
      /Real results/i,
      /Real coaching/i,
      /Visible proof/i,
      /your result could be next/i,
      /Spots are limited/i,
      /\bunlock/i,
      /\belevate/i,
      /\bjourney/i,
      /transform your/i,
      /game.?changer/i,
      /take your .* to the next level/i,
      /level up/i,
      /seamless/i,
      /empower/i,
    ]) {
      expect(words).not.toMatch(line);
    }
  });

  it("uses no dashes in what a visitor reads on the landing page", () => {
    expect(visible).not.toContain("—");
  });
});

describe("coaching is marketed online only", () => {
  it("names no town, gym or in-person training on any public page", () => {
    for (const p of [...PUBLIC_PAGES, "src/routes/__root.tsx", "src/routes/index.tsx"]) {
      const text = visibleOf(read(p));
      expect(text, p).not.toMatch(/Selkirk|Iron Image|in[- ]person|personal-trainer-selkirk/i);
    }
  });

  it("the old in-person pages send people to online coaching", () => {
    expect(read("src/routes/personal-trainer-selkirk.tsx")).toContain('redirect({ to: "/coaching"');
    expect(read("src/routes/personal-trainer-selkirk.apply.tsx")).toContain(
      `redirect({ to: "/coaching/apply"`,
    );
    expect(read("src/routes/personal-trainer-selkirk.tsx")).toContain(
      `redirect({ to: "/coaching/apply"`,
    );
    expect(read("src/routes/selkirk.tsx")).toContain('redirect({ to: "/coaching"');
    expect(read("public/sitemap.xml")).not.toContain("selkirk");
  });

  it("the site's own description is an organization, not a local gym", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).not.toMatch(/LocalBusiness|geo\.position|openingHoursSpecification/);
    expect(read("src/routes/coaching.index.tsx")).not.toMatch(/LocalBusiness|geo\.placename/);
  });
});

describe("the rest of the way in says it the same way", () => {
  it("the free application says online coaching is paid", () => {
    expect(read("src/components/join/membership-application.tsx")).toContain(
      "Online coaching is paid and optional. The app is free either way.",
    );
  });

  it("the coaching page points people who aren't ready at the free app, and only asks for the application", () => {
    const coaching = read("src/routes/coaching.index.tsx");
    expect(coaching).toContain('q: "Is there a free option?"');
    expect(visibleOf(coaching)).not.toContain('to="/join"');
    expect(coaching).toContain("<StickyMobileCta label={CTA} href={APPLY_TO} hideWhenInline />");
  });

  it("the page's title and description name both", () => {
    const route = read("src/routes/index.tsx");
    expect(route).toContain("Free Training App + Online Coaching with Jared McIntyre");
    expect(route).toContain("1:1 online coaching with Jared is a paid service, by application.");
  });
});
