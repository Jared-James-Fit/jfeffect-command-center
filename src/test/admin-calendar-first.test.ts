import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the coach's Calendar tab is the calendar first", () => {
  const panel = readFileSync("src/components/admin-calendar/board-panel.tsx", "utf8");
  const dash = readFileSync("src/components/admin-calendar/dashboard-schedule-card.tsx", "utf8");
  const board = readFileSync("src/components/calendar/calendar-board.tsx", "utf8");

  it("has no stat tiles or second title above it (the dashboard holds what needs attention)", () => {
    expect(existsSync("src/components/calendar/needs-attention-panel.tsx")).toBe(false);
    expect(panel).not.toContain("NeedsAttention");
    expect(panel).not.toContain("PageHeader");
  });

  it("a day tapped on the dashboard opens on that day; Open calendar opens the month on the Calendar tab", () => {
    expect(panel).toContain('initialView={initialDate ? "day" : "month"}');
    expect(board).toMatch(/useState<ViewMode>\(\(\) => \(initialView && views\.includes\(initialView\)/);
    expect(dash).toContain('link={(d) => ({ to: "/admin/calendar", search: { tab: "board", date: d } })}');
    expect(dash).toContain('<Link to="/admin/calendar" search={{ tab: "board" } as any} className={AGENDA_LINK}>');
  });

  it("who / what filters fold behind Filter", () => {
    expect(panel).toContain("const [filtersOpen, setFiltersOpen] = useState(false);");
    expect(panel).toMatch(/\{filtersOpen && \(/);
  });
});
