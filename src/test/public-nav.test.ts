import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPLY_CHOICE,
  HOME_CTA_ZONES,
  JOIN_CHOICE,
  PUBLIC_NAV,
  activeNavKey,
  headerCtaFor,
} from "@/lib/public-nav";
import { stickyCtaChoice, stickyCtaState } from "@/lib/sticky-cta";

describe("the public navigation", () => {
  it("is Home, Free app, Online coaching, Pricing, About, in that order", () => {
    expect(PUBLIC_NAV.map((n) => n.label)).toEqual([
      "Home",
      "Free app",
      "Online coaching",
      "Pricing",
      "About",
    ]);
    // every option side by side on the home page, never a trip through /coaching
    const pricing = PUBLIC_NAV.find((n) => n.key === "pricing")!;
    expect([pricing.to, pricing.hash]).toEqual(["/", "pricing"]);
    const app = PUBLIC_NAV.find((n) => n.key === "app")!;
    expect([app.to, app.hash]).toEqual(["/", "app"]);
    expect(PUBLIC_NAV.find((n) => n.key === "coaching")!.to).toBe("/coaching");
  });

  it("says in the phone menu which one is free and which is paid", () => {
    expect(PUBLIC_NAV.find((n) => n.key === "app")!.hint).toMatch(/Free/);
    expect(PUBLIC_NAV.find((n) => n.key === "coaching")!.hint).toMatch(/Paid, by application/);
  });

  it("lights the page you're on", () => {
    expect(activeNavKey("/")).toBe("home");
    expect(activeNavKey("/", "#app")).toBe("app");
    expect(activeNavKey("/", "app")).toBe("app");
    expect(activeNavKey("/", "#pricing")).toBe("pricing");
    expect(activeNavKey("/join")).toBe("app");
    expect(activeNavKey("/coaching")).toBe("coaching");
    expect(activeNavKey("/coaching/")).toBe("coaching");
    expect(activeNavKey("/coaching/apply")).toBe("coaching");
    expect(activeNavKey("/about")).toBe("about");
    expect(activeNavKey("/auth")).toBeNull();
    expect(activeNavKey("/privacy")).toBeNull();
  });

  it("gives each page its own ask, and none inside an application", () => {
    expect(headerCtaFor("/")).toEqual(JOIN_CHOICE);
    expect(headerCtaFor("/coaching")).toEqual(APPLY_CHOICE);
    expect(headerCtaFor("/coaching/")).toEqual(APPLY_CHOICE);
    expect(headerCtaFor("/about")).toEqual(APPLY_CHOICE);
    expect(headerCtaFor("/join")).toBeNull();
    expect(headerCtaFor("/coaching/apply")).toBeNull();
    expect(JOIN_CHOICE).toEqual({ label: "Get the free app", href: "/join" });
    expect(APPLY_CHOICE).toEqual({ label: "Apply for coaching", href: "/coaching/apply" });
  });

  it("asks for the coaching application while the home page's coaching section is on screen", () => {
    expect(HOME_CTA_ZONES.coaching).toEqual(APPLY_CHOICE);
  });

  it("keeps the logo as Home and the application flows quiet", () => {
    const header = readFileSync("src/components/sales/public-header.tsx", "utf8");
    expect(header).toContain('aria-label="JF Effect home"');
    expect(header).toContain('<Link\n      to="/"');
    for (const route of ["src/routes/coaching.apply.tsx"]) {
      const src = readFileSync(route, "utf8");
      expect(src.match(/<SalesPageShell(?! hideMarketingNav)[\s>]/g) ?? []).toEqual([]);
    }
    const join = readFileSync("src/components/join/membership-application.tsx", "utf8");
    expect(join.match(/<SalesPageShell [^>]*hideMarketingNav/g)?.length).toBeGreaterThan(0);
  });
});

describe("the phone's bottom button", () => {
  const zones = [{ name: "coaching", top: 300, bottom: 1400 }];
  it("waits until the visitor is past the first half screen", () => {
    expect(
      stickyCtaState({ scrollY: 100, viewportHeight: 800, inlineVisible: false, zones: [] })
        .visible,
    ).toBe(false);
    expect(
      stickyCtaState({ scrollY: 500, viewportHeight: 800, inlineVisible: false, zones: [] })
        .visible,
    ).toBe(true);
  });

  it("steps aside while one of the page's own buttons is on screen", () => {
    expect(
      stickyCtaState({ scrollY: 900, viewportHeight: 800, inlineVisible: true, zones: [] }).visible,
    ).toBe(false);
  });

  it("becomes the section's button while that section fills the middle of the screen", () => {
    const s = stickyCtaState({ scrollY: 2000, viewportHeight: 800, inlineVisible: false, zones });
    expect(s.zone).toBe("coaching");
    expect(stickyCtaChoice(JOIN_CHOICE, HOME_CTA_ZONES, s.zone)).toEqual(APPLY_CHOICE);
    const below = stickyCtaState({
      scrollY: 2000,
      viewportHeight: 800,
      inlineVisible: false,
      zones: [{ name: "coaching", top: -1400, bottom: 200 }],
    });
    expect(below.zone).toBeNull();
    expect(stickyCtaChoice(JOIN_CHOICE, HOME_CTA_ZONES, below.zone)).toEqual(JOIN_CHOICE);
  });
});
