import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DEFAULT_WEEK_LAYOUT, needsReveal, REVEAL_MIN_VISIBLE_PX, stepWeek, weekLayoutOf } from "@/lib/workouts/week-layout";
import { sanitizePrefs } from "@/lib/calendar-prefs";
import { WeekLayoutToggle, WeekNav, WeekStrip } from "@/components/workouts/week-strip";
import { WeekSplitView } from "@/components/workouts/week-split-view";
import { buildWeekSplit } from "@/lib/workouts/week-split";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import { addDays, startOfWeek } from "date-fns";

/**
 * Nov 25 2026: the Workouts week is the horizontal Monday–Sunday calendar again by default,
 * with the vertical list one tap away on a toggle beside the week's arrows, remembered on the
 * person's account; both read the same workouts and the same picked day.
 */
const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/workouts/WorkoutsExperience.tsx");

describe("week layout: calendar by default, list on the toggle", () => {
  it("anything not saved as the list is the calendar", () => {
    expect(DEFAULT_WEEK_LAYOUT).toBe("calendar");
    expect(weekLayoutOf(undefined)).toBe("calendar");
    expect(weekLayoutOf("split")).toBe("calendar"); // the hours-old Split view's value
    expect(weekLayoutOf("day")).toBe("calendar");
    expect(weekLayoutOf("list")).toBe("list");
  });

  it("is remembered on the account with the other calendar views (only values it knows)", () => {
    expect(sanitizePrefs({ workoutsWeek: "list" }).workoutsWeek).toBe("list");
    expect(sanitizePrefs({ workoutsWeek: "calendar" }).workoutsWeek).toBe("calendar");
    expect(sanitizePrefs({ workoutsWeek: "grid" }).workoutsWeek).toBeUndefined();
    expect(page).toContain('const weekLayout: WeekLayout = weekLayoutOf(calendarPrefs.workoutsWeek);');
    expect(page).toContain("setCalendarPrefs({ workoutsWeek: l });");
    // a coach, or a coach viewing as the client, never saves it to anyone's account
    expect(page).toContain('local: mode === "coach" || !!pov.viewAsClientId,');
    // the phone-only key and the ⋯ item are gone: one toggle, on the page
    expect(page).not.toContain("readWeekView");
    expect(page).not.toContain("data-menu-week-view");
    expect(read("src/components/workouts/week-split-view.tsx")).not.toContain("jf.workouts.week-view");
  });
});

describe("week navigation", () => {
  const today = new Date(2026, 10, 25); // Wed
  it("lands on today whenever it comes back to the current week", () => {
    expect(toLocalISO(stepWeek(new Date(2026, 11, 3), -1, today))).toBe("2026-11-25"); // next Thu → back
    expect(toLocalISO(stepWeek(new Date(2026, 10, 16), 1, today))).toBe("2026-11-25"); // last Mon → forward
    // weeks start on Monday: next week's Sunday back one is this week, so today (Mon)
    expect(toLocalISO(stepWeek(new Date(2026, 11, 6), -1, new Date(2026, 10, 23)))).toBe("2026-11-23");
  });
  it("keeps the weekday on any other week", () => {
    expect(toLocalISO(stepWeek(today, 1, today))).toBe("2026-12-02");
    expect(toLocalISO(stepWeek(today, -1, today))).toBe("2026-11-18");
    expect(toLocalISO(stepWeek(new Date(2026, 11, 10), -1, today))).toBe("2026-12-03");
  });
  it("the list's picked card is brought up only when it's mostly out of sight", () => {
    expect(needsReveal(400, 768)).toBe(false);
    expect(needsReveal(768 - REVEAL_MIN_VISIBLE_PX + 1, 768)).toBe(true);
    expect(needsReveal(900, 768)).toBe(true);
  });
});

describe("the toggle and the shared navigation", () => {
  it("the toggle says which layout is on, in neutral (never the brand red)", () => {
    const html = renderToStaticMarkup(createElement(WeekLayoutToggle, { value: "calendar", onChange: () => {} }));
    expect(html).toContain('aria-label="Calendar view"');
    expect(html).toContain('aria-label="List view"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-week-layout="calendar"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-week-layout="list"/);
    expect(html).not.toMatch(/bg-primary|text-primary/);
  });
  it("one nav above both layouts: the dates, the week's done count, the toggle", () => {
    const html = renderToStaticMarkup(
      createElement(WeekNav, {
        selectedDate: localStartOfToday(),
        onSelectDate: () => {},
        progress: { done: 2, planned: 4 },
        layout: "list",
        onLayout: () => {},
      }),
    );
    expect(html).toContain('aria-label="Previous week"');
    expect(html).toContain('aria-label="Next week"');
    expect(html).toContain("2 of 4 done");
    expect(html).toContain("data-week-layout-toggle");
    // on today, no Today button
    expect(html).not.toContain("data-week-today");
    const off = renderToStaticMarkup(
      createElement(WeekNav, { selectedDate: addDays(localStartOfToday(), 14), onSelectDate: () => {} }),
    );
    expect(off).toContain("data-week-today");
    expect(off).not.toContain("data-week-layout-toggle");
  });
  it("the page draws the nav once, the calendar without its own arrows, the card right under", () => {
    expect(page).toMatch(/<WeekNav[\s\S]{0,300}layout=\{weekLayout\}[\s\S]{0,60}onLayout=\{changeWeekLayout\}/);
    expect(page).toMatch(/<WeekStrip[\s\S]{0,300}nav=\{false\}/);
    expect(page).toContain("onSelectDate={pickFromList}");
    expect(page).toMatch(/<div ref=\{dayCardRef\}[^>]*data-workouts-day>\s*<SelectedDayList/);
    // the layouts ease in only on a switch
    expect(page).toContain('className={cn(layoutSwitched && "jf-arrive", weekLayout === "list" && "mt-1.5")}');
  });
});

describe("both layouts tell the days apart the same way", () => {
  const today = localStartOfToday();
  const mon = startOfWeek(today, { weekStartsOn: 1 });
  const iso = toLocalISO(today);
  const item = { day: { id: "d1", title: "Squat & Bench" }, week: {}, block: {}, completion: null, scheduledDate: iso } as any;
  const byDate = new Map([[iso, [item]]]);
  const picked = addDays(today, today.getDay() === 0 ? -1 : 1); // another day of this week

  it("calendar: the picked day filled, today a ring, rest days quieter, no arrows of its own", () => {
    const html = renderToStaticMarkup(
      createElement(WeekStrip, { selectedDate: picked, onSelectDate: () => {}, byDate, flat: true, nav: false }),
    );
    expect(html).not.toContain('aria-label="Previous week"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-day="[^"]+"[^>]*data-rest="true"/); // picked is a rest day here
    expect(html).toContain("bg-foreground text-background");
    expect(html).toContain("ring-1 ring-inset ring-foreground/40");
    expect((html.match(/data-rest="true"/g) ?? []).length).toBe(6);
  });

  it("list: the same marks (filled picked, ringed today), Rest Day in words", () => {
    const week = buildWeekSplit({ weekStart: mon, byDate, today });
    const html = renderToStaticMarkup(createElement(WeekSplitView, { week, selectedDate: picked, onSelectDate: () => {} }));
    expect(html).toContain("Rest Day");
    expect(html).toContain("ring-1 ring-inset ring-foreground/40");
    expect(html).toContain("bg-foreground text-background");
    expect(html).not.toContain('aria-label="Previous week"');
  });
});

describe("the list keeps Start / Continue", () => {
  it("today's row says Continue for a workout already under way", () => {
    const src = read("src/components/workouts/week-split-view.tsx");
    expect(src).toContain('?.status === "in_progress" ? "Continue" : "Start"');
  });
  it("a day nothing can be dragged from never reads as disabled", () => {
    expect(read("src/components/workouts/calendar-day-dnd.tsx")).toContain("...(canDrag ? drag.attributes : {}),");
  });
});
