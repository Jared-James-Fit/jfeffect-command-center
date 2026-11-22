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

  it("the page is four sections, one at a time, its place kept in the address", () => {
    expect(dash).toContain('["overview", "Overview"]');
    expect(dash).toContain('["strength", "Strength"]');
    expect(dash).toContain('["volume", "Volume"]');
    expect(dash).toContain('["recovery", "Recovery"]');
    // a #recovery link still lands on Recovery
    expect(dash).toContain('window.location.hash === "#recovery") return "recovery"');
    for (const f of ["src/routes/_authenticated/portal/workouts.analytics.tsx", "src/routes/_authenticated/admin/client-programs.$clientId.analytics.tsx"]) {
      expect(read(f), f).toContain("onViewChange={(v) => navigate(");
    }
  });

  it("volume is the training-load read: insights on Overview for both, coach-only flags only for the coach", () => {
    expect(dash).toContain("useTrainingLoad({");
    expect(dash).toContain('trainingLoad.load.insights.filter((i) => coach || i.audience === "both")');
    expect(dash).toContain("<TrainingLoadSection");
    // the old, every-set muscle chart is gone
    expect(dash).not.toContain("weeklyMuscleVolume");
    // squat · bench · deadlift sections only for someone who trains them; the
    // programming detail (roles, weekly session grid) only for the coach
    expect(dash).toContain("{hasPowerlifting && (");
    expect(dash).toContain("{coach && (\n            <SectionErrorBoundary label=\"Powerlifting exposure\">");
  });

  it("the Working sets tile says what it counts (it used to claim warm-ups and drop bodyweight sets)", () => {
    // a week's average, or this week so far: never this week divided by weeks still ahead
    expect(dash).toContain('label={trainingLoad.load.perWeekBasis.partial ? "Sets this week" : "Sets a week"}');
    expect(dash).not.toContain('label="Sets in range"');
  });

  it("the Workouts card's header is the way in, with a real glance at the trend", () => {
    const card = read("src/components/training-analytics-preview-card.tsx");
    expect(card).toContain("data-analytics-entry");
    expect(card).toContain("data-analytics-spark");
    expect(card).toContain('search={{ view: "volume" } as any}');
    // one way in, said once: no second "See all analytics" link under it
    expect(card).not.toContain("See all analytics");
  });

  it("the block editor links straight to how the block is landing", () => {
    expect(read("src/routes/_authenticated/admin/blocks.$blockId.tsx")).toContain('search={{ filter: "exact_block", blockId, view: "volume" } as any}');
  });
});
