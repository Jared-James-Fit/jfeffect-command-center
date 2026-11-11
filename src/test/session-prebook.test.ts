import { describe, expect, it } from "vitest";
import { addDaysISO } from "@/lib/schedule-time";
import { holidayOn, patternDays, planPrebook, prebookCountNote, recentPattern, type PrebookSession } from "@/lib/session-prebook";

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

  it("starts tomorrow when nothing is booked ahead, and needs a pattern", () => {
    const done = series("2026-08-31", "2026-10-21", [1, 3, 5], "12:00", "13:00", "Completed");
    expect(planPrebook({ sessions: done, available: 2, today }).slots.map((s) => s.date)).toEqual(["2026-10-23", "2026-10-26"]);
    expect(planPrebook({ sessions: [], available: 5, today }).slots).toEqual([]);
  });
});

// Marc Asugui's real sessions, Sep 7 – Nov 10 2026 (4 a week, Mon–Fri, mostly 5:30 PM).
const MARC: Array<[string, string]> = [
  ["2026-09-07", "17:30"], ["2026-09-08", "11:00"], ["2026-09-09", "17:30"], ["2026-09-11", "15:30"],
  ["2026-09-14", "17:30"], ["2026-09-15", "11:00"], ["2026-09-16", "17:30"], ["2026-09-18", "15:30"],
  ["2026-09-21", "15:00"], ["2026-09-23", "17:30"], ["2026-09-25", "15:30"], ["2026-09-27", "16:30"],
  ["2026-09-28", "17:30"], ["2026-09-29", "12:00"], ["2026-09-30", "17:30"], ["2026-10-02", "15:30"],
  ["2026-10-05", "14:00"], ["2026-10-06", "10:00"], ["2026-10-07", "17:30"], ["2026-10-08", "18:00"],
  ["2026-10-12", "10:00"], ["2026-10-13", "11:00"], ["2026-10-14", "17:30"], ["2026-10-16", "17:30"],
  ["2026-10-19", "11:00"], ["2026-10-20", "11:00"], ["2026-10-21", "17:30"], ["2026-10-22", "17:30"],
  ["2026-10-26", "17:30"], ["2026-10-28", "17:30"], ["2026-10-29", "17:30"], ["2026-10-30", "17:30"],
  ["2026-11-02", "10:30"], ["2026-11-04", "17:30"], ["2026-11-05", "17:30"], ["2026-11-06", "17:30"],
];
const marcSessions: PrebookSession[] = [
  ...MARC.map(([d, t]) => ({ session_date: d, start_time: `${t}:00`, end_time: `${String(Number(t.slice(0, 2)) + 1).padStart(2, "0")}${t.slice(2)}:00`, status: "Completed", location: "800 Vaughan Ave", title: "1:1 Training" })),
  { session_date: "2026-11-10", start_time: "17:30:00", end_time: "18:30:00", status: "Scheduled", location: "800 Vaughan Ave", title: "1:1 Training" },
  { session_date: "2026-10-23", start_time: "17:30:00", end_time: "18:30:00", status: "Cancelled", location: "800 Vaughan Ave", title: "1:1 Training" },
];

describe("Marc: his next 16 from his last 16", () => {
  it("reads 4 a week on the days of his last full week, at his usual times", () => {
    const r = recentPattern(marcSessions);
    expect(r.perWeek).toBe(4);
    expect(r.basis).toEqual({ sessions: 16, from: "2026-10-13", to: "2026-11-10" });
    expect(patternDays(r.pattern)).toBe("Mon, Wed, Thu & Fri");
    expect(r.pattern.map((p) => [p.weekday, p.start, p.end])).toEqual([
      [1, "10:30", "11:30"], [3, "17:30", "18:30"], [4, "17:30", "18:30"], [5, "17:30", "18:30"],
    ]);
  });

  it("books the 11 left of his next 16 past his last credit, skipping Remembrance Day", () => {
    const plan = planPrebook({ sessions: marcSessions, available: 0, count: 11, today: "2026-11-10" });
    expect(plan.count).toBe(11);
    expect(plan.skipped).toEqual([{ date: "2026-11-11", reason: "Remembrance Day" }]);
    expect(plan.slots.map((s) => s.date)).toEqual([
      "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-18", "2026-11-19", "2026-11-20",
      "2026-11-23", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-30",
    ]);
  });

  it("follows the coach's own days and times instead, keeping the place", () => {
    const plan = planPrebook({
      sessions: marcSessions, available: 0, count: 4, today: "2026-11-10",
      pattern: [{ weekday: 2, start: "06:00", end: "07:00" }, { weekday: 4, start: "06:00", end: "07:00" }],
    });
    expect(plan.read.map((p) => p.weekday)).toEqual([1, 3, 4, 5]);
    expect(plan.slots.map((s) => [s.date, s.start, s.location])).toEqual([
      ["2026-11-12", "06:00", "800 Vaughan Ave"], ["2026-11-17", "06:00", "800 Vaughan Ave"],
      ["2026-11-19", "06:00", "800 Vaughan Ave"], ["2026-11-24", "06:00", "800 Vaughan Ave"],
    ]);
  });

  it("a package's last day only limits the sessions it pays for", () => {
    expect(planPrebook({ sessions: marcSessions, available: 3, today: "2026-11-10", until: "2026-11-13" }).slots).toHaveLength(2);
    expect(planPrebook({ sessions: marcSessions, available: 3, count: 5, today: "2026-11-10", until: "2026-11-13" }).slots).toHaveLength(5);
  });
});

describe("what the count books", () => {
  it("says where the sessions come from", () => {
    expect(prebookCountNote({ count: 11, available: 11, size: 16, first: "Marc" })).toBe("Books the 11 left on their package.");
    expect(prebookCountNote({ count: 4, available: 11, size: 16, first: "Marc" })).toBe("Uses 4 of the 11 sessions left.");
    expect(prebookCountNote({ count: 11, available: 0, size: 16, first: "Marc" })).toBe("They go on Marc's next 16. Renew to bill it: nothing is charged now.");
    expect(prebookCountNote({ count: 8, available: 3, size: 16, first: "Marc" })).toBe("Uses the 3 left, then 5 go on Marc's next 16. Renew to bill it: nothing is charged now.");
  });
});
