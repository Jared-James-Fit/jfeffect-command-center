import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clientNav, selfServeNav } from "@/lib/admin-nav";

const read = (f: string) => readFileSync(f, "utf8");

describe("clients can find their calendar", () => {
  it("the page is called Calendar everywhere a client sees it, right after Workouts in the menu", () => {
    for (const nav of [clientNav, selfServeNav]) {
      const i = nav.findIndex((n) => n.to === "/portal/calendar");
      expect(nav[i].label).toBe("Calendar");
      expect(nav[i - 1].to).toBe("/portal/workouts");
    }
    const page = read("src/routes/_authenticated/portal/calendar.tsx");
    expect(page).toContain('<PageHeader title="Calendar"');
    expect(page).toContain('head: () => ({ meta: [{ title: "Calendar" }] })');
  });

  it("the Calendar page opens on the calendar (sessions below), on the day tapped on Home", () => {
    const page = read("src/routes/_authenticated/portal/calendar.tsx");
    expect(page.indexOf("<CalendarBoard")).toBeLessThan(page.indexOf("<MySessionRequests"));
    expect(page).toContain("initialDate={date ?? null}");
    const board = read("src/components/calendar/calendar-board.tsx");
    expect(board).toContain("parseDay(initialDate) ?? startOfDay(new Date())");
  });

  it("the coach's dashboard week opens the Calendar board on that day", () => {
    const card = read("src/components/admin-calendar/dashboard-schedule-card.tsx");
    expect(card).toContain('link={(d) => ({ to: "/admin/calendar", search: { tab: "board", date: d } })}');
    const route = read("src/routes/_authenticated/admin/calendar.tsx");
    expect(route).toContain("<AdminCalendarBoardPanel key={search.date ?? \"today\"} initialDate={search.date ?? null} />");
  });
});
