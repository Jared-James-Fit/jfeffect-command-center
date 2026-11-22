import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildAssessment, type AssessmentInput } from "@/lib/weight-management/assessment";
import { addDays } from "@/lib/weight-management/units";
import type { WeightManagementView } from "@/lib/weight-management/weight-management.functions";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn, createServerFn: () => ({}) }));
vi.mock("@/lib/weight-management/weight-management.functions", () => ({
  getWeightManagementFn: vi.fn(),
  saveWeightGoalFn: vi.fn(),
  saveWeightProfileFn: vi.fn(),
  saveCardioPlanFn: vi.fn(),
  saveWaterTargetFn: vi.fn(),
  decideWeightReviewFn: vi.fn(),
}));

const { WeightManagementCard } = await import("@/components/weight-management/WeightManagementCard");
const { weightKey } = await import("@/lib/weight-management/handoff");

const TODAY = "2026-11-17";
const series = (days: number, end: number, perWeek: number) =>
  Array.from({ length: days }, (_, i) => ({ date: addDays(TODAY, -(days - 1 - i)), kg: end - (perWeek * (days - 1 - i)) / 7 + 0.2 * Math.sin(i * 2.3) }));

function input(o: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    today: TODAY,
    unit: "kg",
    speedUnit: "kmh",
    sex: "M",
    age: 29,
    heightCm: 180,
    level: "intermediate",
    weighIns: series(42, 86, -0.15),
    goal: null,
    meet: { name: "Provincials", date: addDays(TODAY, 56), weightClass: "83", federation: "CPU", sport: "powerlifting" },
    powerlifter: true,
    plan: { start: "2026-09-01", weeklyKcal: 2600, phase: "Fat Loss", starts: ["2026-09-01"] },
    checkins: [{ date: addDays(TODAY, -2), answers: { nutrition_rating: 4.5, recovery_flags: ["Digestion / bloating"], digestion_symptoms: ["Bloating"], digestion_timing: "After meals" } }],
    cardio: { targets: [{ day_type: "Training Day", cardio_type: "Incline Treadmill Walk", duration_minutes: 15, incline: 5, speed_min_mph: 3, speed_max_mph: 3, frequency_per_week: 4, scheduled_weekdays: ["Monday", "Tuesday", "Thursday", "Friday"] }], lastChanged: "2026-09-01", history: null, done: 12, planned: 16 },
    trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"],
    heavyLowerDays: ["Monday", "Thursday"],
    sessionMinutes: 75,
    dailySteps: 7000,
    water: { avgMl: 2100, targetMl: 3000, daysLogged: 10 },
    waist: [],
    performance: { lower: "steady", detail: "Squat steady, Deadlift steady over the last 8 weeks (comparable sets)." },
    health: { walkingLimits: [], fluidRestriction: false },
    profile: { climate: null, sweat: null, maxIncline: null, availableMinutes: null },
    pastPhases: [],
    ...o,
  };
}

function render(view: Partial<WeightManagementView> & { assessment: WeightManagementView["assessment"] }) {
  const qc = new QueryClient();
  const full: WeightManagementView = {
    firstName: "Sam",
    hasLogin: true,
    goalUnit: null,
    goal: { type: null, value: null, valueMax: null, date: null },
    refs: { trainingCardioId: "c1", restCardioId: null, planId: "p1", water: { activeMl: 3000, trainingExtraMl: null, source: "auto" } },
    profile: null,
    reviews: [],
    series: input().weighIns,
    ...view,
  };
  qc.setQueryData(weightKey("client-1"), full);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(WeightManagementCard, { clientId: "client-1" })));
}

describe("the coach's weight management card", () => {
  it("renders a meet's class: goal, the four numbers, the chart, the recommendation and its sections", () => {
    const a = buildAssessment(input());
    const html = render({ assessment: a });
    expect(html).toContain("Weight management");
    expect(html).toContain("83 kg class at Provincials");
    expect(html).toContain("data-weight-tiles");
    for (const t of ["Now", "Trend", "Needed", "At weigh-in"]) expect(html).toContain(t);
    expect(html).toContain("data-weight-chart");
    expect(html).toContain(`data-weight-recommendation="${a.recommendation.verdict}"`);
    expect(html).toContain("Weigh-in about 2 hours before lifting (CPU)");
    for (const s of ["Cardio", "Water", "Check-ins", "History"]) expect(html).toContain(s);
    // no brand-red primary on the Nutrition tab: every action is outlined or ghost
    expect(html).not.toMatch(/bg-primary text-primary-foreground/);
  });

  it("no goal and no weigh-ins: says what fills it, never a broken chart", () => {
    const a = buildAssessment(input({ meet: null, weighIns: [] }));
    const html = render({ assessment: a, series: [] });
    expect(html).toContain("No bodyweight goal yet");
    expect(html).toContain("No weigh-ins yet");
    expect(html).not.toContain("data-weight-chart");
  });

  it("a change waiting on the coach shows its action and Dismiss", () => {
    const a = buildAssessment(input({ meet: null, goal: { type: "lose", kg: 80, kgMax: null, date: addDays(TODAY, 56) }, checkins: [{ date: addDays(TODAY, -2), answers: { nutrition_rating: 5 } }] }));
    expect(a.recommendation.material).toBe(true);
    const html = render({ assessment: a });
    expect(html).toContain('data-weight-action="nutrition"');
    expect(html).toContain("Write it in Adjust plan");
    expect(html).toContain("Dismiss");
  });
});
