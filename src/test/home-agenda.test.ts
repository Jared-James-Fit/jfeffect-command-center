import { describe, expect, it } from "vitest";
import { buildHomeAgenda } from "@/lib/home-upcoming";
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
});
