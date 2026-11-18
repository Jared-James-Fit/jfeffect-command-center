import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 18 2026: a tool opened from an exercise card's ⋯ (Calc, e1RM) had no way
 * back to the workout but "‹ Tools", which led to the tools list, and neither
 * the tools sheet nor the card's menu closed with a swipe down.
 */
describe("every workout tool has a way back to the workout", () => {
  const tools = read("src/components/workout-tools/workout-tools.tsx");
  const menu = read("src/components/workout-day/card-menu.tsx");
  it("Done closes to the workout from the list and from inside any tool", () => {
    expect(tools).toContain('data-testid="tools-close"');
    expect(tools).toContain('aria-label="Done, back to the workout"');
    // the close isn't only on the list: it's outside the tool / list branch
    const bar = tools.slice(tools.indexOf("const sheetBar = ("), tools.indexOf("const back = tool && ("));
    expect(bar.indexOf('data-testid="tools-close"')).toBeGreaterThan(bar.indexOf(") : (\n        <span />\n      )}"));
    // "All tools" only steps over to the list, inside a tool
    expect(bar).toContain('onClick={() => setView("picker")}');
  });
  it("the tools sheet and the card's menu close with a swipe down, and have the grip that says so", () => {
    const sheet = tools.slice(tools.indexOf("<SheetContent"), tools.indexOf("{sheetBar}"));
    expect(sheet).toContain("swipeToClose");
    expect(sheet).toContain('rounded-full bg-muted-foreground/30');
    const menuSheet = menu.slice(menu.indexOf("<SheetContent"), menu.indexOf("data-card-menu-sheet"));
    expect(menuSheet).toContain("swipeToClose");
  });
});
