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
import { EXAMPLES, LOWER_TIERS, onlineAnchor } from "@/lib/coaching-packages/online-coaching-cost";
import { costAnchors, highestMonthlyCents, yearLine } from "@/lib/coaching-packages/cost-anchors";
import { shortPlanName } from "@/lib/coaching-packages/packages";

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

  it("sits between the coaching demo and the plans, with no dashes and in Jared's words", () => {
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
  const top = highestMonthlyCents(LIVE);

  it("measures against the highest monthly coaching price on the site ($249)", () => {
    expect(top).toBe(24900);
    expect(highestMonthlyCents(LIVE.filter((p) => p.kind === "free"))).toBeNull();
    // an unlisted package never counts
    expect(highestMonthlyCents(LIVE.map((p) => (p.slug === "plus" ? { ...p, listed: false } : p)))).toBe(13000);
  });

  it("works the example out in the open: $76.50 × 2 a week × 52 weeks", () => {
    expect(EXAMPLE_RATE_CENTS).toBe(7650);
    expect(EXAMPLE_PER_WEEK).toBe(2);
    expect(trainerCost(7650, 2)).toEqual({ yearCents: 795600, monthCents: 66300 });
    const t = trainerAnchor(top)!;
    expect(t.rate).toBe("$76.50");
    expect(t.year).toBe("$7,956");
    expect(t.month).toBe("$663");
    expect(t.maths).toBe("$76.50 × 2 sessions × 52 weeks = $7,956 a year, about $663 a month.");
    // once and three times a week are said too, so twice is visibly an example
    expect(t.otherFrequencies).toBe("Once a week is about $3,978 a year. Three times is about $11,934.");
    // the line a visitor reads names nobody
    expect(t.sessions).toBe("Two private sessions a week at $76.50 each, a city rec centre's published rate.");
  });

  it("names where every rate comes from in the collapsed sources, with a link and the day it was checked", () => {
    expect(EXAMPLE_SOURCE.provider).toBe("City of Edmonton");
    expect(EXAMPLE_SOURCE.detail).toContain("$76.50 a session for non-members");
    expect(CHECKED_ON).toBe("Nov 23, 2026");
    for (const s of [EXAMPLE_SOURCE, ...OTHER_SOURCES]) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.detail).toMatch(/\$\d+(\.\d\d)? a session/);
      // public providers only: cities and a university, never a private gym
      expect(s.provider).toMatch(/^(City of|University of)/);
    }
    // a public rec centre's single-session rate, and never the highest rate checked (Calgary's 5-pack is $83)
    expect(OTHER_SOURCES.some((s) => /\$83 a session/.test(s.detail))).toBe(true);
  });

  it("only shows while a month of it costs more than the coaching on the site", () => {
    expect(trainerAnchor(null)).toBeNull();
    // if a monthly package ever cost more than $663, the example would read the wrong way round
    expect(trainerAnchor(70000)).toBeNull();
    // once a week ($332 a month) still leads Plus ($249); a rate under it wouldn't
    expect(trainerAnchor(top, 7650, 1)).not.toBeNull();
    expect(trainerAnchor(top, 2000, 1)).toBeNull();
  });
});

describe("what higher-priced online coaching costs: examples, never an average, no business named (Nov 23 2026)", () => {
  const top = highestMonthlyCents(LIVE);

  it("works the range out from the packages checked: $289.99 to $400 a month", () => {
    const o = onlineAnchor(top)!;
    expect(o.yearLow).toBe("$3,480");
    expect(o.yearHigh).toBe("$4,800");
    expect(o.monthRange).toBe("$289.99 to $400 a month");
    expect(o.maths).toBe("$289.99 × 12 = $3,480. $400 × 12 = $4,800.");
    expect(o.examples.map((e) => e.price)).toEqual(["$289.99 a month", "$389.99 a month", "from $400 a month"]);
    // the lower tiers checked are said beside it, so the range never reads as what every coach charges
    expect(o.lowerTiers).toBe("Lower tiers from the same check ran $189.99 to $249 a month.");
    expect(LOWER_TIERS.every((c) => c < Math.min(...EXAMPLES.map((e) => e.monthCents)))).toBe(true);
    expect(o.checkedOn).toBe("Nov 23, 2026");
  });

  it("describes each package and never names the business on the page", () => {
    const visible = visibleOf(read("src/lib/coaching-packages/online-coaching-cost.ts")) + visibleOf(read("src/components/landing/cost-anchors.tsx"));
    expect(visible).not.toMatch(/Calgary Barbell|Paris Demers|Strengthcity|Trainerize/i);
    for (const e of EXAMPLES) expect(e.who).toMatch(/^(A |The same)/);
    // the sources are recorded where they can be checked
    const doc = read("docs/pricing-anchors.md");
    expect(doc).toContain("calgarybarbell.com/coaching");
    expect(doc).toContain("parisdemers.com/pages/online-fitness-coaching");
  });

  it("only shows while every coaching package on the site is below its cheapest example", () => {
    expect(onlineAnchor(null)).toBeNull();
    // a $299 package would make "higher-priced" untrue
    expect(onlineAnchor(29900)).toBeNull();
    expect(onlineAnchor(28999)).toBeNull();
    expect(onlineAnchor(28998)).not.toBeNull();
  });

  it("opens the story only when there's coaching on the site to compare with", () => {
    const both = costAnchors(LIVE)!;
    expect(both.trainer?.year).toBe("$7,956");
    expect(both.online?.yearLow).toBe("$3,480");
    expect(costAnchors(LIVE.filter((p) => p.kind === "free"))).toBeNull();
    // a pricier package drops the online example first, then the trainer one
    const pricey = (cents: number) => [...LIVE, pkg({ slug: "vip", name: "VIP", priceCents: cents })];
    expect(costAnchors(pricey(35000))).toEqual({ trainer: expect.anything(), online: null });
    expect(costAnchors(pricey(80000))).toBeNull();
  });

  it("says the three are different things, and never calls coaching or the app a discount on them", () => {
    const src = visibleOf(read("src/components/landing/cost-anchors.tsx"));
    for (const card of ["A personal trainer", "An online coach", "An app"]) expect(src).toContain(card);
    // fair to trainers: what they do between sessions isn't assumed
    expect(src).toContain("What happens between sessions depends on the trainer.");
    expect(src).toContain("Not in the room with you.");
    expect(src).toContain("No coach comes with it.");
    expect(src).toContain("these are examples, not an average");
    expect(src).toContain("before tax");
    expect(src).not.toMatch(/same as a (personal )?trainer|like having a trainer|instead of a trainer|for a fraction|cheaper than|average (price|cost)|industry/i);
    expect(src).not.toMatch(/\b(save|saving|savings|discount|was \$|only \$|deal|limited|hurry)\b/i);
    expect(src).not.toContain("—");
    expect(src).not.toMatch(/\breal(ly)?\b|\bactually\b/i);
    // the methodology is collapsed by default: native disclosures, never open
    expect(src).toContain("<details");
    expect(src).not.toMatch(/<details[^>]*\bopen\b/);
    // counted once it's seen
    expect(SITE_EVENTS).toContain("cost_anchor_view");
    expect(src).toContain('useSeen(ref, "cost_anchor_view", "home", 0.5)');
    expect(readCoachingFunnel({ anchor_views: "7" }).anchorViews).toBe(7);
    const sql = read("supabase/migrations/20270519090000_cost_anchor_funnel.sql");
    expect(sql).toContain("'anchor_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'cost_anchor_view')");
    expect(sql).toContain("'free_reveal_views', (SELECT count(DISTINCT visitor_id) FROM ev WHERE event = 'free_reveal_view')");
  });

  it("opens the page's price story, before the app, the $0 and the coaching prices", () => {
    const page = read("src/components/landing/landing-page.tsx");
    const order = ["data-landing-proof", "<CostAnchorsSection", "data-landing-app", "<FreeReveal />", "<PriceRevealSection", 'id="pricing"'];
    const at = order.map((m) => page.indexOf(m));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe("each coaching price as a year, beside the yearly examples", () => {
  it("says $2,988 for Plus and $1,560 for Complete, from the packages", () => {
    const r = priceReveal(LIVE)!;
    expect(r.anchorYear).toBe("$2,988 a year");
    expect(r.flagshipYear).toBe("$1,560 a year");
    expect(yearLine(0)).toBeNull();
    const src = visibleOf(read("src/components/landing/price-reveal.tsx"));
    const flagship = src.slice(src.indexOf("data-reveal-flagship\n"), src.lastIndexOf("</section>"));
    expect(flagship).toContain("reveal.flagshipYear");
    expect(flagship).not.toContain("anchorYear");
  });
});

describe("every plan in one selection", () => {
  it("names each plan in one word on a phone's switch", () => {
    expect(["Free app", "Nutrition Coaching", "Complete Online Coaching", "Coaching Plus"].map(shortPlanName)).toEqual([
      "Free",
      "Nutrition",
      "Complete",
      "Plus",
    ]);
    expect(shortPlanName("Membership")).toBe("Membership");
    expect(shortPlanName("Online Coaching")).toBe("Online Coaching");
  });

  it("is the same cards on every screen: a switch over a row on a phone, side by side from a tablet up", () => {
    const grid = read("src/components/sales/coaching-packages.tsx");
    expect(grid).toContain('choose && "hidden md:grid"');
    expect(grid).toContain('<div className="md:hidden" data-plan-chooser>');
    expect(grid).toContain("<PackageCard pkg={p} from={from} compact anchor={anchorLine(p, plans)}");
    expect(read("src/components/landing/landing-page.tsx")).toContain('<CoachingPackagesGrid packages={list} from="home" calls={false} free chooser />');
  });
});

describe("the free app's $0", () => {
  const page = visibleOf(read("src/components/landing/landing-page.tsx"));
  it("is its own moment, from the same formatter as every price, on the page from the first paint", () => {
    const free = page.slice(page.indexOf("function FreeReveal"), page.indexOf("function Chapter"));
    expect(free).toContain("{REVEAL.price}");
    expect(free).toContain("motion(phase, FREE_SETTLE)");
    // the page's biggest number: bigger than the coaching price's moment
    expect(free).toContain("md:text-[240px]");
    expect(read("src/components/landing/price-reveal.tsx")).toContain("md:text-[176px]");
    // it says plainly that a coach isn't in it
    expect(free).toContain("{REVEAL.without}");
    expect(free).toContain('useSeen(ref, "free_reveal_view", "home"');
    expect(free).toContain("data-landing-reveal");
    expect(page).toContain("price: priceLabel(0)");
  });
});
