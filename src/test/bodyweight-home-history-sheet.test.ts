import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const portalCard = readFileSync(
  resolve(process.cwd(), "src/components/portal/bodyweight-summary-card.tsx"),
  "utf8",
);
const memberCard = readFileSync(
  resolve(process.cwd(), "src/components/home/home-bodyweight-card.tsx"),
  "utf8",
);
const historySheet = readFileSync(
  resolve(process.cwd(), "src/components/bodyweight/bodyweight-history-sheet.tsx"),
  "utf8",
);
const sheetHeader = readFileSync(
  resolve(process.cwd(), "src/components/bodyweight/bodyweight-sheet-header.tsx"),
  "utf8",
);

describe("bodyweight Home quick actions", () => {
  it.each([
    ["portal", portalCard],
    ["member", memberCard],
  ])("keeps %s History in place rather than navigating to Progress", (_surface, source) => {
    expect(source).toContain("setHistoryOpen(true)");
    expect(source).toContain("<BodyweightHistorySheet");
    expect(source).toContain("getCombinedBodyweightSeries");
    expect(source).not.toContain("listBodyweight");
    expect(source).not.toMatch(/<Link\s+to=.*progress/);
  });

  it.each([
    ["portal", portalCard],
    ["member", memberCard],
  ])("uses the dedicated in-flow log header on %s Home", (_surface, source) => {
    expect(source).toContain("hideCloseButton");
    expect(source).toContain('<BodyweightSheetHeader title="Log Bodyweight" />');
  });

  it("keeps the history view focused and driven by caller-provided unified rows", () => {
    expect(historySheet).toContain("bodyweightStats(statsRows)");
    expect(historySheet).toContain("BodyweightPoint");
    expect(historySheet).not.toContain("useQuery");
    expect(historySheet).not.toContain("listBodyweight");
    expect(historySheet).not.toContain("/portal/progress");
    expect(historySheet).toContain('"7d", "30d", "90d", "all"');
    expect(historySheet).toContain("overflow-y-auto");
  });

  it("keeps Back and Close inside a safe, 44px minimum-touch header row", () => {
    expect(sheetHeader).toContain('aria-label="Back"');
    expect(sheetHeader).toContain('aria-label="Close"');
    expect(sheetHeader).toContain("h-11");
    expect(sheetHeader).toContain("env(safe-area-inset-top)");
  });
});
