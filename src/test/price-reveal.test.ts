import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addsOnlyCalls, buildsOn, priceReveal } from "@/lib/coaching-packages/price-reveal";
import type { PublicPackage } from "@/lib/coaching-packages/packages";
import { SITE_EVENTS, readCoachingFunnel } from "@/lib/site-funnel-rules";
import {
  CHECKED_ON,
  EXAMPLE_PER_WEEK,
  EXAMPLE_RATE_CENTS,
  EXAMPLE_SOURCE,
  OTHER_SOURCES,
  trainerAnchor,
  trainerCost,
} from "@/lib/coaching-packages/trainer-cost";

const read = (p: string) => readFileSync(p, "utf8");
const visibleOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const pkg = (o: Partial<PublicPackage> & Pick<PublicPackage, "slug" | "name">): PublicPackage => ({
  kind: "subscription",
  tagline: null,
  description: null,
  bestFor: null,
  features: [],
  priceCents: 0,
  currency: "CAD",
  interval: "month",
  recommended: false,
  ctaLabel: null,
  includedCalls: 0,
  callMinutes: 30,
  sortOrder: 0,
  listed: true,
  ...o,
});

/** The four packages as they're listed on Nov 23 2026. */
const LIVE: PublicPackage[] = [
  pkg({ slug: "free", name: "Free app", kind: "free", interval: null, sortOrder: 10 }),
  pkg({
    slug: "nutrition",
    name: "Nutrition Coaching",
    priceCents: 9900,
    sortOrder: 20,
    features: ["A nutrition plan built around the food you eat", "The full app for your own training"],
  }),
  pkg({
    slug: "complete",
    name: "Complete Online Coaching",
    priceCents: 13000,
    recommended: true,
    sortOrder: 30,
    features: ["Everything in Nutrition Coaching", "A program written for you and changed as you progress"],
  }),
  pkg({
    slug: "plus",
    name: "Coaching Plus",
    priceCents: 24900,
    includedCalls: 2,
    sortOrder: 40,
    features: ["Everything in Complete Online Coaching", "Two private 30-minute video calls each billing month"],
  }),
];

describe("the coaching price reveal: Plus's price first, then Complete's (Nov 23 2026)", () => {
  it("reveals Complete at $130 after Coaching Plus at $249, both read from the packages", () => {
    const r = priceReveal(LIVE)!;
    expect(r.anchor.slug).toBe("plus");
    expect(r.flagship.slug).toBe("complete");
    expect(r.anchorPrice).toBe("$249");
    expect(r.flagshipPrice).toBe("$130");
    expect(r.per).toBe("/month");
    expect(r.taxNote).toBe("CAD, plus applicable tax");
    expect(r.callsSentence).toBe("Two private 30-minute video calls each billing month.");
    expect(r.callsWord).toBe("two");
    // its buttons land on the application with the package picked, attributed to the reveal
    expect(r.flagshipHref).toBe("/coaching/apply?package=complete&from=reveal");
    expect(r.anchorHref).toBe("/coaching/apply?package=plus&from=reveal");
  });

  it("only shows when Plus is on the site: a draft or unlisted Plus means no reveal", () => {
    expect(priceReveal(LIVE.map((p) => (p.slug === "plus" ? { ...p, listed: false } : p)))).toBeNull();
    expect(priceReveal(LIVE.filter((p) => p.slug !== "plus"))).toBeNull();
    // and only while Complete is the recommended one
    expect(priceReveal(LIVE.map((p) => ({ ...p, recommended: false })))).toBeNull();
  });

  it("never calls it the same coaching unless Plus says it is: everything in Complete, plus calls and nothing else", () => {
    const plus = LIVE[3];
    const complete = LIVE[2];
    expect(buildsOn(plus, complete)).toBe(true);
    expect(addsOnlyCalls(plus, complete)).toBe(true);
    const withExtra = { ...plus, features: [...plus.features, "Priority replies"] };
    expect(addsOnlyCalls(withExtra, complete)).toBe(false);
    expect(priceReveal(LIVE.map((p) => (p.slug === "plus" ? withExtra : p)))).toBeNull();
    const notBuilt = { ...plus, features: ["Your program", "Two private 30-minute video calls each billing month"] };
    expect(priceReveal(LIVE.map((p) => (p.slug === "plus" ? notBuilt : p)))).toBeNull();
    // "without them" must be true: the flagship includes no calls of its own
    expect(priceReveal(LIVE.map((p) => (p.slug === "complete" ? { ...p, includedCalls: 1 } : p)))).toBeNull();
    // a package with no calls can't be the anchor, whatever it says
    expect(priceReveal(LIVE.map((p) => (p.slug === "plus" ? { ...p, includedCalls: 0 } : p)))).toBeNull();
  });

  it("anchors on the nearest package above, never a made-up price", () => {
    const vip = pkg({
      slug: "vip",
      name: "VIP",
      priceCents: 49900,
      includedCalls: 4,
      features: ["Everything in Complete Online Coaching", "Four private 30-minute video calls each billing month"],
    });
    expect(priceReveal([...LIVE, vip])!.anchor.slug).toBe("plus");
    // a cheaper package is never an anchor
    expect(priceReveal(LIVE.map((p) => (p.slug === "plus" ? { ...p, priceCents: 12000 } : p)))).toBeNull();
  });
});

describe("the reveal reads as two products, never a discount", () => {
  const src = read("src/components/landing/price-reveal.tsx");
  const words = visibleOf(src);
  const flagship = words.slice(words.indexOf("data-reveal-flagship\n"), words.lastIndexOf("</section>"));

  it("never crosses out, discounts or counts down a price", () => {
    expect(words).not.toMatch(/line-through|<s>|<del>|strikethrough/i);
    expect(words).not.toMatch(/\b(save|saving|savings|discount|was \$|off\b|only \$|deal|limited|hurry|now just)\b/i);
    // the flagship's moment never shows the anchor's price beside it
    expect(flagship).not.toContain("anchorPrice");
    // no number ticks from one price to the other
    expect(src).not.toMatch(/requestAnimationFrame|setInterval|countdown/i);
  });

  it("says plainly that the calls are the only difference", () => {
    expect(flagship).toContain('Everything in <span className="whitespace-nowrap">{anchor.name}</span> except the {reveal.callsWord} calls.');
    expect(words).toContain("Don't need the private calls?");
    expect(words).toContain("Get the same coaching without them.");
  });

  it("is on the page from the first paint and only eases in what's still below the screen", () => {
    const stage = read("src/components/landing/stage-motion.ts");
    expect(stage).toContain('useState<Phase>("static")');
    expect(stage).toContain("(prefers-reduced-motion: reduce)");
    expect(stage).toContain("getBoundingClientRect().top < window.innerHeight");
    // a reveal, never a gate: no scroll locking, no timers before a price shows
    for (const f of [src, stage]) {
      expect(f).not.toMatch(/overflow-hidden.*body|preventDefault|setTimeout|setInterval|requestAnimationFrame|position:\s*sticky|sticky/);
    }
    expect(src).toContain("useStage(");
    expect(src).not.toMatch(/function useStage|useState</);
  });

  it("sits between the coaching demo and the four options, with no dashes and in Jared's words", () => {
    const page = read("src/components/landing/landing-page.tsx");
    const at = page.indexOf("<PriceRevealSection");
    expect(at).toBeGreaterThan(page.indexOf("data-landing-coaching"));
    expect(at).toBeLessThan(page.indexOf('id="pricing"'));
    expect(words).not.toContain("—");
    expect(words).not.toMatch(/\breal(ly)?\b|\bactually\b/i);
  });

  it("is counted once it's seen, so its effect on applications can be read", () => {
    expect(SITE_EVENTS).toContain("price_reveal_view");
    expect(src).toContain('useSeen(flagRef, "price_reveal_view", "home")');
    expect(readCoachingFunnel({ reveal_views: "12" }).revealViews).toBe(12);
    const sql = read("supabase/migrations/20270515110000_free_reveal_funnel.sql");
    expect(sql).toContain("'reveal_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'price_reveal_view')");
    expect(sql).toContain("'free_reveal_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'free_reveal_view')");
    expect(readCoachingFunnel({ free_reveal_views: "40" }).freeRevealViews).toBe(40);
  });
});

describe("what a personal trainer costs: a worked example from published rates, never a guess (Nov 23 2026)", () => {
  const reveal = priceReveal(LIVE)!;

  it("works the example out in the open: $56.23 × 2 a week × 52 weeks", () => {
    expect(EXAMPLE_RATE_CENTS).toBe(5623);
    expect(EXAMPLE_PER_WEEK).toBe(2);
    expect(trainerCost(5623, 2)).toEqual({ yearCents: 584792, monthCents: 48733 });
    const t = trainerAnchor(reveal)!;
    expect(t.rate).toBe("$56.23");
    expect(t.month).toBe("$487");
    expect(t.year).toBe("$5,848");
    expect(t.maths).toBe("$56.23 × 2 sessions × 52 weeks = $5,848 a year, or $487 a month.");
    // once and three times a week are said too, so twice is visibly an example
    expect(t.otherFrequencies).toBe("Once a week is about $244 a month. Three times is about $731.");
  });

  it("names where every rate comes from, with a link and the day it was checked", () => {
    const t = trainerAnchor(reveal)!;
    expect(t.sourceLine).toContain("City of Mississauga's 2026 rate");
    expect(EXAMPLE_SOURCE.detail).toContain("$56.23 for 8 or more, plus HST");
    expect(CHECKED_ON).toBe("Nov 23, 2026");
    for (const s of [EXAMPLE_SOURCE, ...OTHER_SOURCES]) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.detail).toMatch(/\$\d+(\.\d\d)? a session/);
    }
    // the example's rate is the published one, never higher than any single-session rate checked
    const singles = [6615, 5825, 5900, 6120];
    expect(singles.every((c) => c >= EXAMPLE_RATE_CENTS)).toBe(true);
  });

  it("only leads the story while a month of it costs more than the coaching shown after it", () => {
    expect(trainerAnchor(null)).toBeNull();
    // twice a week at $56.23 is $487; if Plus were ever $500, the example would read the wrong way round
    const pricier = priceReveal(LIVE.map((p) => (p.slug === "plus" ? { ...p, priceCents: 50000 } : p)))!;
    expect(trainerAnchor(pricier)).toBeNull();
    // once a week ($244) is under Plus ($249): never used to lead
    expect(trainerAnchor(reveal, 5623, 1)).toBeNull();
  });

  it("says a trainer and online coaching are different things, and never calls coaching a discount", () => {
    const src = visibleOf(read("src/components/landing/price-reveal.tsx"));
    const trainer = src.slice(src.indexOf("function TrainerStage"), src.indexOf("export function PriceRevealSection"));
    expect(trainer).toContain("REVEAL_WORDS.trainerCardBody");
    expect(trainer).toContain("REVEAL_WORDS.onlineCardBody");
    expect(src).toContain("I'm not in the room.");
    // fair to trainers: what they do between sessions isn't assumed
    expect(src).toContain("What happens between sessions depends on the trainer.");
    expect(src).toContain("before tax");
    expect(src).not.toMatch(/same as a (personal )?trainer|like having a trainer|instead of a trainer|for a fraction|cheaper than/i);
  });
});

describe("the free app's $0", () => {
  const page = visibleOf(read("src/components/landing/landing-page.tsx"));
  it("is its own moment, from the same formatter as every price, on the page from the first paint", () => {
    const free = page.slice(page.indexOf("function FreeReveal"), page.indexOf("function Chapter"));
    expect(free).toContain("{REVEAL.price}");
    expect(free).toContain("motion(phase, PRICE_SETTLE)");
    expect(free).toContain('useSeen(ref, "free_reveal_view", "home"');
    expect(free).toContain("data-landing-reveal");
    expect(page).toContain("price: priceLabel(0)");
  });
});
