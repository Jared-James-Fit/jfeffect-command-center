import { describe, expect, it } from "vitest";
import { addDaysISO } from "@/lib/schedule-time";
import { holidayOn, patternDays, planPrebook, recentPattern, type PrebookSession } from "@/lib/session-prebook";

/** Every given weekday between two days, as booked sessions. */
function series(from: string, to: string, weekdays: number[], start: string, end: string, status = "Scheduled"): PrebookSession[] {
  const out: PrebookSession[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekdays.includes(w)) out.push({ session_date: d, start_time: `${start}:00`, end_time: `${end}:00`, status, location: "Iron Image", title: "1:1 Training" });
  }
  return out;
}

describe("Manitoba holidays", () => {
  it("knows the fixed and the moving ones", () => {
    expect(holidayOn("2027-01-01")).toBe("New Year's Day");
    expect(holidayOn("2027-02-15")).toBe("Louis Riel Day");
    expect(holidayOn("2027-03-26")).toBe("Good Friday");
    expect(holidayOn("2027-05-24")).toBe("Victoria Day");
    expect(holidayOn("2026-09-07")).toBe("Labour Day");
    expect(holidayOn("2026-10-12")).toBe("Thanksgiving");
    expect(holidayOn("2026-12-26")).toBe("Boxing Day");
    expect(holidayOn("2027-01-04")).toBeNull();
  });
});

describe("the days and times a client trains on", () => {
  it("reads Mon / Wed / Fri at noon and ignores a one-off", () => {
    const sessions = [...series("2026-11-02", "2026-12-30", [1, 3, 5], "12:00", "13:00"), { session_date: "2026-10-29", start_time: "08:30:00", end_time: "09:30:00", status: "Scheduled" }];
    const { pattern, anchor } = recentPattern(sessions);
    expect(anchor).toBe("2026-12-30");
    expect(pattern.map((p) => [p.weekday, p.start, p.end])).toEqual([[1, "12:00", "13:00"], [3, "12:00", "13:00"], [5, "12:00", "13:00"]]);
    expect(patternDays(pattern)).toBe("Mon, Wed & Fri");
  });

  it("follows the usual time when one week was different", () => {
    const sessions = series("2026-11-07", "2026-12-27", [0, 6], "10:00", "11:00");
    sessions[0] = { ...sessions[0], start_time: "17:00:00", end_time: "18:00:00" };
    expect(recentPattern(sessions).pattern.map((p) => [p.weekday, p.start])).toEqual([[6, "10:00"], [0, "10:00"]]);
  });
});

describe("booking the rest", () => {
  const today = "2026-10-22";

  it("Colten: 4 left after Wed Dec 30, skipping New Year's Day", () => {
    const plan = planPrebook({ sessions: series("2026-10-23", "2026-12-30", [1, 3, 5], "12:00", "13:00"), available: 4, today });
    expect(plan.slots.map((s) => s.date)).toEqual(["2027-01-04", "2027-01-06", "2027-01-08", "2027-01-11"]);
    expect(plan.skipped).toEqual([{ date: "2027-01-01", reason: "New Year's Day" }]);
  });

  it("Nico: 13 left on his weekends after Sun Dec 27", () => {
    const plan = planPrebook({ sessions: series("2026-10-24", "2026-12-27", [0, 6], "10:00", "11:00"), available: 13, today });
    expect(plan.slots).toHaveLength(13);
    expect(plan.slots[0].date).toBe("2027-01-02");
    expect(plan.slots[12].date).toBe("2027-02-13");
    expect(plan.slots.every((s) => s.start === "10:00" && s.end === "11:00")).toBe(true);
  });

  it("uses the coach's own Google appointment for a day instead of adding one", () => {
    const google = [{ date: "2027-01-06", start: "12:30", end: "13:30", eventId: "g1", calendarId: "cal", summary: "PT Session - Colten", location: "Gym", timezone: "America/Winnipeg" }];
    const plan = planPrebook({ sessions: series("2026-11-02", "2026-12-30", [1, 3, 5], "12:00", "13:00"), available: 2, today, google });
    expect(plan.slots[1]).toMatchObject({ date: "2027-01-06", start: "12:30", google: { eventId: "g1" } });
    expect(plan.slots[0].google).toBeNull();
  });

  it("stops at the credits left, the package's last day, and never books twice on a day", () => {
    const sessions = series("2026-11-02", "2026-12-30", [1, 3, 5], "12:00", "13:00");
    expect(planPrebook({ sessions, available: 0, today }).slots).toEqual([]);
    expect(planPrebook({ sessions, available: 10, today, until: "2027-01-06" }).slots.map((s) => s.date)).toEqual(["2027-01-04", "2027-01-06"]);
    const withExtra = [...sessions, { session_date: "2027-01-04", start_time: "09:00:00", end_time: "10:00:00", status: "Scheduled" }];
    expect(planPrebook({ sessions: withExtra, available: 1, today }).slots[0].date).toBe("2027-01-06");
  });

  it("starts from today when nothing is booked ahead, and needs a pattern", () => {
    const done = series("2026-08-31", "2026-10-21", [1, 3, 5], "12:00", "13:00", "Completed");
    expect(planPrebook({ sessions: done, available: 2, today }).slots.map((s) => s.date)).toEqual(["2026-10-23", "2026-10-26"]);
    expect(planPrebook({ sessions: [], available: 5, today }).slots).toEqual([]);
  });
});
