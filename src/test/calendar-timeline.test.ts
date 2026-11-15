import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DAY_MINUTES,
  hourLabel,
  layoutDay,
  minuteClock,
  openingMinute,
  slotTime,
  spanOnDay,
} from "@/lib/calendar-timeline";
import { homeRange, isCurrentPeriod, periodLabel, shiftAnchor } from "@/lib/home-calendar";
import { blockLabels } from "@/lib/calendar-labels";

/** A device-local instant (whatever zone the tests run in). */
const at = (day: string, hm: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = hm.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
};
const span = (s: number, e: number, id = `${s}-${e}`) => ({ item: id, startMin: s, endMin: e });

describe("where a booking sits on a day", () => {
  it("is its start and end on the device's clock", () => {
    expect(spanOnDay("2026-11-16", at("2026-11-16", "10:00"), at("2026-11-16", "11:00"))).toEqual({ startMin: 600, endMin: 660 });
    expect(spanOnDay("2026-11-16", at("2026-11-16", "06:30"), at("2026-11-16", "07:30"))).toEqual({ startMin: 390, endMin: 450 });
  });

  it("is an hour when it has no end, or an end that isn't after its start", () => {
    expect(spanOnDay("2026-11-16", at("2026-11-16", "17:30"), null)).toEqual({ startMin: 1050, endMin: 1110 });
    expect(spanOnDay("2026-11-16", at("2026-11-16", "17:30"), at("2026-11-16", "17:30"))).toEqual({ startMin: 1050, endMin: 1110 });
  });

  it("past midnight shows on both days, clipped to each", () => {
    const s = at("2026-11-16", "23:00");
    const e = at("2026-11-17", "01:00");
    expect(spanOnDay("2026-11-16", s, e)).toEqual({ startMin: 1380, endMin: DAY_MINUTES });
    expect(spanOnDay("2026-11-17", s, e)).toEqual({ startMin: 0, endMin: 60 });
    expect(spanOnDay("2026-11-18", s, e)).toBeNull();
  });

  it("one ending exactly at midnight stays on its own day", () => {
    const s = at("2026-11-16", "23:00");
    const e = at("2026-11-17", "00:00");
    expect(spanOnDay("2026-11-16", s, e)).toEqual({ startMin: 1380, endMin: DAY_MINUTES });
    expect(spanOnDay("2026-11-17", s, e)).toBeNull();
  });

  it("isn't on another day, and an unreadable start is nowhere", () => {
    expect(spanOnDay("2026-11-17", at("2026-11-16", "10:00"), at("2026-11-16", "11:00"))).toBeNull();
    expect(spanOnDay("2026-11-16", "not a date", null)).toBeNull();
  });
});

describe("on a day the clocks change", () => {
  const before = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Toronto"; // falls back Nov 1 2026
  });
  afterAll(() => {
    process.env.TZ = before;
  });

  it("lines up with the hour labels, not the hours since midnight", () => {
    // 10 AM on the 25-hour day is 11 hours after midnight; it still sits at 10.
    expect(spanOnDay("2026-11-01", at("2026-11-01", "10:00"), at("2026-11-01", "11:00"))).toEqual({ startMin: 600, endMin: 660 });
  });
});

describe("bookings at the same time", () => {
  it("one alone takes the whole width", () => {
    expect(layoutDay([span(600, 660)])).toEqual([{ item: "600-660", startMin: 600, endMin: 660, col: 0, cols: 1, span: 1 }]);
  });

  it("back to back don't share the width", () => {
    const out = layoutDay([span(600, 660, "a"), span(660, 720, "b")]);
    expect(out.map((p) => [p.item, p.col, p.cols])).toEqual([["a", 0, 1], ["b", 0, 1]]);
  });

  it("two that overlap sit side by side, earliest on the left", () => {
    const out = layoutDay([span(630, 720, "later"), span(600, 660, "first")]);
    expect(out.map((p) => [p.item, p.col, p.cols])).toEqual([["first", 0, 2], ["later", 1, 2]]);
  });

  it("of two that start together, the longer is on the left", () => {
    const out = layoutDay([span(600, 630, "short"), span(600, 720, "long")]);
    expect(out.map((p) => [p.item, p.col])).toEqual([["long", 0], ["short", 1]]);
  });

  it("a freed column is used again, and a booking spreads into free columns to its right", () => {
    // long 10–1; a 10–11 beside it; b 11–12 reuses that column.
    const out = layoutDay([span(600, 780, "long"), span(600, 660, "a"), span(660, 720, "b")]);
    expect(out.map((p) => [p.item, p.col, p.cols])).toEqual([["long", 0, 2], ["a", 1, 2], ["b", 1, 2]]);
    // Three at 10; the 10–10:30 one ends, then c at 10:30 takes its column and spreads to the free third.
    const three = layoutDay([span(600, 720, "x"), span(600, 630, "y"), span(600, 660, "z"), span(670, 720, "c")]);
    const c = three.find((p) => p.item === "c")!;
    expect(c.cols).toBe(3);
    expect(c.col).toBe(1);
    expect(c.span).toBe(2);
  });

  it("separate groups each get their own columns", () => {
    const out = layoutDay([span(600, 660, "a"), span(630, 690, "b"), span(900, 960, "c")]);
    expect(out.find((p) => p.item === "c")).toMatchObject({ col: 0, cols: 1, span: 1 });
  });

  it("a very short booking still counts as tall enough to tap", () => {
    // 10:00–10:05 is drawn 20 minutes tall, so 10:10 sits beside it, not on top of it.
    const out = layoutDay([span(600, 605, "short"), span(610, 660, "next")]);
    expect(out.map((p) => p.cols)).toEqual([2, 2]);
  });
});

describe("where the timeline opens", () => {
  it("an hour and a half before now on today", () => {
    expect(openingMinute({ nowMin: 14 * 60 + 10, firstStartMin: 6 * 60 })).toBe(12 * 60 + 30);
  });
  it("half an hour before the first booking on another day, else 7 AM", () => {
    expect(openingMinute({ firstStartMin: 10 * 60 })).toBe(9 * 60 + 30);
    expect(openingMinute({})).toBe(7 * 60);
  });
  it("the whole busy part at once when it fits (now included on today)", () => {
    // 8 AM – 5 PM fits a 10-hour window: open at 7:30.
    expect(openingMinute({ firstStartMin: 8 * 60, lastEndMin: 17 * 60, viewMin: 10 * 60 })).toBe(7 * 60 + 30);
    // Today at 7 PM after a 10–2 day: 9:30 so now is still on screen.
    expect(openingMinute({ nowMin: 19 * 60, firstStartMin: 10 * 60, lastEndMin: 14 * 60, viewMin: 11 * 60 })).toBe(9 * 60 + 30);
    // Too long for the window: near now instead.
    expect(openingMinute({ nowMin: 11 * 60 + 20, firstStartMin: 6 * 60, lastEndMin: 18 * 60 + 30, viewMin: 9 * 60 })).toBe(9 * 60 + 30);
  });
  it("never before midnight or so late the day runs out", () => {
    expect(openingMinute({ nowMin: 30 })).toBe(0);
    expect(openingMinute({ nowMin: 23 * 60 + 50, viewMin: 8 * 60 })).toBe(16 * 60);
  });
});

describe("a full month day", () => {
  it("shows who's booked first, then the coach's own things, then Google, each by time", async () => {
    const { monthChipOrder } = await import("@/lib/calendar-timeline");
    const t = (h: number) => new Date(2026, 10, 16, h).toISOString();
    const day = [
      { id: "drive", family: "google", startsAt: t(8) },
      { id: "alyssa", family: "people", startsAt: t(12) },
      { id: "bday", family: "google", startsAt: null },
      { id: "marc", family: "people", startsAt: t(10) },
      { id: "meet", family: "coach", startsAt: t(9) },
    ];
    expect([...day].sort(monthChipOrder).map((x) => x.id)).toEqual(["marc", "alyssa", "meet", "bday", "drive"]);
  });
});

describe("a tap on empty time", () => {
  it("books the half hour it lands in", () => {
    expect(slotTime(10 * 60 + 14)).toBe("10:00");
    expect(slotTime(10 * 60 + 45)).toBe("10:30");
    expect(slotTime(0)).toBe("00:00");
    expect(slotTime(DAY_MINUTES - 1)).toBe("23:30");
  });
});

describe("the timeline's words", () => {
  it("hours and times read like the rest of the calendar", () => {
    expect([0, 6, 12, 13, 23].map(hourLabel)).toEqual(["12 AM", "6 AM", "12 PM", "1 PM", "11 PM"]);
    expect(minuteClock(630)).toBe("10:30 AM");
    expect(minuteClock(600, false)).toBe("10");
    expect(minuteClock(DAY_MINUTES)).toBe("12 AM");
  });

  it("a block leads with who, the first name for a narrow column, then what and where", () => {
    const item = {
      id: "pt:1", kind: "pt_session" as const, date: "2026-11-16", title: "1:1 Training",
      clientName: "Nicolas Galli", location: "800 Vaughan Ave Unit 404, Selkirk, Manitoba R1A 4R4, Canada",
    };
    const l = blockLabels(item, true);
    expect(l.title).toBe("Nicolas Galli");
    expect(l.short).toBe("Nicolas");
    expect(l.detail).toMatch(/^1:1 Training · 800 Vaughan Ave/);
    // A Google event is its own title, never "Google Calendar".
    const g = blockLabels({ id: "g", kind: "google_event", date: "2026-11-16", title: "Drive", clientName: "Google Calendar" }, true);
    expect(g).toEqual({ title: "Drive", short: "Drive", detail: null });
  });
});

describe("the Home card's Day view", () => {
  it("steps a day at a time, and Today shows only away from today", () => {
    expect(shiftAnchor("day", "2026-11-16", 1)).toBe("2026-11-17");
    expect(shiftAnchor("day", "2026-11-01", -1)).toBe("2026-10-31");
    expect(isCurrentPeriod("day", "2026-11-16", "2026-11-16")).toBe(true);
    expect(isCurrentPeriod("day", "2026-11-17", "2026-11-16")).toBe(false);
  });

  it("says the day plainly", () => {
    expect(periodLabel("day", "2026-11-16", "2026-11-16")).toBe("Today");
    expect(periodLabel("day", "2026-11-17", "2026-11-16")).toBe("Tomorrow");
    expect(periodLabel("day", "2026-11-15", "2026-11-16")).toBe("Yesterday");
    expect(periodLabel("day", "2026-11-20", "2026-11-16")).toMatch(/Fri.*Nov.*20/);
  });

  it("loads the shown day's week as well as this week and the week ahead", () => {
    expect(homeRange("day", "2026-11-18", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-25" });
    expect(homeRange("day", "2026-12-10", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-12-13" });
    expect(homeRange("day", "2026-11-02", "2026-11-18")).toEqual({ from: "2026-11-02", to: "2026-11-25" });
  });
});

describe("the coach's calendars are timelines", () => {
  const board = readFileSync("src/components/calendar/calendar-board.tsx", "utf8");
  const panel = readFileSync("src/components/admin-calendar/board-panel.tsx", "utf8");
  const card = readFileSync("src/components/admin-calendar/dashboard-schedule-card.tsx", "utf8");
  const grid = readFileSync("src/components/calendar/time-grid.tsx", "utf8");

  it("the Calendar page's Day and Week are a timeline, opt-in so the client calendar stays as it is", () => {
    expect(board).toContain("{timeline && (view === \"week\" || view === \"day\") && (");
    expect(panel).toMatch(/<CalendarBoard\s+timeline/);
    expect(readFileSync("src/routes/_authenticated/portal/calendar.tsx", "utf8")).not.toMatch(/<CalendarBoard[^>]*\btimeline\b/);
  });

  it("a tap on empty time opens the booking form at that time; a finger shows the slot first", () => {
    expect(panel).toContain("onCreate={(date, time) => setBooking({ date, time })}");
    expect(panel).toContain("initialTime={booking?.time ?? null}");
    expect(card).toContain("initialTime={booking?.time ?? null}");
    expect(grid).toContain('if (lastPointer.current === "mouse") onSlot(d, slotTime(min));');
    expect(grid).toContain("else setPending({ day: d, min });");
  });

  it("nothing is dragged, so no booking's time can change from the grid", () => {
    for (const src of [grid, board, card]) {
      expect(src).not.toMatch(/draggable|onDragStart|onDrop/);
    }
  });

  it("the Home card's views are timelines and a month of names", () => {
    expect(card).toContain("<TimeGrid");
    expect(card).toContain("days={[anchor]}");
    expect(card).toContain("days={weekDays(anchor)}");
    expect(card).toContain("<MiniMonth anchor={anchor} today={today} onPick={openDay}");
    // Month says who, not dots.
    expect(card).not.toContain("dots={(d) => dotsByDay.get(d) ?? []} />\n          <AgendaToday>");
  });

  it("the Calendar page opens on the week's timeline (the day's on a phone) until a view is picked", async () => {
    const { defaultTimelineView } = await import("@/lib/calendar-timeline");
    expect(defaultTimelineView(1280)).toBe("week");
    expect(defaultTimelineView(390)).toBe("day");
    expect(panel).toContain('const view: ViewMode = dayOverride ? "day" : prefs.boardView ?? fallbackView;');
  });
});
