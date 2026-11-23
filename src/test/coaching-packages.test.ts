import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  anchorLine,
  callsLine,
  callsPolicy,
  centerpiece,
  decisionRows,
  changeWords,
  costAnswer,
  ctaHref,
  ctaText,
  fromPublicRow,
  listedPackages,
  packageProblems,
  paidPackages,
  priceLabel,
  priceText,
  pricingText,
  publishProblems,
  shareLink,
  statusWord,
  toPublic,
  actionTexts,
  type CoachingPackage,
  type PublicPackage,
} from "@/lib/coaching-packages/packages";
import { callPeriod, callUsage, canGiveBack, lastDay, periodAnchor } from "@/lib/coaching-packages/call-period";
import { actionItemsMessage, bookingWords, buildCallPrep, type PrepInput } from "@/lib/coaching-packages/call-prep";
import { cardFeatures, cardFileName } from "@/lib/coaching-packages/pricing-card";

const read = (p: string) => readFileSync(p, "utf8");
const MIGRATION = read("supabase/migrations/20270505090000_coaching_packages.sql");

function pkg(over: Partial<CoachingPackage> = {}): CoachingPackage {
  return {
    id: "p1",
    slug: "complete",
    kind: "subscription",
    name: "Complete Online Coaching",
    tagline: "Your training and nutrition, run by me.",
    description: null,
    best_for: null,
    features: ["Your program", "Weekly check-ins"],
    price_cents: 13000,
    currency: "CAD",
    billing_interval: "month",
    recommended: true,
    status: "active",
    is_public: true,
    sort_order: 30,
    cta_label: "Apply for coaching",
    included_calls: 0,
    call_minutes: 30,
    call_booking_card_id: null,
    call_cancel_hours: 24,
    product_id: null,
    admin_note: "internal",
    published_at: null,
    updated_at: "2026-11-22T00:00:00Z",
    ...over,
  };
}

const complete = toPublic(pkg());
const plusDraft = toPublic(pkg({ slug: "plus", name: "Coaching Plus", price_cents: 24900, recommended: false, status: "draft", is_public: false, included_calls: 2, sort_order: 40 }));
const free = toPublic(pkg({ slug: "free", kind: "free", name: "Free app", price_cents: 0, recommended: false, sort_order: 10, cta_label: "Join free", best_for: "You want to train on your own." }));

describe("coaching packages: prices and where the buttons go", () => {
  it("says prices the way people read them", () => {
    expect(priceLabel(13000)).toBe("$130");
    expect(priceLabel(9950)).toBe("$99.50");
    expect(priceLabel(0)).toBe("$0");
    expect(priceText(complete)).toBe("$130/month");
    expect(priceText(free)).toBe("Free");
  });

  it("sends a paid package's button to the application with the package picked", () => {
    expect(ctaHref(complete)).toBe("/coaching/apply?package=complete");
    expect(ctaHref(complete, "home")).toBe("/coaching/apply?package=complete&from=home");
    expect(ctaHref(free)).toBe("/join");
    expect(shareLink(complete)).toBe("https://jfeffect.com/coaching/apply?package=complete&from=share");
    expect(ctaText({ kind: "subscription", ctaLabel: null })).toBe("Apply for coaching");
    expect(ctaText({ kind: "free", ctaLabel: "" })).toBe("Get the free app");
  });

  it("lists only active packages on the site, in order, and a draft never", () => {
    expect(complete.listed).toBe(true);
    expect(plusDraft.listed).toBe(false);
    const listed = listedPackages([plusDraft, complete, free]);
    expect(listed.map((p) => p.slug)).toEqual(["free", "complete"]);
    expect(paidPackages(listed).map((p) => p.slug)).toEqual(["complete"]);
    expect(centerpiece(listed)?.slug).toBe("complete");
  });

  it("never hands the public the admin note or the product", () => {
    const row = fromPublicRow({ slug: "complete", kind: "subscription", name: "X", price_cents: 13000, listed: true, admin_note: "secret", product_id: "abc" });
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(JSON.stringify(row)).not.toContain("abc");
    // the SQL the public reads builds its JSON from public fields only
    const json = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.coaching_package_json"), MIGRATION.indexOf("REVOKE ALL ON FUNCTION public.coaching_package_json"));
    expect(json).not.toMatch(/admin_note|product_id|published_by/);
  });

  it("answers what coaching costs from the packages on the site, never a blanket 'starts at'", () => {
    const a = costAnswer([complete, plusDraft, free])!;
    expect(a).toContain("Complete Online Coaching is $130 a month.");
    expect(a).toContain("Canadian dollars, plus applicable tax");
    expect(a).not.toContain("Coaching Plus");
    expect(a).not.toMatch(/starts at/i);
    expect(costAnswer([plusDraft])).toBeNull();
  });

  it("writes the pricing as text to paste, with the application link", () => {
    const t = pricingText([complete]);
    expect(t).toContain("Complete Online Coaching (recommended): $130/month CAD, plus applicable tax");
    expect(t).toContain("• Your program");
    expect(t).toContain("Apply: https://jfeffect.com/coaching/apply?package=complete&from=share");
  });

  it("checks a package before it saves and before it goes on the site", () => {
    expect(packageProblems({ ...pkg(), features: ["a"], slug: "Bad Slug" })).toContain("The link name can be lowercase letters, numbers and dashes.");
    expect(packageProblems({ ...pkg(), features: ["a"], included_calls: 9 })[0]).toMatch(/0 to 8/);
    expect(publishProblems(pkg({ status: "draft" }))).toContain("Set it to Active first.");
    expect(publishProblems(pkg({ price_cents: null }))).toContain("Set a price first.");
    expect(publishProblems(pkg({ features: [] }))).toContain("List what's included first.");
    expect(publishProblems(pkg())).toEqual([]);
    expect(statusWord(pkg())).toBe("Live");
    expect(statusWord(pkg({ is_public: false }))).toBe("Unlisted");
  });

  it("says a package's history in words", () => {
    expect(changeWords(null, {})).toEqual(["Created"]);
    const before = { price_cents: 13000, status: "active", is_public: false, name: "A", features: ["x"] };
    const after = { price_cents: 14000, status: "active", is_public: true, name: "A", features: ["x"] };
    expect(changeWords(before, after)).toEqual(["Price $130 → $140", "Made public"]);
  });

  it("says included calls once", () => {
    expect(callsLine({ includedCalls: 2, callMinutes: 30 })).toBe("Two private 30-minute video calls each billing month");
    expect(callsLine({ includedCalls: 0, callMinutes: 30 })).toBeNull();
    expect(cardFeatures({ ...plusDraft, features: ["Everything in Complete"] })).toContain("Two private 30-minute video calls each billing month");
    expect(cardFeatures({ ...plusDraft, features: ["Two calls with me"] })).toEqual(["Two calls with me"]);
    expect(cardFileName([complete], "single", "post", "png")).toBe("jf-effect-complete-post.png");
  });

  it("says the calls' rules in one answer: the allowance, 24 hours, coach cancels, no rollover", () => {
    const a = callsPolicy(plusDraft)!;
    expect(a).toContain("two private 30-minute video calls each billing month");
    expect(a).toContain("Cancel at least 24 hours ahead and the call goes back to you.");
    expect(a).toContain("A later cancel or a no-show uses it.");
    expect(a).toContain("it never counts against you");
    expect(a).toContain("Unused calls don't carry over");
    expect(callsPolicy(complete)).toBeNull();
  });

  it("anchors the recommended package on the next listed package's price, never a made-up one", () => {
    const nutrition = toPublic(pkg({ slug: "nutrition", name: "Nutrition Coaching", price_cents: 9900, recommended: false, sort_order: 20 }));
    const plusLive = { ...plusDraft, listed: true };
    expect(anchorLine(complete, [nutrition, complete, plusLive])).toBe("$31 more than Nutrition Coaching");
    // nothing cheaper listed: no anchor at all (never a crossed-out or "worth" price)
    expect(anchorLine(complete, [complete, plusLive])).toBeNull();
    // only the recommended one carries it
    expect(anchorLine(plusLive, [nutrition, complete, plusLive])).toBeNull();
  });

  it("asks 'which one is you?' from the packages on the site: free first, then by price", () => {
    const nutrition = toPublic(pkg({ slug: "nutrition", name: "Nutrition Coaching", price_cents: 9900, recommended: false, sort_order: 20, best_for: "You run your own training and want your nutrition handled." }));
    const rows = decisionRows([complete, nutrition, free, plusDraft]);
    expect(rows.map((r) => r.slug)).toEqual(["free", "nutrition", "complete"]);
    expect(rows[0]).toMatchObject({ line: "You want to train on your own.", price: "Free", recommended: false });
    expect(rows[2]).toMatchObject({ price: "$130/month", recommended: true });
    // a draft never shows
    expect(rows.find((r) => r.slug === "plus")).toBeUndefined();
  });

  it("reads action items stored either way", () => {
    expect(actionTexts(["a", { text: "b" }, "", 3])).toEqual(["a", "b"]);
  });
});

describe("included calls: the billing period, never the calendar month", () => {
  it("runs a month from the anchor's day", () => {
    expect(callPeriod("2026-10-04", "2026-11-22")).toEqual({ start: "2026-11-04", end: "2026-12-04" });
    expect(callPeriod("2026-10-04", "2026-11-03")).toEqual({ start: "2026-10-04", end: "2026-11-04" });
    expect(callPeriod("2026-10-04", "2026-11-04")).toEqual({ start: "2026-11-04", end: "2026-12-04" });
  });

  it("clamps an anchor on the 31st to a short month and back", () => {
    expect(callPeriod("2026-01-31", "2027-02-15")).toEqual({ start: "2027-01-31", end: "2027-02-28" });
    expect(callPeriod("2026-01-31", "2027-03-01")).toEqual({ start: "2027-02-28", end: "2027-03-31" });
    expect(callPeriod("2026-01-31", "2026-12-31")).toEqual({ start: "2026-12-31", end: "2027-01-31" });
  });

  it("counts booked, done and missed calls; a cancelled one goes back", () => {
    const u = callUsage(
      2,
      [
        { session_date: "2026-11-10", status: "Completed" },
        { session_date: "2026-11-20", status: "Cancelled" },
        { session_date: "2026-11-25", status: "Scheduled" },
        { session_date: "2026-12-05", status: "Scheduled" },
      ],
      "2026-10-04",
      "2026-11-22",
    );
    expect(u).toEqual({ included: 2, used: 2, left: 0, periodStart: "2026-11-04", periodEnd: "2026-12-04" });
    expect(lastDay("2026-12-04")).toBe("2026-12-03");
  });

  it("anchors on the subscription's billing date when there is one", () => {
    expect(periodAnchor({ next_billing_date: "2026-12-04", period_anchor: "2026-01-01", starts_on: "2026-11-01" })).toBe("2026-12-04");
    expect(periodAnchor({ starts_on: "2026-11-01" })).toBe("2026-11-01");
  });

  it("gives a call back only when it's cancelled far enough ahead", () => {
    expect(canGiveBack("2026-11-23T18:00:00Z", "2026-11-22T17:00:00Z", 24)).toBe(true);
    expect(canGiveBack("2026-11-23T16:00:00Z", "2026-11-22T17:00:00Z", 24)).toBe(false);
  });

  it("the database's period is the same rule (and its usage counts the same statuses)", () => {
    expect(MIGRATION).toContain("FUNCTION public.coaching_call_period(_anchor date, _on date");
    expect(MIGRATION).toContain("least(_day, extract(day FROM (make_date(_y, _m, 1) + interval '1 month - 1 day'))::integer)");
    expect(MIGRATION).toContain("s.status IN ('Scheduled', 'Completed', 'Missed')");
  });
});

describe("included calls are enforced, not just shown", () => {
  it("the database guards a client's own booking under a per-client lock", () => {
    expect(MIGRATION).toContain("CREATE TRIGGER pt_sessions_included_call_guard");
    expect(MIGRATION).toContain("BEFORE INSERT ON public.pt_sessions");
    expect(MIGRATION).toContain("pg_advisory_xact_lock(hashtextextended('coaching_calls:' || NEW.client_id::text, 0))");
    expect(MIGRATION).toContain("coalesce(NEW.booked_via, '') NOT IN ('client_app', 'booking_page')");
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.coaching_call_usage(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("the booking path checks before it holds the time, and lists the call only to clients on the package", () => {
    const server = read("src/lib/booking.server.ts");
    expect(server).toContain("const included = await includedCallCheck(admin, type, trustedClient, when, tz);");
    expect(server).toContain('throw new BookingError("invalid", "This call is included with coaching. Sign in with your client account to book it.");');
    const fns = read("src/lib/booking.functions.ts");
    expect(fns).toContain("rows = rows.filter((t) => !callTypes.has(t.id) || mine.has(t.id));");
    expect(fns).toContain("canBook: audienceAllows(type, { serviceTier: client.service_tier }) && onPackage,");
  });

  it("the calls' booking type takes bookings only while the package is active or someone's on it", () => {
    expect(MIGRATION).toContain("'Coaching Plus Call', 'Consultation', 30, 'video', false, false, true, true");
    expect(MIGRATION).toContain("FUNCTION public.coaching_call_card_sync(_card uuid)");
  });
});

describe("only the approved offers are public", () => {
  it("seeds the free app and Complete Coaching ($130) live, everything else a draft", () => {
    const seeds = MIGRATION.slice(MIGRATION.indexOf("INSERT INTO public.coaching_packages"));
    expect(seeds).toMatch(/\('complete', 'subscription', 'Complete Online Coaching'[\s\S]*?13000, 'month', true, 'active', true, 30/);
    expect(seeds).toMatch(/\('nutrition', 'subscription', 'Nutrition Coaching'[\s\S]*?9900, 'month', false, 'draft', false, 20/);
    expect(seeds).toMatch(/\('plus', 'subscription', 'Coaching Plus'[\s\S]*?24900, 'month', false, 'draft', false, 40, 'Apply for coaching', 2, 30/);
    for (const slug of ["technique-review", "competition-strategy", "training-consultation", "nutrition-review"]) {
      expect(seeds).toMatch(new RegExp(`\\('${slug}', 'one_time'[\\s\\S]*?NULL, 'once', false, 'draft', false`));
    }
    expect(seeds).toContain("ON CONFLICT (slug) DO NOTHING");
  });

  it("keeps drafts off the site in the database itself", () => {
    expect(MIGRATION).toContain("CONSTRAINT coaching_packages_public_active CHECK (NOT is_public OR status = 'active')");
    expect(MIGRATION).toContain("CONSTRAINT coaching_packages_public_priced CHECK (NOT is_public OR kind = 'free' OR coalesce(price_cents, 0) > 0)");
    expect(MIGRATION).toContain("WHERE p.status = 'active' AND p.is_public");
    expect(MIGRATION).toContain("WHERE p.slug = lower(btrim(_slug)) AND p.status = 'active'");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.coaching_packages_public() TO anon, authenticated;");
  });

  it("only an admin edits packages; the history is written by the trigger alone", () => {
    expect(MIGRATION).toContain('CREATE POLICY "Admins manage coaching packages"');
    expect(MIGRATION).toContain("REVOKE INSERT, UPDATE, DELETE ON public.coaching_package_versions FROM anon, authenticated;");
    const fns = read("src/lib/coaching-packages/packages.functions.ts");
    expect(fns).toContain('throw new Error("Only the owner can change coaching packages.")');
  });

  it("never touches a sale, a Stripe product or a subscription", () => {
    const fns = read("src/lib/coaching-packages/packages.functions.ts");
    expect(fns).not.toMatch(/from\("purchase_records"\)\s*\.(update|insert|upsert|delete)/);
    expect(fns).not.toMatch(/from\("coaching_products"\)\s*\.(update|insert|upsert|delete)/);
    expect(fns).not.toMatch(/import[^\n]*stripe|\bstripe\./i);
    expect(MIGRATION).not.toMatch(/UPDATE public\.(purchase_records|coaching_products)/);
  });
});

describe("the public pages read the packages, never type them", () => {
  it("the landing page and the coaching page draw the packages from data", () => {
    const landing = read("src/components/landing/landing-page.tsx");
    expect(landing).toContain("<CoachingPackagesGrid packages={list} from=\"home\" calls={false} />");
    expect(landing).not.toMatch(/\$130|\$99|\$249/);
    const coaching = read("src/routes/coaching.index.tsx");
    expect(coaching).toContain("<CoachingPackagesGrid packages={packages} from=\"coaching\" />");
    expect(coaching).not.toMatch(/\$130|\$99|\$249/);
    expect(read("src/routes/index.tsx")).toContain("loader: () => ({ packages: getPublicPackages() }),");
  });

  it("every price says CAD plus applicable tax and the recommended one says so", () => {
    const card = read("src/components/sales/coaching-packages.tsx");
    expect(card).toContain("TAX_NOTE");
    expect(card).toContain("Recommended");
    expect(card).not.toContain("Most Popular");
  });

  it("the application carries the package from the card's link, and says applying charges nothing", () => {
    const apply = read("src/routes/coaching.apply.tsx");
    expect(apply).toContain('params.get("package")');
    expect(apply).toContain("package: pkg?.slug ??");
    expect(apply).toContain("applying\n                doesn't sign you up or charge you anything");
    expect(apply).toContain("Nothing has been charged. You only pay once we've talked and agreed to start.");
    const server = read("src/lib/coaching-applications.functions.ts");
    expect(server).toContain('rpc("coaching_package_public", { _slug: data.package })');
    expect(server).toContain("coaching_interest: pkg?.name ?? null,");
  });
});

describe("call prep keeps what's on file apart from the app's read", () => {
  const base: PrepInput = {
    today: "2026-11-22",
    topics: "My squat depth and the meet in February",
    bookingNote: null,
    workouts: { planned: 12, done: 8, missed: 4, lastDone: "2026-11-20", avgRating: 4.2 },
    bodyweight: { unit: "lb", latestKg: 82.5, latestDate: "2026-11-21", avg7Kg: 82.8, weeklyChangeKg: -0.3, goalKg: 80, goalDate: "2027-02-08", stale: false },
    checkins: { count: 3, latest: "2026-11-16", adherence: 4, poorSleep: 2, lowEnergy: 0, stress: 0 },
    nutrition: { phase: "Fat Loss", kcalLow: 2200, kcalHigh: 2500, since: "2026-11-01" },
    pain: [{ label: "Left shoulder", status: "recurring", trend: "worse", reasons: ["getting worse"] }],
    weightRead: "Hold: progressing as planned.",
    previous: { date: "2026-11-05", actionItems: ["Film the top set"], nextPriorities: null, shared: true },
    calls: { used: 1, included: 2, periodEnd: "2026-12-04" },
  };

  it("puts records in facts and interpretations in reads", () => {
    const p = buildCallPrep(base);
    expect(p.theirWords).toEqual(["My squat depth and the meet in February"]);
    expect(p.facts).toContain("Workouts, last 4 weeks: 8 of 12 planned done, 4 missed. Last one Nov 20.");
    expect(p.facts.some((f) => f.startsWith("Bodyweight: 181.9 lb on Nov 21"))).toBe(true);
    expect(p.facts).toContain("Pain reported: Left shoulder (recurring, worse).");
    expect(p.reads.some((r) => r.startsWith("Consistency looks like the thing to ask about"))).toBe(true);
    expect(p.reads.some((r) => r.includes("Not a diagnosis"))).toBe(true);
    expect(p.reads).toContain("Bodyweight engine: Hold: progressing as planned.");
    // no read ever sits among the facts
    expect(p.facts.join(" ")).not.toMatch(/looks like|may need|engine/);
    expect(p.followUp?.actionItems).toEqual(["Film the top set"]);
  });

  it("says what it couldn't read instead of looking empty", () => {
    const p = buildCallPrep({ ...base, workouts: null, bodyweight: null, nutrition: null, checkins: null, pain: [], weightRead: null });
    expect(p.missing).toEqual(["workouts", "bodyweight", "nutrition plan", "weekly check-ins"]);
  });

  it("reads the client's own words from a booking note", () => {
    expect(bookingWords("Default notes\n\nNote from Marc: Talk about my bench")).toBe("Talk about my bench");
    expect(bookingWords("Just a coach note")).toBeNull();
  });

  it("sends the action items, never the private note", () => {
    const m = actionItemsMessage({ firstName: "Marc", date: "2026-11-22", actionItems: ["Film Monday's top set"], nextPriorities: "Depth first" });
    expect(m).toBe("Marc, here are your next steps from our call on Nov 22:\n• Film Monday's top set\n\nNext priorities: Depth first");
    const sheet = read("src/components/schedule/call-prep-sheet.tsx");
    expect(sheet).not.toMatch(/coachNote|useCoachNote|saveCoachNote/);
  });

  it("the review table is staff only and the client only sees what was sent", () => {
    expect(MIGRATION).toContain('CREATE POLICY "Staff manage call reviews" ON public.coaching_call_reviews');
    const fns = read("src/lib/coaching-packages/packages.functions.ts");
    expect(fns).toContain('.not("shared_at", "is", null)');
  });
});
