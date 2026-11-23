import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const dash = read("src/components/analytics/client-analytics-dashboard.tsx");

describe("one analytics experience for the coach and the athlete", () => {
  it("the coach's analytics page is the shared dashboard with the coach's extras, not a second set of charts", () => {
    const admin = read("src/routes/_authenticated/admin/client-programs.$clientId.analytics.tsx");
    expect(admin).toContain("<ClientAnalyticsDashboard");
    expect(admin).toMatch(/\n\s+coach\n/);
    expect(admin).not.toContain("LineChart");
    expect(admin).not.toContain("weeklyMuscleVolume");
    // back goes to the client's Training tab, where the coach came from
    expect(admin).toContain("backTo={clientTrainingHref(clientId)}");
    // the client profile's copy is the coach's too
    expect(read("src/route-pages/_authenticated/admin/clients.$id.tsx")).toMatch(/hideBodyweight\s+coach\s+\/>/);
    // and the athlete's own page isn't
    expect(read("src/routes/_authenticated/portal/workouts.analytics.tsx")).not.toMatch(/\bcoach\b\s*\n/);
  });

  it("the page is four sections, one at a time, its place kept in the address (old addresses land on Training)", () => {
    for (const v of ['["overview", "Overview"]', '["strength", "Strength"]', '["training", "Training"]', '["records", "Records"]']) expect(dash).toContain(v);
    const flat = dash.replace(/\s+/g, " ");
    expect(flat).toContain('const LEGACY_VIEW: Record<string, AnalyticsView> = { volume: "training", consistency: "training", recovery: "training", };');
    // a #recovery link still lands where recovery lives
    expect(dash).toContain('window.location.hash === "#recovery") return "training"');
    for (const f of ["src/routes/_authenticated/portal/workouts.analytics.tsx", "src/routes/_authenticated/admin/client-programs.$clientId.analytics.tsx"]) {
      expect(read(f), f).toContain("onViewChange={(v) => navigate(");
      expect(read(f), f).toContain("viewFromSearch(search.view)");
    }
  });

  it("volume is the training-load read: one observation for both, coach-only flags only for the coach", () => {
    expect(dash).toContain("useTrainingLoad({");
    // the training-load insights reach the athlete through Cleo's one observation, never a list
    expect(dash.replace(/\s+/g, " ")).toMatch(/insight: trainingLoad\.load\.insights\.find\( ?\(i\) => i\.audience === "both" && i\.actionNeeded,? ?\) \?\? null/);
    expect(dash).toContain("<TrainingLoadSection");
    expect(dash).not.toContain("weeklyMuscleVolume");
    // squat · bench · deadlift sections only for someone who trains them; programming detail only for the coach
    expect(dash).toContain("{hasPowerlifting && (");
    expect(dash).toMatch(/\{coach && \(\s*<MoreDetail label="Programming detail">\s*<SectionErrorBoundary label="Powerlifting exposure">/);
  });

  it("a weekly number says what it divides by (this week so far, or a week's average)", () => {
    expect(dash).toContain('label: trainingLoad.load.perWeekBasis.partial ? "Sets this week" : "Sets a week"');
    expect(dash).not.toContain('label="Sets in range"');
  });

  it("the Workouts Performance card is the one way in, drawn from the athlete's own training", () => {
    const card = read("src/components/performance-card.tsx");
    expect(card).toContain("data-analytics-entry");
    expect(card).toContain("data-performance-heatmap");
    expect(card).toContain("buildCalendar({");
    expect(card).not.toContain("See all analytics");
  });

  it("the block editor links straight to how the block is landing", () => {
    expect(read("src/routes/_authenticated/admin/blocks.$blockId.tsx")).toContain('search={{ filter: "exact_block", blockId, view: "volume" } as any}');
  });
});
