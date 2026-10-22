import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildHomeAgenda } from "@/lib/home-upcoming";
import type { CalendarItem } from "@/lib/calendar-sources";

const read = (f: string) => readFileSync(f, "utf8");
const item = (id: string, kind: CalendarItem["kind"], date: string): CalendarItem =>
  ({ id, kind, date, title: id, status: "Scheduled" }) as CalendarItem;

describe("Calendar = appointments and the way in to today's workout; Workouts = the training schedule", () => {
  it("Home's coming-up list skips workouts but today still shows today's workout", () => {
    const items = [
      item("w-today", "workout", "2026-10-22"),
      item("w-tmrw", "workout", "2026-10-23"),
      item("pt-sat", "pt_session", "2026-10-24"),
      item("w-mon", "workout", "2026-10-26"),
      item("ev-nov", "event", "2026-11-12"),
    ];
    const a = buildHomeAgenda(items, { today: "2026-10-22", days: 30, maxUpcoming: 3, upcoming: (i) => i.kind !== "workout" && i.kind !== "cardio" });
    expect(a.today.map((i) => i.id)).toEqual(["w-today"]);
    expect(a.upcoming.flatMap((d) => d.items.map((i) => i.id))).toEqual(["pt-sat", "ev-nov"]);
  });

  it("the Home card's week dots and coming-up list are appointments only", () => {
    const card = read("src/components/home/upcoming-schedule-card.tsx");
    expect(card).toContain('return item.kind !== "workout" && item.kind !== "cardio";');
    expect(card).toContain("if (!it || !isCalendarItem(it) || it.status === \"Cancelled\") continue;");
    expect(card).toContain("No appointments coming up.");
  });

  it("the Calendar page shows no workout schedule, only a way in to today's workout", () => {
    const page = read("src/routes/_authenticated/portal/calendar.tsx");
    expect(page).toContain('items.filter((i) => i.kind !== "workout" && i.kind !== "cardio")');
    expect(page).toContain("items={calendarItems}");
    expect(page).toContain("<TodayWorkoutLink item={todaysWorkout} />");
    expect(page.indexOf("<TodayWorkoutLink")).toBeLessThan(page.indexOf("<CalendarBoard"));
  });

  it("Workouts reads as the training schedule: Schedule tab, the program week on the strip, Monday said once", () => {
    const exp = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(exp).toContain('<CalendarIcon className="h-3.5 w-3.5" /> Schedule');
    expect(exp).toContain('const title = scheduleTitle({ kind: "workout", title: cleanDayTitle(item.day?.title, item.day?.day_index) });');
    expect(exp).toContain('case "upcoming": return "Upcoming";');
    expect(exp).toContain('<div className="line-clamp-2 text-lg font-black leading-snug">{title}</div>');
    const strip = read("src/components/workouts/week-strip.tsx");
    expect(strip).toContain("{trainingWeek && <span className=\"font-black text-foreground\">{trainingWeek} · </span>}");
  });
});
