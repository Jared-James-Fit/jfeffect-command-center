import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextSevenDays } from "@/components/calendar/week-strip";

describe("7-day strip", () => {
  it("is today plus six days, across month and DST boundaries", () => {
    expect(nextSevenDays("2026-10-29")).toEqual([
      "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
    ]);
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
