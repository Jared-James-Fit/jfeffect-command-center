/**
 * The roadmap's screens render what the engine decided: the athlete's card
 * (only once a roadmap is in effect; a self-coached athlete with no goal is
 * asked for one), the coach's card with the draft to approve, and the
 * dashboard board, which stays hidden with nothing to show. Plus the wiring:
 * the weekly check-in carries the roadmap's follow-ups, the AI route is on the
 * OpenAI key, and the pushes exist.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildAssessment, type AssessmentInput } from "@/lib/weight-management/assessment";
import { addDays } from "@/lib/weight-management/units";
import type { CoachRoadmapView, RoadmapView } from "@/lib/nutrition-roadmap/view";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn, createServerFn: () => ({}) }));
vi.mock("@/lib/nutrition-roadmap/roadmap.functions", () => ({
  getMyRoadmapFn: vi.fn(),
  getClientRoadmapFn: vi.fn(),
  roadmapBoardFn: vi.fn(),
  refreshClientRoadmapFn: vi.fn(),
  decideRoadmapRevisionFn: vi.fn(),
  saveRoadmapPrefsFn: vi.fn(),
  setRoadmapConsentFn: vi.fn(),
  saveMyRoadmapGoalFn: vi.fn(),
  submitRoadmapCheckinFn: vi.fn(),
  explainRoadmapFn: vi.fn(),
}));
vi.mock("@/lib/client-impersonation", () => ({ useClientImpersonation: () => ({ client: null }) }));
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ children, ...p }: any) => h("a", { href: "#", "data-roadmap-board-row": p["data-roadmap-board-row"] }, children) };
});

const { buildRoadmap } = await import("@/lib/nutrition-roadmap/build");
const { NutritionRoadmapCard } = await import("@/components/nutrition-roadmap/roadmap-athlete");
const { RoadmapCoachCard } = await import("@/components/nutrition-roadmap/roadmap-coach");
const { RoadmapBoardCard } = await import("@/components/nutrition-roadmap/roadmap-board-card");
const { myRoadmapKey, clientRoadmapKey, roadmapBoardKey } = await import("@/components/nutrition-roadmap/roadmap-queries");

const TODAY = new Date().toISOString().slice(0, 10);
const series = (days: number, end: number, perWeek: number) => Array.from({ length: days }, (_, i) => ({ date: addDays(TODAY, -(days - 1 - i)), kg: end - (perWeek * (days - 1 - i)) / 7 + 0.2 * Math.sin(i * 2.3) }));

function input(o: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    today: TODAY,
    unit: "kg",
    speedUnit: "kmh",
    sex: "M",
    age: 29,
    heightCm: 180,
    level: "intermediate",
    weighIns: series(28, 86, 0),
    goal: { type: "lose", kg: 81, kgMax: null, date: addDays(TODAY, 84) },
    meet: null,
    powerlifter: false,
    plan: { start: null, weeklyKcal: null, phase: null, starts: [] },
    checkins: [{ date: addDays(TODAY, -2), answers: { nutrition_rating: 4.5, recovery_flags: ["All good"] } }],
    cardio: { targets: [], lastChanged: null, history: null, done: null, planned: null },
    trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
    heavyLowerDays: [],
    sessionMinutes: 75,
    dailySteps: 8000,
    water: { avgMl: null, targetMl: null, daysLogged: 0 },
    waist: [],
    performance: { lower: "steady", detail: null },
    health: { walkingLimits: [], fluidRestriction: false },
    profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
    pastPhases: [],
    ...o,
  };
}

function read(o: Partial<AssessmentInput> = {}) {
  const inp = input(o);
  return buildRoadmap({ today: TODAY, input: inp, assessment: buildAssessment(inp), selfCoached: false, planNow: null, current: null, targetsChangedOn: null, observed: null, healthTexts: [], answers: [], recentEvent: null, nextEvent: null, prefs: { everyDays: null, lockCompetition: false }, consent: false, active: null, lastCheckin: null, missedCheckins: 0 });
}

function view(o: Partial<RoadmapView> = {}): RoadmapView {
  const r = read();
  return {
    state: "ready",
    clientId: "client-1",
    selfCoached: false,
    firstName: "Sam",
    unit: "kg",
    sex: "M",
    read: r.read,
    explanation: null,
    activeRevisionId: "rev-1",
    pending: null,
    history: [],
    checkin: { due: false, dueOn: r.read.checkin.on, asks: [], reason: r.read.checkin.reason },
    series: input().weighIns,
    consent: false,
    goal: { type: "lose", value: 81, unit: "kg", date: addDays(TODAY, 84), meet: null },
    canEdit: true,
    current: null,
    missing: [],
    ...o,
  };
}

const wrap = (qc: QueryClient, el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el));

describe("the athlete's roadmap card", () => {
  it("shows the block, the goal, where they stand and the next check-in", () => {
    const qc = new QueryClient();
    qc.setQueryData(myRoadmapKey(null), view());
    const html = wrap(qc, createElement(NutritionRoadmapCard));
    expect(html).toContain('data-roadmap-card="ready"');
    expect(html).toContain("Controlled fat loss");
    expect(html).toContain("81 kg by");
    expect(html).toMatch(/On track|Behind plan|Insufficient data|Ahead of plan/);
    expect(html).toContain("Next review");
    expect(html).toContain("Week 1 of");
  });
  it("a coached athlete whose coach hasn't approved one sees nothing", () => {
    const qc = new QueryClient();
    qc.setQueryData(myRoadmapKey(null), view({ state: "waiting_coach", read: null }));
    expect(wrap(qc, createElement(NutritionRoadmapCard))).toBe("");
  });
  it("a self-coached athlete with no goal is asked for one; a due check-in is one tap", () => {
    const qc = new QueryClient();
    qc.setQueryData(myRoadmapKey(null), view({ state: "no_goal", read: null, selfCoached: true }));
    expect(wrap(qc, createElement(NutritionRoadmapCard))).toContain("Set a goal");
    const qc2 = new QueryClient();
    qc2.setQueryData(myRoadmapKey(null), view({ selfCoached: true, checkin: { due: true, dueOn: TODAY, asks: ["tracking"], reason: "Behind plan" } }));
    const html = wrap(qc2, createElement(NutritionRoadmapCard));
    expect(html).toContain("data-roadmap-checkin-open");
    expect(html).toContain("Next check-in");
  });
  it("a coach viewing as the athlete can't check in for them", () => {
    const qc = new QueryClient();
    qc.setQueryData(myRoadmapKey(null), view({ selfCoached: true, canEdit: false, checkin: { due: true, dueOn: TODAY, asks: [], reason: "" } }));
    expect(wrap(qc, createElement(NutritionRoadmapCard))).not.toContain("data-roadmap-checkin-open");
  });
});

describe("the coach's roadmap card", () => {
  it("leads with the draft to approve, then the journey and settings", () => {
    const r = read();
    const qc = new QueryClient();
    const v: CoachRoadmapView = {
      ...view({ activeRevisionId: null }),
      pending: { id: "rev-2", createdAt: new Date().toISOString(), trigger: "initial", status: "proposed", summary: null, changes: ["A first roadmap."], autoApplied: false, decidedAt: null, note: null, decider: "coach", plan: r.fresh, proposal: r.read.decision },
      prefs: { everyDays: null, lockCompetition: false, reminders: true },
      draft: null,
    };
    qc.setQueryData(clientRoadmapKey("client-1"), v);
    const html = wrap(qc, createElement(RoadmapCoachCard, { clientId: "client-1" }));
    expect(html).toContain("Nutrition roadmap");
    expect(html).toContain('data-roadmap-proposal="initial"');
    expect(html).toContain("First draft");
    expect(html).toContain("data-roadmap-approve");
    expect(html).toContain("Sam sees nothing until you approve.");
    expect(html).toContain("The journey");
    expect(html).toContain("Settings");
    expect(html).toContain("Automatic reviews");
  });
});

describe("the dashboard board", () => {
  it("is hidden with nothing to show, and lists who needs a look first", () => {
    const qc = new QueryClient();
    qc.setQueryData(roadmapBoardKey, []);
    expect(wrap(qc, createElement(RoadmapBoardCard))).toBe("");
    const qc2 = new QueryClient();
    qc2.setQueryData(roadmapBoardKey, [
      { clientId: "a", name: "Alex Doe", status: "on_track", headline: "On track", needsCoach: false, decision: null, nextCheckinOn: TODAY, waiting: null },
      { clientId: "b", name: "Blake Roe", status: "behind", headline: "Behind", needsCoach: true, decision: "A small change", nextCheckinOn: TODAY, waiting: "change" },
    ]);
    const html = wrap(qc2, createElement(RoadmapBoardCard));
    expect(html).toContain("1 on schedule · 1 to look at");
    expect(html).toContain("Blake Roe");
    expect(html).toContain("A change to approve");
    expect(html).not.toContain("Alex Doe");
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the weekly check-in carries the roadmap's follow-ups as steps, never a second form", async () => {
    const { planCheckin } = await import("@/lib/checkin-coordination/plan");
    const { addPlanSteps } = await import("@/lib/checkin-coordination/steps");
    const plan = planCheckin({ due: TODAY, lastWeighIn: TODAY, weighInsLast7: 5, meet: null, goal: null, lastPhotos: null, lastMeasurements: null, schedules: [], nutritionPendingSince: null, roadmap: { asks: ["tracking", "confounders"], reason: "Behind plan", sex: "M" } });
    expect(plan.extras.find((e) => e.key === "roadmap")?.asks).toEqual(["tracking", "confounders"]);
    const steps = addPlanSteps([{ key: "nutrition_rating" }, { key: "win" }], plan).map((s) => s.key);
    expect(steps).toEqual(["nutrition_rating", "tracking_accuracy", "scale_confounders", "win"]);
    const none = planCheckin({ due: TODAY, lastWeighIn: TODAY, weighInsLast7: 5, meet: null, goal: null, lastPhotos: null, lastMeasurements: null, schedules: [], nutritionPendingSince: null });
    expect(none.extras.some((e) => e.key === "roadmap")).toBe(false);
  });
  it("the roadmap's words run on the OpenAI key, never Lovable credits", async () => {
    const { DEFAULT_ROUTES } = await import("@/lib/ai/routing");
    expect(DEFAULT_ROUTES.nutrition_roadmap.models.every((m) => m.startsWith("openai:"))).toBe(true);
  });
  it("the pushes exist, content-free, and the daily hook is scheduled", () => {
    const events = read("src/lib/push/app-events.server.ts");
    for (const e of ["roadmap_review_ready", "roadmap_checkin_due", "roadmap_update_ready"]) expect(events).toContain(e);
    const sql = read("supabase/migrations/20270501090000_nutrition_roadmaps.sql");
    expect(sql).toContain("nutrition-roadmap-tick");
    expect(sql).toContain("Athletes read own nutrition roadmap revisions");
    // a coach's draft stays private even once a newer draft supersedes it (only approved ones were in effect)
    const tighter = read("supabase/migrations/20270502090000_roadmap_drafts_stay_private.sql");
    expect(tighter).toContain("Athletes read own nutrition roadmap revisions");
    expect(tighter).toMatch(/decider = 'athlete' OR status = 'active' OR \(status = 'superseded' AND decided_at IS NOT NULL\)/);
    // the roadmap row is the coach's working state: a coached athlete reads none of it directly
    expect(tighter).toMatch(/"Athletes read own nutrition roadmap" ON public\.nutrition_roadmaps[\s\S]*c\.service_tier = 'self_serve'/);
    expect(read("src/lib/nutrition-roadmap/roadmap.functions.ts")).not.toMatch(/context\.supabase as any\)\.from\("nutrition_roadmaps"\)/);
  });
  it("the client view's history follows the same rule in code, for a coach previewing as the client", async () => {
    const { athleteSees } = await import("@/lib/nutrition-roadmap/view");
    expect(athleteSees({ decider: "coach", status: "superseded", decided_at: null })).toBe(false);
    expect(athleteSees({ decider: "coach", status: "proposed", decided_at: null })).toBe(false);
    expect(athleteSees({ decider: "coach", status: "rejected", decided_at: "2026-11-22T00:00:00Z" })).toBe(false);
    expect(athleteSees({ decider: "coach", status: "superseded", decided_at: "2026-11-22T00:00:00Z" })).toBe(true);
    expect(athleteSees({ decider: "coach", status: "active", decided_at: "2026-11-22T00:00:00Z" })).toBe(true);
    expect(athleteSees({ decider: "athlete", status: "proposed", decided_at: null })).toBe(true);
  });
});
