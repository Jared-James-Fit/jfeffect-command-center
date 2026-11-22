import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COACHES_APPLY_TO, COACHES_COPY, COACHES_CTA } from "@/components/coaches/coaches-page";
import { PROPOSED_PRICING, RECOMMENDED_PRICING } from "@/lib/coach-platform/seat-pricing";

const read = (path: string) => readFileSync(path, "utf8");
const visibleOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = visibleOf(read("src/components/coaches/coaches-page.tsx"));

describe("JF Effect for coaches is sold as early access, never as open", () => {
  it("says early access in the hero, the steps and the questions", () => {
    expect(COACHES_COPY.HERO.eyebrow).toContain("Early access");
    expect(page).toContain("Not open to everyone yet.");
    expect(COACHES_COPY.faq(null).find((f) => f.q === "Is it open now?")?.a).toMatch(/^Not yet/);
    expect(COACHES_CTA).toBe("Request early access");
    expect(COACHES_APPLY_TO).toBe("/coaches/apply");
  });

  it("separates what exists from what's being built", () => {
    expect(page).toContain("data-coaches-status");
    expect(COACHES_COPY.COMING.join(" ")).toMatch(/private workspace/);
    expect(COACHES_COPY.COMING.join(" ")).toMatch(/Later: taking payments/);
    // client payments are never promised as available
    expect(COACHES_COPY.faq(null).find((f) => f.q.startsWith("Can I take payments"))?.a).toMatch(/^Not at first/);
  });

  it("never types a price: the owner's published pricing, else the planned model with no number", () => {
    expect(page).not.toMatch(/\$\d/);
    expect(page).toContain("data-coaches-price-planned");
    const planned = COACHES_COPY.faq(null).find((f) => f.q === "What will it cost?")!.a;
    expect(planned).not.toMatch(/\$\d/);
    expect(planned).toMatch(/nothing is charged until you agree/);
    const published = COACHES_COPY.faq(PROPOSED_PRICING).find((f) => f.q === "What will it cost?")!.a;
    expect(published).toContain("Your first client is free. Then $5 a month for each client. No base fee.");
    expect(COACHES_COPY.faq(RECOMMENDED_PRICING).find((f) => f.q === "What will it cost?")!.a).toContain("$3 from your 26th");
  });

  it("the route reads the price from the database, and registration stays closed in SQL", () => {
    const route = read("src/routes/coaches.index.tsx");
    expect(route).toContain("getCoachPlatformPublic");
    const fns = read("src/lib/coach-platform/coach-platform.functions.ts");
    expect(fns).toContain('db.rpc("coach_platform_public")');
    expect(fns).toContain("registrationOpen: false");
  });

  it("the application is quiet, keeps privacy and marketing consent apart, and never pre-ticks either", () => {
    const app = read("src/components/coaches/coach-application.tsx");
    expect(app).toContain('<SalesPageShell pageId="coaches-apply" hideMarketingNav>');
    expect(app).toContain("data-coach-privacy");
    expect(app).toContain("data-coach-marketing");
    expect(app).not.toMatch(/defaultChecked/);
  });

  it("never names AI as the product, and never names the coach in the third person", () => {
    expect(page).not.toMatch(/\bAI\b/);
    expect(page).not.toMatch(/Jared (reads|will|can)/);
  });
});
