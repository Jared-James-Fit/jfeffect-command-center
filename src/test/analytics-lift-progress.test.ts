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
  it("puts training (lift progress, PRs, muscle volume) before recovery and lifestyle", () => {
    const lift = dash.indexOf('aria-label="Lift Progress"');
    expect(lift).toBeGreaterThan(-1);
    expect(lift).toBeLessThan(dash.indexOf('aria-label="Recent ATPRs"'));
    expect(dash.indexOf('aria-label="Volume by Muscle Group"')).toBeLessThan(
      dash.indexOf('id="recovery"'),
    );
    expect(dash.indexOf('id="recovery"')).toBeLessThan(dash.indexOf('label="Sleep"'));
  });

  it("section titles sit on their own row, so a long block name can't hide them", () => {
    expect(dash).toContain("function SectionHeading(");
    expect(dash).not.toMatch(/grid-cols-\[minmax\(0,1fr\)_auto\][^"]*">\s*<h2/);
  });
});
