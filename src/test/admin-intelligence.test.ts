import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  aiArea,
  changePct,
  perOp,
  projectMonth,
  readBudget,
  smsArea,
  suggestedBudget,
  usageAlerts,
  usd,
  type AlertInput,
} from "@/lib/admin-intel/usage-model";
import {
  coarsePlace,
  featureOf,
  normalizePath,
  optedOut,
  osFor,
  platformOf,
  sessionStillGoing,
  surfaceOf,
  SESSION_IDLE_MS,
} from "@/lib/app-pulse/pulse-rules";
import { prettySource, shapeAppIntel, takeaways } from "@/lib/admin-intel/app-intel-model";
import { planChangeLines, planChangeProblems, type PlanChangeReview } from "@/lib/admin-intel/membership-model";
import { fitView } from "@/components/admin/intel/place-map";
import { spendHoldFor } from "@/lib/ai/ai-monitor.server";

const read = (p: string) => readFileSync(p, "utf8");

describe("usage & spend: areas", () => {
  it("files every AI task under the area the coach would name", () => {
    expect(aiArea("strategy")).toBe("coaching");
    expect(aiArea("recovery_write:pain")).toBe("coaching");
    expect(aiArea("checkin_recap")).toBe("coaching");
    expect(aiArea("meal_estimate")).toBe("clients");
    expect(aiArea("program_import")).toBe("clients");
    expect(aiArea("post_write")).toBe("crew");
    expect(aiArea("daily_visual")).toBe("crew");
    expect(aiArea("assistant")).toBe("cleo");
    expect(aiArea("lead_reply")).toBe("sales");
    expect(aiArea("untagged")).toBe("other");
    expect(aiArea("something_new")).toBe("other");
  });
  it("files texts by purpose", () => {
    expect(smsArea("security")).toBe("security");
    expect(smsArea("session")).toBe("clients");
    expect(smsArea("reminder")).toBe("automations");
    expect(smsArea("payment")).toBe("sales");
    expect(smsArea("automation")).toBe("membership");
    expect(smsArea("weird")).toBe("other");
  });
});

describe("usage & spend: the month", () => {
  it("projects the month at today's pace", () => {
    expect(projectMonth(10, 10, 30)).toBe(30);
    expect(projectMonth(0, 5, 30)).toBe(0);
    expect(projectMonth(5, 0, 30)).toBe(5);
  });
  it("suggests a budget with headroom, rounded to a clean figure, never under the floor", () => {
    expect(suggestedBudget(0)).toBe(10);
    expect(suggestedBudget(30)).toBe(45);
    expect(suggestedBudget(100)).toBe(150);
    expect(suggestedBudget(180)).toBe(300);
  });
  it("reads a budget into a level", () => {
    expect(readBudget(5, null).level).toBe("none");
    expect(readBudget(4, 10).level).toBe("ok");
    expect(readBudget(6, 10).level).toBe("watch");
    expect(readBudget(8.5, 10).level).toBe("close");
    expect(readBudget(10, 10)).toMatchObject({ level: "over", pct: 100 });
  });
  it("compares periods only when there's something to compare", () => {
    expect(changePct(15, 10)).toBe(50);
    expect(changePct(5, 0)).toBeNull();
  });
  it("prints tiny costs honestly", () => {
    expect(usd(0.004)).toBe("<$0.01");
    expect(usd(0)).toBe("$0.00");
    expect(perOp(0.0042)).toBe("$0.0042");
    expect(perOp(null)).toBe("—");
  });
});

describe("usage & spend: alerts", () => {
  const base: AlertInput = {
    aiStatus: "ok",
    aiSince: null,
    waiting: 0,
    aiMonth: readBudget(0, null),
    aiProjected: 0,
    aiHeld: false,
    smsMonth: readBudget(1, 10),
    features: [],
    unpricedCalls: 0,
    gatewayCost: 0,
    smsSent: 0,
    smsUndelivered: 0,
    smsUnconfirmed: 0,
    unusual: null,
  };
  it("a quiet month says nothing", () => {
    expect(usageAlerts(base)).toEqual([]);
  });
  it("leads with AI being down, says what's waiting, and offers the next step", () => {
    const a = usageAlerts({ ...base, aiStatus: "credits", waiting: 3, aiMonth: readBudget(12, 10), aiProjected: 40 });
    expect(a[0].key).toBe("ai-down");
    expect(a[0].body).toContain("3 jobs are waiting");
    expect(a.map((x) => x.key)).toContain("ai-over");
    expect(a.every((x) => !!x.action)).toBe(true);
  });
  it("asks for a budget only when AI is costing something", () => {
    expect(usageAlerts({ ...base, aiProjected: 25 }).map((a) => a.key)).toEqual(["ai-no-budget"]);
  });
  it("names a failing feature only with enough calls to mean it", () => {
    expect(usageAlerts({ ...base, features: [{ key: "x", name: "X", calls: 5, failed: 3 }] })).toEqual([]);
    expect(usageAlerts({ ...base, features: [{ key: "x", name: "X", calls: 20, failed: 4 }] })[0].title).toContain("20%");
  });
  it("flags Lovable credits being spent", () => {
    expect(usageAlerts({ ...base, gatewayCost: 1.2 }).map((a) => a.key)).toEqual(["ai-gateway"]);
  });
});

describe("visits: what's recorded", () => {
  it("never keeps an id, a token or a query string", () => {
    expect(normalizePath("/portal/workouts/2f9c1d8e-1111-4aaa-8bbb-123456789abc?x=1")).toBe("/portal/workouts/:id");
    expect(normalizePath("/b/abcdefghijklmnopqrstuvwxyz012345")).toBe("/b/:id");
    expect(normalizePath("/pay/short")).toBe("/pay/:id");
    expect(normalizePath("/admin/clients/12345")).toBe("/admin/clients/:id");
    expect(normalizePath("/")).toBe("/");
  });
  it("names each page's feature", () => {
    expect(featureOf("/portal")).toBe("Home");
    expect(featureOf("/portal/workouts/abc")).toBe("Workout logger");
    expect(featureOf("/portal/workouts")).toBe("Workouts");
    expect(featureOf("/portal/community")).toBe("Crew");
    expect(featureOf("/portal/nutrition-studio")).toBe("Nutrition studio");
    expect(featureOf("/admin/usage")).toBe("Usage & spend");
    expect(featureOf("/")).toBe("Landing");
    expect(featureOf("/coaching/apply")).toBe("Coaching application");
    expect(featureOf("/somewhere")).toBe("Other");
  });
  it("tells the site, the app and the admin apart", () => {
    expect(surfaceOf("/")).toBe("site");
    expect(surfaceOf("/portal/workouts")).toBe("app");
    expect(surfaceOf("/admin/clients")).toBe("admin");
    expect(surfaceOf("/coaching")).toBe("site");
    expect(surfaceOf("/coach/programs")).toBe("admin");
  });
  it("ends a visit after 30 minutes away", () => {
    const now = 1_000_000_000;
    expect(sessionStillGoing(now - 60_000, now)).toBe(true);
    expect(sessionStillGoing(now - SESSION_IDLE_MS - 1, now)).toBe(false);
    expect(sessionStillGoing(null, now)).toBe(false);
  });
  it("reads the platform and system, never a model", () => {
    expect(platformOf({ native: "ios", standalone: false })).toBe("ios_app");
    expect(platformOf({ native: null, standalone: true })).toBe("home_screen");
    expect(osFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(osFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("macos");
    expect(osFor("Mozilla/5.0 (Linux; Android 14)", 5)).toBe("android");
  });
  it("honours Global Privacy Control and Do Not Track", () => {
    expect(optedOut({ globalPrivacyControl: true })).toBe(true);
    expect(optedOut({ doNotTrack: "1" })).toBe(true);
    expect(optedOut({})).toBe(false);
  });
  it("keeps a place to a city and 0.1 degree, and drops unknowns", () => {
    expect(coarsePlace({ country: "ca", region: "Manitoba", city: "Selkirk", latitude: "50.14567", longitude: -96.88412 })).toEqual({
      country: "CA",
      region: "Manitoba",
      city: "Selkirk",
      lat: 50.1,
      lng: -96.9,
    });
    expect(coarsePlace({ country: "XX", city: "", latitude: "nope", longitude: 999 })).toEqual({
      country: null,
      region: null,
      city: null,
      lat: null,
      lng: null,
    });
    expect(coarsePlace({ city: encodeURIComponent("Saint-Boniface") }).city).toBe("Saint-Boniface");
  });
});

describe("visits: the collection path", () => {
  it("never stores an IP, and lets a browser opt out", () => {
    const server = read("src/lib/app-pulse/pulse.server.ts");
    expect(server).not.toMatch(/_ip|ip_address|signup_ip/);
    expect(server).toContain("parsed.optOut");
    const client = read("src/lib/app-pulse/pulse-client.ts");
    expect(client).toContain("povActive(uid)");
    expect(client).toContain("if (!uid && out)");
    // nobody can claim a place: the geo headers are replaced by the host's own, or dropped
    expect(read("src/server.ts")).toContain('headers.delete(k)');
  });
  it("is loaded after the app paints, from the root", () => {
    expect(read("src/routes/__root.tsx")).toContain("<AppPulse />");
    expect(read("src/components/app-pulse.tsx")).toContain('import("@/lib/app-pulse/pulse-client")');
  });
});

describe("app & website read", () => {
  it("shapes a thin read without inventing anything", () => {
    const v = shapeAppIntel({});
    expect(v.now.mau).toBe(0);
    expect(v.places).toEqual([]);
    expect(v.takeaways).toEqual([]);
  });
  it("adds people across audiences but never counts staff pages as use", () => {
    const v = shapeAppIntel({
      features: [
        { feature: "Workouts", audience: "client", views: 10, people: 3 },
        { feature: "Workouts", audience: "member", views: 4, people: 2 },
        { feature: "Dashboard", audience: "staff", views: 50, people: 1 },
      ],
    });
    expect(v.pages).toEqual([{ feature: "Workouts", people: 5, views: 14 }]);
  });
  it("labels places and sources plainly", () => {
    const v = shapeAppIntel({ places: [{ country: "CA", region: "Manitoba", city: "Selkirk", lat: 50.1, lng: -96.9, sessions: 3 }] });
    expect(v.places[0].label).toBe("Selkirk, Manitoba");
    expect(prettySource("l.instagram.com")).toBe("Instagram");
    expect(prettySource("Direct")).toBe("Direct or typed");
  });
  it("takeaways come from the numbers, only with enough data", () => {
    const v = shapeAppIntel({
      onboarding: { joined: 10, came_back: 8, trained_week1: 3, ever_trained: 5, active_week4: 2, week4_eligible: 6 },
    });
    const t = takeaways(v).map((x) => x.text);
    expect(t[0]).toContain("3 logged a workout in their first week");
    expect(t[1]).toContain("2 of 6");
  });
});

describe("membership: changing plans", () => {
  const review = (o: Partial<PlanChangeReview> = {}): PlanChangeReview => ({
    clientId: "c",
    name: "Marc",
    tier: "coaching",
    hasLogin: true,
    inactive: false,
    liveCharges: [],
    endingCharges: [],
    owedCents: 0,
    upcomingSessions: 0,
    memberRecord: false,
    memberAccessOff: false,
    assignedCoachId: null,
    coaches: [],
    problems: [],
    ...o,
  });
  it("never leaves a coaching subscription charging a free member", () => {
    const p = planChangeProblems(review({ liveCharges: [{ name: "Complete Online Coaching", nextCharge: null }] }));
    expect(p[0]).toContain("would keep charging");
    expect(p[0]).toContain("never charges or refunds");
    // moving up to coaching isn't stopped by a charge
    expect(planChangeProblems(review({ tier: "membership", liveCharges: [{ name: "x", nextCharge: null }] }))).toEqual([]);
  });
  it("needs a login and a live account", () => {
    expect(planChangeProblems(review({ hasLogin: false }))[0]).toContain("hasn't signed in");
    expect(planChangeProblems(review({ inactive: true }))[0]).toContain("deactivated");
  });
  it("says what stays and what's still owed", () => {
    const lines = planChangeLines(review({ owedCents: 67200, upcomingSessions: 2 }), "membership");
    expect(lines[0]).toContain("Same account");
    expect(lines.join(" ")).toContain("$672.00; that stays owed");
    expect(lines.join(" ")).toContain("2 booked sessions stay booked");
  });
  it("the server re-reads the review and logs the change", () => {
    const fn = read("src/lib/admin-intel/membership.functions.ts");
    expect(fn).toContain("const review = await readReview(db, data.clientId);");
    expect(fn).toContain("planChangeProblems(review, data.to)");
    expect(fn).toContain('event: data.to === "coaching" ? "moved_to_coaching" : "moved_to_membership"');
    expect(fn).not.toMatch(/stripe\.|from\("stripe/i);
    expect(read("src/lib/members.functions.ts")).toContain('event: "moved_to_coaching"');
  });
});

describe("the map and the hold", () => {
  it("fits every place with room around it", () => {
    const one = fitView([{ lat: 50.1, lng: -96.9 }], 600, 340);
    expect(one.z).toBeLessThanOrEqual(8);
    expect(one.lat).toBeCloseTo(50.1, 0);
    const spread = fitView([{ lat: 50.1, lng: -96.9 }, { lat: 43.7, lng: -79.4 }], 600, 340);
    expect(spread.z).toBeLessThan(one.z);
    expect(fitView([], 600, 340).z).toBe(3);
  });
  it("holds background AI only past a budget, only when the owner left it on", () => {
    expect(spendHoldFor({ monthly_usd: 20 }, 25).held).toBe(true);
    expect(spendHoldFor({ monthly_usd: 20, hold_background: false }, 25).held).toBe(false);
    expect(spendHoldFor({ monthly_usd: 0 }, 25).held).toBe(false);
    expect(spendHoldFor(null, 25).held).toBe(false);
    expect(spendHoldFor({ monthly_usd: "30" }, 29.99).held).toBe(false);
  });
});

describe("admin menu", () => {
  it("Insights holds App & website and Usage & spend; Membership lists the home and members only", async () => {
    const { buildInternalNavCollapsed } = await import("@/lib/internal-nav");
    const admin = buildInternalNavCollapsed("admin");
    const insights = admin.find((i) => i.label === "Insights")!;
    expect(insights.to).toBe("/admin/insights");
    expect((insights.children ?? []).filter((c) => !c.searchOnly).map((c) => c.to)).toEqual(["/admin/insights", "/admin/usage"]);
    const membership = admin.find((i) => i.label === "Membership")!;
    expect((membership.children ?? []).filter((c) => !c.searchOnly).map((c) => c.to)).toEqual(["/admin/membership", "/admin/members"]);
    // nothing left the app: the rest are still found by search
    expect((membership.children ?? []).map((c) => c.to)).toEqual(
      expect.arrayContaining(["/admin/membership/billing", "/admin/membership/action-needed", "/admin/membership/checkout-settings"]),
    );
    expect(buildInternalNavCollapsed("coach").some((i) => i.label === "Insights")).toBe(false);
  });
});
