import { describe, expect, it } from "vitest";
import { googleOccurrenceKey, mergeGoogleCalendarLists } from "@/lib/session-conflicts";

// What Google returns with singleEvents=true: every repeat of a recurring
// event is its own row with its own id, but they all share the series' iCalUID.
function weekly(uid: string, seriesId: string, dates: string[], time = "12:00:00") {
  return dates.map((d) => ({
    id: `${seriesId}_${d.replace(/-/g, "")}T170000Z`,
    iCalUID: uid,
    recurringEventId: seriesId,
    summary: "PT Session - Colten",
    start: { dateTime: `${d}T${time}-05:00` },
    end: { dateTime: `${d}T13:00:00-05:00` },
    originalStartTime: { dateTime: `${d}T${time}-05:00` },
  }));
}

describe("merging Google calendars", () => {
  it("keeps every week of a recurring event", () => {
    const colten = weekly("colten@google.com", "abc", ["2026-09-04", "2026-09-11", "2026-10-02", "2026-10-09"]);
    const merged = mergeGoogleCalendarLists([{ id: "primary", items: colten }]);
    expect(merged.map((m) => m.event.start.dateTime)).toEqual(colten.map((e) => e.start.dateTime));
  });

  it("shows an event that sits on both calendars once", () => {
    const shared = {
      id: "evt1",
      iCalUID: "dr-thompson@google.com",
      summary: "4pm dr. thompson",
      start: { dateTime: "2026-10-08T16:00:00-05:00" },
      end: { dateTime: "2026-10-08T17:00:00-05:00" },
    };
    // Same moment written in another zone on the second calendar.
    const copy = { ...shared, start: { dateTime: "2026-10-08T21:00:00Z" } };
    const merged = mergeGoogleCalendarLists([
      { id: "coaching", items: [shared] },
      { id: "primary", items: [copy] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].calendarId).toBe("coaching");
  });

  it("keeps a moved repeat as its own occurrence", () => {
    const [a, b] = weekly("work@google.com", "w", ["2026-10-08", "2026-10-09"], "09:00:00");
    const moved = { ...b, start: { dateTime: "2026-10-08T15:00:00-05:00" } }; // Friday's shift moved to Thursday
    const merged = mergeGoogleCalendarLists([{ id: "primary", items: [a, moved] }]);
    expect(merged).toHaveLength(2);
    expect(googleOccurrenceKey(a)).not.toBe(googleOccurrenceKey(moved));
  });

  it("drops cancelled repeats and rows without a start", () => {
    const [a, b] = weekly("x@google.com", "x", ["2026-10-09", "2026-10-16"]);
    const merged = mergeGoogleCalendarLists([
      { id: "primary", items: [a, { ...b, status: "cancelled" }, { id: "nostart", iCalUID: "n" } as any] },
    ]);
    expect(merged.map((m) => m.event.id)).toEqual([a.id]);
  });

  it("keeps all-day repeats apart by date", () => {
    const days = ["2026-10-09", "2026-10-10"].map((d) => ({
      id: `bday_${d}`,
      iCalUID: "allday@google.com",
      start: { date: d },
      originalStartTime: { date: d },
    }));
    expect(mergeGoogleCalendarLists([{ id: "primary", items: days }])).toHaveLength(2);
  });
});

describe("Calendar page loads Google for the months on screen", async () => {
  const { visibleRange } = await import("@/components/calendar/calendar-board");
  const { googleFetchWindow } = await import("@/lib/calendar-sources");

  it("month view covers the padded grid", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(visibleRange("month", new Date(2026, 9, 9))).toEqual({ from: "2026-09-27", to: "2026-10-31" });
  });

  it("week view is Sunday to Saturday", () => {
    expect(visibleRange("week", new Date(2026, 9, 9))).toEqual({ from: "2026-10-04", to: "2026-10-10" });
  });

  it("fetches whole months, including January when you page there", () => {
    const w = googleFetchWindow({ from: "2027-01-01", to: "2027-01-31" });
    expect(new Date(w.timeMin)).toEqual(new Date(2027, 0, 1));
    expect(new Date(w.timeMax)).toEqual(new Date(2027, 1, 1));
  });

  it("weeks inside one month share one fetch", () => {
    expect(googleFetchWindow({ from: "2026-10-04", to: "2026-10-10" })).toEqual(
      googleFetchWindow({ from: "2026-10-11", to: "2026-10-17" }),
    );
  });

  it("a grid that starts in last month fetches from that month", () => {
    const w = googleFetchWindow({ from: "2026-09-27", to: "2026-10-31" });
    expect(new Date(w.timeMin)).toEqual(new Date(2026, 8, 1));
    expect(new Date(w.timeMax)).toEqual(new Date(2026, 10, 1));
  });
});
