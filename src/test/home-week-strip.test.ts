import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { weekDays } from "@/components/calendar/week-strip";

describe("Home week strip (same Mon–Sun week as Workouts)", () => {
  it("is the Monday–Sunday week of the picked day, across month and DST boundaries", () => {
    // Thu 29 Oct 2026 → Mon 26 Oct … Sun 1 Nov
    expect(weekDays("2026-10-29")).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
    // Sunday stays in the week that started the Monday before; Monday starts its own.
    expect(weekDays("2026-11-01")[0]).toBe("2026-10-26");
    expect(weekDays("2026-11-02")[0]).toBe("2026-11-02");
    expect(weekDays("2027-01-01")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  it("matches the Workouts strip's week start (date-fns startOfWeek, Monday)", async () => {
    const { startOfWeek, format } = await import("date-fns");
    for (const d of ["2026-10-10", "2026-10-11", "2026-10-12", "2026-03-08", "2026-11-01"]) {
      expect(weekDays(d)[0]).toBe(format(startOfWeek(new Date(`${d}T12:00:00`), { weekStartsOn: 1 }), "yyyy-MM-dd"));
    }
  });

  it("has week arrows and a Today jump like Workouts", () => {
    const src = readFileSync("src/components/calendar/week-strip.tsx", "utf8");
    expect(src).toContain('aria-label="Previous week"');
    expect(src).toContain('aria-label="Next week"');
    expect(src).toContain("onSelect(today)");
    expect(src).not.toMatch(/nextSevenDays/);
  });
});

describe("every Home leads with its schedule", () => {
  const at = (src: string, s: string) => {
    const i = src.indexOf(s);
    expect(i, `${s} missing`).toBeGreaterThan(-1);
    return i;
  };
  it("coach dashboard: the schedule is the first card, above the numbers and banners", () => {
    const src = readFileSync("src/routes/_authenticated/admin/index.tsx", "utf8");
    expect(at(src, "<DashboardScheduleCard")).toBeLessThan(at(src, "<DriveSetupBanner />"));
    expect(at(src, "<DashboardScheduleCard")).toBeLessThan(at(src, "<SnapshotGrid"));
    expect(at(src, "<DashboardScheduleCard")).toBeLessThan(at(src, "<TrainingTodayCard"));
  });
  it("client Home: schedule right under the greeting, above every banner", () => {
    const src = readFileSync("src/routes/_authenticated/portal/index.tsx", "utf8");
    expect(at(src, "<GreetingHeader")).toBeLessThan(at(src, "<UpcomingScheduleCard"));
    expect(at(src, "<UpcomingScheduleCard")).toBeLessThan(at(src, "<AgreementDashboardCard"));
    expect(at(src, "<UpcomingScheduleCard")).toBeLessThan(at(src, "<SetupChecklistBanner"));
  });
  it("finance Home: My calendar before the money", () => {
    const src = readFileSync("src/components/admin/finance/finance-home.tsx", "utf8");
    expect(at(src, "<MyCalendarCard")).toBeLessThan(at(src, "Today's money"));
  });
  it("member Home: first card", () => {
    const src = readFileSync("src/routes/_authenticated/m/index.tsx", "utf8");
    expect(at(src, "<MemberWeekCard")).toBeLessThan(at(src, "<HomeBodyweightCard"));
  });
  it("all three use the same strip", () => {
    for (const f of [
      "src/components/admin-calendar/dashboard-schedule-card.tsx",
      "src/components/home/upcoming-schedule-card.tsx",
      "src/components/member/member-week-card.tsx",
    ]) expect(readFileSync(f, "utf8")).toContain("<WeekStrip");
  });
});
