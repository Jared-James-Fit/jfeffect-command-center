import { describe, expect, it } from "vitest";
import { buildHomeAgenda, homeAgendaDays } from "@/lib/home-upcoming";
import type { CalendarItem } from "@/lib/calendar-sources";

const it_ = (id: string, kind: CalendarItem["kind"], date: string, startsAt: string | null = null, extra: Partial<CalendarItem> = {}): CalendarItem => ({
  id, kind, date, startsAt, title: id, ...extra,
});

describe("Home agenda", () => {
  const today = "2026-10-12";
  const items = [
    it_("gcal-lunch", "google_event", today, "2026-10-12T12:00:00"),
    it_("pt", "pt_session", today, "2026-10-12T07:00:00"),
    it_("lift", "workout", today),
    it_("rest", "cardio", today),
    it_("cancelled", "appointment", today, "2026-10-12T15:00:00", { status: "Cancelled" }),
    it_("past", "workout", "2026-10-11"),
    it_("tue", "workout", "2026-10-13"),
    it_("tue-g", "google_event", "2026-10-13", "2026-10-13T18:00:00"),
    it_("thu", "workout", "2026-10-15"),
    it_("thu-appt", "appointment", "2026-10-15", "2026-10-15T09:00:00"),
    it_("fri", "event", "2026-10-16"),
    it_("far", "workout", "2026-10-30"),
  ];

  it("shows today in full: workout first, then by time; no cardio or cancelled", () => {
    const a = buildHomeAgenda(items, { today });
    expect(a.today.map((i) => i.id)).toEqual(["lift", "pt", "gcal-lunch"]);
  });

  it("shows the next week in brief, capped, grouped by day", () => {
    const a = buildHomeAgenda(items, { today, maxUpcoming: 4 });
    expect(a.upcoming.map((d) => [d.date, d.items.map((i) => i.id)])).toEqual([
      ["2026-10-13", ["tue", "tue-g"]],
      ["2026-10-15", ["thu", "thu-appt"]],
    ]);
    expect(a.moreUpcoming).toBe(1);
  });

  it("leaves out the past and beyond the week", () => {
    const a = buildHomeAgenda(items, { today });
    const ids = a.upcoming.flatMap((d) => d.items.map((i) => i.id));
    expect(ids).not.toContain("past");
    expect(ids).not.toContain("far");
  });

  it("a day picked in the strip is shown in full, and Coming up starts after it (never repeating it)", () => {
    const a = buildHomeAgenda(items, { today, day: "2026-10-13" });
    expect(a.today.map((i) => i.id)).toEqual(["tue", "tue-g"]);
    const ids = a.upcoming.flatMap((d) => d.items.map((i) => i.id));
    expect(ids).not.toContain("tue-g");
    expect(ids[0]).toBe("thu");
  });

  it("looking back at a day before today, Coming up is what's still ahead today and after", () => {
    // 1:30 PM on Oct 12: the 7 AM session is over, the noon lunch (an hour) is too, Tuesday's still ahead.
    const nowMs = Date.parse("2026-10-12T13:30:00");
    const a = buildHomeAgenda(items, { today, day: "2026-10-11", nowMs, upcoming: (i) => i.kind !== "workout" });
    expect(a.today.map((i) => i.id)).toEqual(["past"]);
    const ids = a.upcoming.flatMap((d) => d.items.map((i) => i.id));
    expect(ids).not.toContain("pt");
    expect(ids).not.toContain("gcal-lunch");
    expect(ids[0]).toBe("tue-g");
  });

  it("the List's week is each day's own rows, in day order, empty days left out", () => {
    const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
    const days = homeAgendaDays(items, week);
    expect(days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16"]);
    // The same rows the day shows: workout first, then by time; no cardio or cancelled.
    expect(days[0].items.map((i) => i.id)).toEqual(buildHomeAgenda(items, { today }).today.map((i) => i.id));
    expect(days[2].items.map((i) => i.id)).toEqual(["thu", "thu-appt"]);
    expect(homeAgendaDays(items, ["2026-10-19"])).toEqual([]);
  });
});
