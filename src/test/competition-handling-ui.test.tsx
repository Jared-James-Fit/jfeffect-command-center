/**
 * Competition preparation's screens render what the engines decided (Nov 26
 * 2026): the coach's overview (countdown, readiness by what matters, the one
 * recommendation, what's outstanding), the gameplan with its state, the
 * timeline with every time labelled, the checklist, the athlete's onboarding
 * (only the steps that apply, the handling terms on the last one), and the
 * wiring: the tab's four sections, the invite route, the meeting's card, and
 * the phone app never paying from the onboarding.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn, createServerFn: () => ({}) }));
vi.mock("@/lib/competition/handling.functions", () => ({ createHandlingFn: vi.fn(), handlingLinkFn: vi.fn(), markInviteSentFn: vi.fn(), handlingPaymentFn: vi.fn(), updateHandlingFn: vi.fn(), gameplanActionFn: vi.fn(), saveScheduleFn: vi.fn(), meetProgressFn: vi.fn(), tickChecklistFn: vi.fn(), reviewChangesFn: vi.fn(), coachSaveInfoFn: vi.fn(), shareWithCoachFn: vi.fn(), handlingOpportunitiesFn: vi.fn(), listHandlingFn: vi.fn(), handlingRecapFn: vi.fn(), getMyMeetFn: vi.fn(), saveMyMeetInfoFn: vi.fn(), acceptMyTermsFn: vi.fn(), confirmMyGameplanFn: vi.fn(), suggestMyGameplanFn: vi.fn(), tickMyChecklistFn: vi.fn(), myHandlingPayUrlFn: vi.fn(), getHandlingInviteFn: vi.fn(), claimHandlingInviteFn: vi.fn(), }));
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ children }: any) => h("a", { href: "#" }, children), useNavigate: () => () => undefined };
});

const { buildTimeline } = await import("@/lib/competition/event-timeline");
const { buildChecklist, readinessOf } = await import("@/lib/competition/prep-checklist");
const { draftGameplan } = await import("@/lib/competition/gameplan");
const { readAthleteInfo, stepsFor } = await import("@/lib/competition/athlete-info");
const { IPF_RULES } = await import("@/lib/competition/rules");
const { handlingTerms } = await import("@/lib/competition/handling");
const { PrepOverview } = await import("@/components/competition/prep/prep-overview");
const { GameplanSection } = await import("@/components/competition/prep/gameplan-section");
const { TimelineSection } = await import("@/components/competition/prep/timeline-section");
const { ChecklistSection } = await import("@/components/competition/prep/checklist-section");
const { MeetOnboarding } = await import("@/components/competition/prep/meet-onboarding");

const TODAY = "2026-11-26";
const info = readAthleteInfo({ targets: { squat: 150, bench: 85, deadlift: 180 }, warmupStyle: "standard", unit: "kg" });
const timeline = buildTimeline({
  meetDate: "2026-12-05",
  weighInHours: 2,
  liftingStart: { value: "09:00", confirmed: true },
  weighIn: { value: null, confirmed: false },
  flight: { value: 1, confirmed: true },
  flights: { value: 2, confirmed: true },
  lifters: { value: 10, confirmed: true },
  travelMinutes: { value: 25, confirmed: false },
});
const checklist = buildChecklist({
  today: TODAY,
  meetDate: "2026-12-05",
  sport: "powerlifting",
  registration: "registered",
  federation: "CPU",
  weightClass: "57",
  classLimitKg: 57,
  bodyweightKg: 56.4,
  scheduleKnown: true,
  weighInKnown: false,
  travel: "local",
  travelMinutesKnown: false,
  rackHeights: { squat: false, bench: false },
  openersSet: false,
  gameplanApproved: false,
  athleteConfirmed: false,
  warmupsConfirmed: false,
  nutritionPlanned: false,
  handled: true,
  intakeComplete: true,
  termsAccepted: false,
  payment: "link",
  states: {},
});
const readiness = readinessOf(checklist, TODAY);
const plan = draftGameplan({ rules: IPF_RULES, info, athlete: { name: "Ari Example", phone: null } });
const prep = {
  today: TODAY,
  tz: "America/Winnipeg",
  competition: { id: "c1", name: "Provincials", meet_date: "2026-12-05", federation: "CPU", rules: null, location: "Winnipeg" },
  client: { id: "cl1", first: "Ari", name: "Ari Example", hasLogin: true, tier: "self_serve" },
  info,
  steps: stepsFor({ sport: "powerlifting", handled: true }),
  infoComplete: true,
  changes: [{ key: "bodyweight", text: "Bodyweight 57 kg → 56.4 kg" }],
  handling: { id: "h1", status: "preparing", payment: "link", handler: "Jared", existingCoach: { name: "Shaina Sagar" }, shareWithCoach: "ask", invite: { state: "ok", sentAt: null, openedAt: null, expiresAt: null, name: "Ari", url: null } },
  plans: { approved: null, draft: null, suggestion: null, versions: [], engine: plan },
  plan,
  planSource: "cleo",
  problems: [],
  timeline,
  checklist,
  readiness,
  next: { label: "Approve the gameplan", when: "today", kind: "checklist" },
  recommendation: { action: "approve_plan", text: "Approve Cleo's gameplan so Ari can confirm it.", why: "Nothing is shown to her until you do." },
  meetLog: [],
};

const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

describe("competition preparation screens", () => {
  it("the overview is countdown, readiness, one recommendation and what's outstanding", () => {
    const html = wrap(createElement(PrepOverview, { prep, onSection: () => {}, onChanged: () => {}, onReviewChanges: () => {} }));
    expect(html).toContain("data-countdown");
    expect(html).toContain("Checklist readiness");
    expect(html).toContain("Review plan");
    expect(html).toContain(`data-readiness="${readiness.verdict}"`);
    expect(html).toContain("Approve Cleo&#x27;s gameplan");
    expect(html).toContain("Ari changed their meet details");
    expect(html).toContain("data-handling-strip");
    expect(html).not.toMatch(/\d+%/);
  });

  it("the gameplan says what it is before it's approved, with Cleo's draft approvable as is", () => {
    const html = wrap(createElement(GameplanSection, { prep, onChanged: () => {} }));
    expect(html).toContain("Cleo&#x27;s draft from what&#x27;s on file");
    expect(html).toContain("data-approve-cleo");
    expect(html).toContain("data-gameplan-attempts");
  });

  it("the timeline labels every time and never presents an estimate as official", () => {
    const html = wrap(createElement(TimelineSection, { timeline, tz: "America/Winnipeg", today: TODAY }));
    expect(html).toMatch(/data-status="confirmed"/);
    expect(html).toMatch(/data-status="(estimated|recommended|unconfirmed)"/);
  });

  it("the checklist lists what's due by importance", () => {
    const html = wrap(createElement(ChecklistSection, { items: checklist, readiness, today: TODAY, who: "athlete" }));
    expect(html).toContain("data-prep-checklist");
  });

  it("onboarding asks only the steps that apply, the terms last, and never pays in a preview", () => {
    const meet = {
      competition: prep.competition,
      steps: prep.steps,
      info: { steps: Object.fromEntries(prep.steps.slice(0, -1).map((s) => [s, TODAY])) },
      infoComplete: false,
      contact: { phone: null },
      handling: { termsAcceptedAt: null, payment: "link", priceCents: 15000, currency: "CAD" },
      terms: { text: handlingTerms({ handler: "Jared", meetName: "Provincials", priceText: "$150" }) },
    };
    const html = wrap(createElement(MeetOnboarding, { meet, previewing: true, onDone: () => {} }));
    expect(html).toContain(`Step ${prep.steps.length} of ${prep.steps.length}`);
    expect(html).toContain("data-handling-terms");
    expect(html).toContain("data-web-only");
    expect(html).toContain("They tap Done here");
    // a sport that isn't powerlifting is never asked lifts or warm-ups
    expect(stepsFor({ sport: "strongman", handled: false })).not.toContain("lifts");
  });
});

describe("wiring", () => {
  const tab = readFileSync("src/components/competition/competition-tab.tsx", "utf8");
  it("the Competition tab is Overview · Gameplan · Timeline · Checklist, the rest under More", () => {
    expect(tab).toMatch(/\["overview", "Overview"\],\s*\["gameplan", "Gameplan"\],\s*\["timeline", "Timeline"\],\s*\["checklist", "Checklist"\],\s*\["more", "More"\]/);
  });
  it("the meeting's outcome offers the handling it agreed to", () => {
    expect(readFileSync("src/components/coaching-sessions/session-after.tsx", "utf8")).toContain("<HandlingOpportunities sessionId={s.id} />");
  });
  it("the invite page is never indexed or referred, and its link goes through the setup invite", () => {
    const route = readFileSync("src/routes/h.$token.tsx", "utf8");
    expect(route).toContain('content: "noindex"');
    expect(route).toContain('content: "no-referrer"');
    expect(route).toContain("<SetupInviteStep");
  });
  it("a link cut short or mistyped reads as one that doesn't work, never as an error", () => {
    const fns = readFileSync("src/lib/competition/handling.functions.ts", "utf8");
    const invite = fns.slice(fns.indexOf("export const getHandlingInviteFn"), fns.indexOf("export const getHandlingInviteFn") + 900);
    expect(invite).toContain("z.string().max(200)");
    expect(invite).not.toMatch(/z\.string\(\)\.regex/);
    expect(invite).toMatch(/if \(!\/\^\[A-Za-z0-9_-\]\{32\}\$\/\.test\(data\.token\)\) return \{ state: "invalid" as const \}/);
  });
  it("the phone app never pays for handling", () => {
    const fns = readFileSync("src/lib/competition/handling.functions.ts", "utf8");
    expect(fns).toMatch(/myHandlingPayUrlFn[\s\S]{0,400}nativeAppRequest\(\)\) return \{ url: null \}/);
    expect(readFileSync("src/components/competition/prep/meet-onboarding.tsx", "utf8")).toContain("goToPayment(");
  });
  it("nothing in preparation calls a model", () => {
    for (const f of ["prep.server.ts", "handling.functions.ts", "gameplan.ts", "event-timeline.ts", "prep-checklist.ts", "opportunities.ts"])
      expect(readFileSync(`src/lib/competition/${f}`, "utf8")).not.toMatch(/callModel|askRoute|stagedCall/);
  });
});


describe("competition review clarity", () => {
  it("uses an app-styled picker rather than a native competition select", () => {
    const tab = readFileSync("src/components/competition/competition-tab.tsx", "utf8");
    expect(tab).toContain("data-competition-picker");
    expect(tab).toContain('aria-label="Switch competition"');
    expect(tab).not.toContain('aria-label="Competition"');
    expect(tab).toMatch(/setAssessmentId\(null\);\s*setCompetitionId\(id\)/);
  });
  it("renders the assessment's own meet and keeps detailed analysis available", () => {
    const sheet = readFileSync("src/components/competition/assessment-sheet.tsx", "utf8");
    expect(sheet).toContain("a.competition_context.name");
    expect(sheet).toContain("Detailed coaching analysis");
    expect(sheet).toContain("n.coach_summary");
    expect(sheet).toContain("Issues to review");
    const fn = readFileSync("src/lib/competition/competition.functions.ts", "utf8");
    const get = fn.slice(fn.indexOf("export const getAssessmentFn"), fn.indexOf("export const assessmentActionFn"));
    expect(get).toContain("reachAssessment");
    expect(get).toContain('.eq("id", row.competition_id)');
  });
});


describe("internal competition isolation", () => {
  it("excludes named rehearsal fixtures but preserves actual meets with test delivery protection", () => {
    const workspace = readFileSync("src/lib/competition/workspace.server.ts", "utf8");
    const coach = workspace.slice(workspace.indexOf("export async function loadWorkspace"), workspace.indexOf("export async function loadOverview"));
    const overview = workspace.slice(workspace.indexOf("export async function loadOverview"));
    const fn = readFileSync("src/lib/competition/competition.functions.ts", "utf8");
    const athlete = fn.slice(fn.indexOf("export const getMyCompetitionsFn"));
    for (const source of [coach, overview, athlete]) expect(source).toContain('.or("internal_test.eq.false,name.not.ilike.Validation rehearsal:*")');
    expect(coach).toContain('String(c.meet_end_date ?? c.meet_date) >= today');
  });
  it("does not use test results for real forecast calibration", () => {
    const loader = readFileSync("src/lib/competition/load.server.ts", "utf8");
    expect(loader).toContain('.eq("competitions.internal_test", false)');
  });
});
