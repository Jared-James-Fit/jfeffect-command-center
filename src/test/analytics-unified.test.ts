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

  it("exposes two primary destinations and routes older links to overview", () => {
    for (const v of ['["overview", "Overview"]', '["strength", "Exercise Metrics"]']) expect(dash).toContain(v);
    expect(dash).not.toContain('["training", "Training"]');
    expect(dash).not.toContain('["records", "Records"]');
    for (const v of ["training", "records", "volume", "consistency", "recovery", "calendar", "lifetime"]) expect(dash).toContain(v + ': "overview"');
    expect(dash).toContain('window.location.hash === "#recovery") return "overview"');
    expect(dash).toContain('label="Records & competitions"');
    expect(dash).toContain('data-training-muscles');
    expect(dash).toContain("detailed");
    expect(read("src/components/analytics/lift-progress-card.tsx")).toContain("(!bare || detailed)");
    for (const f of ["src/routes/_authenticated/portal/workouts.analytics.tsx", "src/routes/_authenticated/admin/client-programs.$clientId.analytics.tsx"]) {
      expect(read(f), f).toContain("onViewChange={(v) => navigate(");
      expect(read(f), f).toContain("viewFromSearch(search.view)");
    }
  });

  it("keeps primary analytics prominent and opens records through controlled state", () => {
    expect(dash).toContain('label="Records & competitions" open={recordsOpen} onOpenChange={setRecordsOpen}');
    expect(dash).toContain('if(v==="records")setRecordsOpen(true)');
    expect(dash).not.toContain('querySelector("details")');
    expect(dash).toContain('onSectionChange={setRecordSection}');
    expect(dash.indexOf('id="analytics-muscles"')).toBeLessThan(dash.indexOf('label="Strength & programming"'));
    expect(dash).toContain('label="Training & recovery details"');
    const map = read("src/components/analytics/muscle-map.tsx");
    expect(map).toContain('rows={read.rows} mode={mode}');
    expect(map).toContain('aria-label="Find a muscle" value={picked??""}');
    expect(map).toContain('Largest training changes');
  });

  it("volume is the training-load read: one observation for both, coach-only flags only for the coach", () => {
    expect(dash).toContain("useTrainingLoad({");
    // the training-load insights reach the athlete through Cleo's one observation, never a list
    expect(dash.replace(/\s+/g, " ")).toMatch(/insight: trainingLoad\.load\.insights\.find\( ?\(i\) => i\.audience === "both" && i\.actionNeeded,? ?\) \?\? null/);
    expect(dash).toContain("<TrainingLoadSection");
    expect(dash).not.toContain("weeklyMuscleVolume");
    // squat · bench · deadlift sections only for someone who trains them; programming detail only for the coach
    expect(dash).toMatch(/\{hasPowerlifting &&(?:\s*\(|\s*<Segmented)/);
    expect(dash).toMatch(/\{coach && \(\s*<MoreDetail label="Programming detail \(coach\)">\s*<SectionErrorBoundary label="Powerlifting exposure">/);
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
    expect(read("src/routes/_authenticated/admin/blocks.$blockId.tsx")).toContain('search={{ filter: "exact_block", blockId, view: "training" } as any}');
  });
});
