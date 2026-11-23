import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const card = readFileSync("src/components/analytics/lift-progress-card.tsx", "utf8");
const dash = readFileSync("src/components/analytics/client-analytics-dashboard.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const sheet = readFileSync("src/components/ui/sheet.tsx", "utf8");

describe("lift progress: touch to inspect, open on purpose", () => {
  it("chart touches only select a session; the set sheet opens from Details or a set row", () => {
    expect(card).toContain("onMouseDown={inspect}");
    expect(card).toContain("onMouseMove={inspect}");
    expect(card).toContain("onClick={inspect}");
    const inspectFn = card.slice(
      card.indexOf("function inspect("),
      card.indexOf("function toPoint("),
    );
    expect(inspectFn).not.toContain("onOpenSet");
    expect(dash).not.toContain("handleDotClick");
  });

  it("keeps a Tooltip mounted so Recharts wires touch events", () => {
    expect(card).toContain("<Tooltip content={() => null} cursor={false}");
  });

  it("charts never select text or raise the iOS callout/loupe", () => {
    expect(css).toMatch(
      /\.recharts-wrapper \*[^}]*user-select: none;[^}]*-webkit-touch-callout: none;/,
    );
  });

  it("sheets opened by tap don't flash a focus ring on Back", () => {
    expect(sheet).toContain("focus-visible:ring-2 focus-visible:ring-ring");
    expect(sheet).not.toContain("focus:ring-2 focus:ring-ring");
  });
});

describe("analytics page order and headers", () => {
  it("Strength reads the competition lifts, then other exercises, then blocks; Training puts workload and muscles before recovery", () => {
    const comp = dash.indexOf("data-strength-section");
    const other = dash.indexOf("<LiftProgressCard");
    expect(comp).toBeGreaterThan(-1);
    expect(other).toBeGreaterThan(comp);
    expect(dash.indexOf("<BlockComparisonCard")).toBeGreaterThan(other);
    const workload = dash.indexOf("<SbdWorkloadChart");
    expect(workload).toBeGreaterThan(-1);
    expect(workload).toBeLessThan(dash.indexOf("<MuscleMap"));
    expect(dash.indexOf("<MuscleMap")).toBeLessThan(dash.indexOf("<RecoveryPatternList"));
    // what was logged at check-out (sleep, recovered, pain) is its own section, never a model score
    expect(dash.indexOf('id="recovery"')).toBeLessThan(dash.indexOf("<RecoveryTrendsCard"));
  });

  it("section titles sit on their own row, so a long block name can't hide them", () => {
    expect(dash).toContain("<SectionTitle");
    const viz = readFileSync("src/components/analytics/viz.tsx", "utf8");
    expect(viz).toContain("export function SectionTitle(");
    expect(dash).not.toMatch(/grid-cols-\[minmax\(0,1fr\)_auto\][^"]*">\s*<h2/);
  });
});
