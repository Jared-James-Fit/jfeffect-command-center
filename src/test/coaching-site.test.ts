import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_EVENTS, cleanStep, deviceClass, rate, readCoachingFunnel } from "@/lib/site-funnel-rules";
import { FUNNEL_EVENTS } from "@/lib/membership-apply";

const read = (p: string) => readFileSync(p, "utf8");
const MIGRATION = read("supabase/migrations/20270513090000_coaching_site_launch.sql");

describe("the site's steps are counted anonymously (Nov 23 2026)", () => {
  it("keeps a step's detail short and plain", () => {
    expect(cleanStep("Complete")).toBe("complete");
    expect(cleanStep("  see packages! ")).toBe("see-packages");
    expect(cleanStep("package:home")).toBe("package:home");
    expect(cleanStep("x".repeat(60))).toHaveLength(40);
    expect(cleanStep(null)).toBe("");
  });

  it("records only phone, tablet or desktop, never anything finer", () => {
    expect(deviceClass(390, true)).toBe("phone");
    expect(deviceClass(820, true)).toBe("tablet");
    expect(deviceClass(1080, false)).toBe("desktop");
    expect(deviceClass(800, false)).toBe("tablet");
  });

  it("reads the admin's funnel with every count a number", () => {
    const f = readCoachingFunnel({
      landing_visitors: "120",
      pricing_views: 30,
      package_taps: { complete: 9, nutrition: "2" },
      customers_by_package: { complete: 1 },
      devices: [{ device: "phone", visitors: 90, joined_free: 6, applied: 2 }],
    });
    expect(f.landingVisitors).toBe(120);
    expect(f.packageTaps).toEqual({ complete: 9, nutrition: 2 });
    expect(f.applySent).toBe(0);
    expect(f.devices[0]).toEqual({ device: "phone", visitors: 90, joinedFree: 6, applied: 2 });
    expect(readCoachingFunnel(null).customers).toBe(0);
    expect(rate(3, 120)).toBe("2.5%");
    expect(rate(30, 120)).toBe("25%");
    expect(rate(1, 0)).toBe("–");
  });

  it("the database takes every step the site sends, and only those", () => {
    for (const e of [...FUNNEL_EVENTS, ...SITE_EVENTS]) expect(MIGRATION).toContain(`'${e}'`);
    expect(MIGRATION).toContain("device IN ('phone', 'tablet', 'desktop')");
    // the funnel is read only by the server after an admin check
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.coaching_funnel(timestamptz) FROM PUBLIC, anon, authenticated;");
    const fns = read("src/lib/site-funnel.functions.ts");
    expect(fns).toContain('rpc("has_role", { _user_id: ctx.userId, _role: "admin" })');
    expect(fns).toContain('onConflict: "visitor_id,event,step,day", ignoreDuplicates: true');
  });

  it("keeps interest apart from customers", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.coaching_funnel"));
    expect(fn).toContain("'package_taps'");
    expect(fn).toContain("'applications_by_package'");
    expect(fn).toContain("'customers'");
    // a customer is an application followed by a sale or a package, never a tap
    expect(fn).toMatch(/won AS \([\s\S]*purchase_records[\s\S]*coaching_package_enrollments/);
  });

  it("the application, the landing page and the coaching page all report their steps", () => {
    const apply = read("src/routes/coaching.apply.tsx");
    expect(apply).toContain('trackSite("coaching_apply_start"');
    expect(apply).toContain('trackSite("coaching_apply_step"');
    expect(apply).toContain('trackSite("coaching_apply_submit"');
    expect(read("src/routes/coaching.index.tsx")).toContain('trackSite("coaching_view")');
    expect(read("src/components/sales/coaching-packages.tsx")).toContain('trackSite("package_select", pkg.slug)');
  });
});

describe("the launch keeps every safeguard on the packages", () => {
  it("leaves Nutrition, Plus and the consultations drafts, and Complete's price alone", () => {
    expect(MIGRATION).toContain("WHERE slug = 'nutrition' AND status = 'draft'");
    expect(MIGRATION).toContain("WHERE slug = 'plus' AND status = 'draft'");
    expect(MIGRATION).not.toMatch(/is_public\s*=\s*true|status\s*=\s*'active'\s*,/);
    const complete = MIGRATION.slice(MIGRATION.indexOf("WHERE slug = 'nutrition'"), MIGRATION.indexOf("WHERE slug = 'complete'"));
    expect(complete).not.toContain("price_cents");
    for (const [slug, cents, mins] of [
      ["technique-review", 7900, 30],
      ["training-consultation", 11900, 45],
      ["nutrition-review", 9900, 45],
      ["competition-strategy", 17900, 60],
    ] as const) {
      expect(MIGRATION).toMatch(new RegExp(`price_cents = ${cents}, call_minutes = ${mins}, sort_order = \\d+\\nWHERE slug = '${slug}' AND status = 'draft'`));
    }
  });

  it("Plus is Complete plus exactly two 30-minute calls, nothing else", () => {
    const plus = MIGRATION.slice(MIGRATION.indexOf("tagline = 'Complete coaching, plus time with me on video.'"), MIGRATION.indexOf("WHERE slug = 'plus'"));
    expect(plus).toContain("'Everything in Complete Online Coaching',\n    'Two private 30-minute video calls each billing month'\n  ],");
    expect(plus).toContain("included_calls = 2");
    expect(plus).toContain("call_cancel_hours = 24");
    expect(plus).not.toMatch(/priority|strategy review|extra check/i);
  });

  it("puts the four $130 subscribers on Complete by association only, never their billing", () => {
    const part = MIGRATION.slice(MIGRATION.indexOf("INSERT INTO public.coaching_package_enrollments"), MIGRATION.indexOf("-- 4. The site's steps"));
    expect(part.match(/'[0-9a-f-]{36}'/g)?.length).toBe(5); // four sales and the $130 product
    expect(part).toContain("stripe_subscription_status = 'active'");
    expect(part).toContain("contracted_price_cents");
    expect(part).toContain("NOT EXISTS");
    expect(MIGRATION).not.toMatch(/UPDATE public\.(purchase_records|coaching_products|payment_ledger)/);
    expect(MIGRATION).not.toMatch(/DELETE FROM/);
  });
});

describe("the public site's app screens are current (Nov 23 2026)", () => {
  const landing = read("src/components/landing/landing-page.tsx");
  const coaching = read("src/routes/coaching.index.tsx");

  it("every screen a page shows exists, and the retired ones are gone", () => {
    for (const src of [landing, coaching]) {
      for (const m of src.matchAll(/from "@\/assets\/(landing|coaching)\/([a-z-]+\.webp)"/g)) {
        expect(existsSync(`src/assets/${m[1]}/${m[2]}`), m[2]).toBe(true);
      }
    }
    expect(existsSync("src/assets/coaching/app-analytics-prs.webp")).toBe(false);
    expect(existsSync("src/assets/coaching/app-analytics-progress.webp")).toBe(false);
    expect(coaching).not.toMatch(/ATPR/);
  });

  it("each screen is made by the capture scripts, from the app itself", () => {
    const scripts = read("scripts/coaching-screenshots/landing.cjs") + read("scripts/coaching-screenshots/run.cjs");
    for (const dir of ["landing", "coaching"]) {
      for (const f of readdirSync(`src/assets/${dir}`).filter((x) => x.startsWith("app-") && x.endsWith(".webp"))) {
        expect(scripts, f).toContain(`name: "${f.replace(".webp", "")}"`);
      }
    }
  });

  it("the coaching page uses its own screens, none of the landing page's chapter shots", () => {
    expect(coaching).toContain('from "@/assets/coaching/app-overview.webp"');
    expect(coaching).toContain('from "@/assets/coaching/app-program.webp"');
    expect(coaching).not.toMatch(/assets\/landing\/app-(week|log|insights|food)/);
  });
});

describe("Coaching Plus calls say their rules where they're used", () => {
  it("the client sees the 24-hour rule when they ask to cancel an included call", () => {
    const sheet = read("src/components/schedule/client-session-sheet.tsx");
    expect(sheet).toContain("<IncludedCallCancelNote sessionId={session.id} startsAt={startsAt} />");
    const card = read("src/components/portal/included-calls-card.tsx");
    expect(card).toContain("A later cancel");
    expect(card).toContain("If I move or cancel a call, it never counts.");
  });

  it("the coaching page answers how the calls work from the package itself", () => {
    const coaching = read("src/routes/coaching.index.tsx");
    expect(coaching).toContain("callsPolicy(p)");
  });
});
