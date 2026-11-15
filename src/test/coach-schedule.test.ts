import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  coachMark, coachStatus, dateRange, isoDate, statusOfRow, tally, tallyLine, weekPlace, weekRange, weekTitle, workoutName,
} from "@/lib/coach-schedule";
import { buildScheduleManagerRows } from "@/components/schedule/ScheduleManagerList";

const TODAY = "2026-11-15";
const read = (p: string) => readFileSync(p, "utf8");

describe("coachStatus: the athlete's own rules, read for the coach", () => {
  it("finished beats everything, then started, then the date", () => {
    expect(coachStatus({ date: "2026-11-01", completion: { completed_at: "x" }, todayISO: TODAY })).toBe("done");
    expect(coachStatus({ date: "2026-11-20", completion: { completed_at: "x" }, todayISO: TODAY })).toBe("done");
    expect(coachStatus({ date: "2026-11-10", completion: { in_progress_at: "x" }, todayISO: TODAY })).toBe("in_progress");
    expect(coachStatus({ date: "2026-11-10", completion: { started_at: "x" }, todayISO: TODAY })).toBe("in_progress");
    expect(coachStatus({ date: TODAY, completion: null, todayISO: TODAY })).toBe("today");
    expect(coachStatus({ date: "2026-11-14", completion: null, todayISO: TODAY })).toBe("missed");
    expect(coachStatus({ date: "2026-11-16", completion: null, todayISO: TODAY })).toBe("upcoming");
    expect(coachStatus({ date: null, completion: null, todayISO: TODAY })).toBe("no_date");
  });

  it("an optional session whose day passed is skipped, never missed", () => {
    expect(coachStatus({ date: "2026-11-14", completion: null, optional: true, todayISO: TODAY })).toBe("optional");
    expect(coachStatus({ date: "2026-11-14", completion: { completed_at: "x" }, optional: true, todayISO: TODAY })).toBe("done");
  });

  it("reads a timestamp date by its day", () => {
    expect(coachStatus({ date: "2026-11-15T00:00:00Z", completion: null, todayISO: TODAY })).toBe("today");
  });

  it("marks: green check, hollow ring for a miss, a ring in progress, a dot ahead, none without a date", () => {
    expect(coachMark("done")).toEqual({ kind: "done" });
    expect(coachMark("missed")).toEqual({ kind: "missed" });
    expect(coachMark("in_progress")).toMatchObject({ kind: "progress" });
    expect(coachMark("optional")).toEqual({ kind: "skipped" });
    expect(coachMark("upcoming")).toEqual({ kind: "scheduled" });
    expect(coachMark("today")).toEqual({ kind: "scheduled" });
    expect(coachMark("no_date")).toBeNull();
  });

  it("the Program list's rows read the same as the calendar", () => {
    const { rows } = buildScheduleManagerRows({
      days: [
        { id: "a", day_index: 1, week_id: "w", scheduled_date: "2026-11-10" },
        { id: "b", day_index: 2, week_id: "w", scheduled_date: "2026-11-12" },
        { id: "c", day_index: 3, week_id: "w", scheduled_date: "2026-11-13", is_optional: true },
        { id: "d", day_index: 4, week_id: "w", scheduled_date: TODAY },
        { id: "e", day_index: 5, week_id: "w", scheduled_date: null },
        { id: "f", day_index: 6, week_id: "w", scheduled_date: "2026-11-18" },
      ],
      scheduledInstances: [],
      completions: [{ day_id: "a", scheduled_workout_id: null, completed_at: "x" }],
      todayISO: TODAY,
    });
    expect(rows.map((r) => statusOfRow(r, TODAY))).toEqual(["done", "missed", "optional", "today", "no_date", "upcoming"]);
  });
});

describe("workoutName: what the athlete reads, without the date's job", () => {
  it("prefers the subtitle, drops a leading 'Day N —'", () => {
    expect(workoutName({ title: "Day 1 — Lower A (Squat Focus)", subtitle: "Lower A (Squat Focus)", day_index: 1 })).toBe("Lower A (Squat Focus)");
    expect(workoutName({ title: "Day 2 — Deadlift + Upper Back", day_index: 2 })).toBe("Deadlift + Upper Back");
    expect(workoutName({ title: "Day 3: Bench Technique", day_index: 3 })).toBe("Bench Technique");
    expect(workoutName({ title: "Heavy Singles SBD", day_index: 4 })).toBe("Heavy Singles SBD");
  });

  it("keeps 'Day N' when the rest is only a weekday, and falls back to it", () => {
    expect(workoutName({ title: "Day 1 — Monday", day_index: 1 })).toBe("Day 1");
    expect(workoutName({ title: "Day 4 - Thurs", day_index: 4 })).toBe("Day 4");
    expect(workoutName({ title: null, subtitle: "  ", day_index: 5 })).toBe("Day 5");
  });
});

describe("week and month lines", () => {
  const e = (status: any, date: string | null = "2026-11-10") => ({ date, status });

  it("tallies done, missed and in progress; a workout with no date doesn't count", () => {
    const entries = [e("done"), e("done"), e("missed"), e("in_progress"), e("upcoming"), e("optional"), e("no_date", null)];
    expect(tally(entries)).toEqual({ total: 6, done: 2, missed: 1, inProgress: 1, ahead: 1, optional: 1 });
    expect(tallyLine(entries)).toBe("2 of 6 done · 1 missed · 1 in progress");
    expect(tallyLine([e("done"), e("upcoming")])).toBe("1 of 2 done");
    expect(tallyLine([])).toBe("");
  });

  it("names the week the way people say it", () => {
    const thisWeek = isoDate("2026-11-09");
    expect(weekTitle(isoDate("2026-11-09"), thisWeek)).toBe("This week");
    expect(weekTitle(isoDate("2026-11-16"), thisWeek)).toBe("Next week");
    expect(weekTitle(isoDate("2026-11-02"), thisWeek)).toBe("Last week");
    expect(weekTitle(isoDate("2026-11-23"), thisWeek)).toBe("Nov 23 – 29");
    expect(weekRange(isoDate("2026-11-30"))).toBe("Nov 30 – Dec 6");
  });

  it("date ranges: one month once, across months both, across years both years", () => {
    expect(dateRange("2026-11-02", "2026-11-06")).toBe("Nov 2 – 6");
    expect(dateRange("2026-11-30", "2026-12-04")).toBe("Nov 30 – Dec 4");
    expect(dateRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
    expect(dateRange("2026-11-02", "2026-11-02")).toBe("Nov 2");
  });

  it("says where a week sits in the program, both blocks when it spans two", () => {
    const names = (id: string) => ({ b2: "Block 2 — General Strength", b3: "Block 3 — Peak" } as Record<string, string>)[id] ?? null;
    expect(weekPlace([{ blockId: "b2", weekIndex: 4, date: "2026-11-10" }, { blockId: "b2", weekIndex: 4, date: "2026-11-12" }], names))
      .toBe("Block 2 — General Strength · Week 4");
    expect(weekPlace([{ blockId: "b3", weekIndex: 1, date: "2026-11-16" }, { blockId: "b2", weekIndex: 4, date: "2026-11-13" }], names))
      .toBe("Block 2 — General Strength · Week 4 → Block 3 — Peak · Week 1");
    expect(weekPlace([], names)).toBe("");
  });
});

describe("the coach's Schedule card", () => {
  const shell = read("src/components/schedule/ScheduleManagerShell.tsx");
  const cal = read("src/components/schedule/ScheduleCalendar.tsx");
  const list = read("src/components/schedule/ScheduleManagerList.tsx");
  const sheet = read("src/components/schedule/MoveWorkoutSheet.tsx");

  it("opens on this week, with Month and Program one tap away, remembered on the device", () => {
    expect(shell).toContain('[["week", "Week"], ["month", "Month"], ["program", "Program"]]');
    expect(shell).toContain('return v === "month" || v === "program" ? v : "week";');
    expect(shell).toContain("window.localStorage.setItem(COACH_VIEW_KEY, v)");
  });

  it("every status comes from coach-schedule, never its own colours or words", () => {
    for (const src of [cal, list]) {
      expect(src).toContain('from "@/lib/coach-schedule"');
      expect(src).not.toMatch(/Overdue|Past Due|Missing Date|Moved|bg-primary\/5|border-l-primary/);
    }
  });

  it("a finger presses and holds to drag, so a swipe over a workout still scrolls", () => {
    expect(cal).toContain("useSensor(MouseSensor");
    expect(cal).toContain("useSensor(TouchSensor");
    expect(cal).not.toContain("touch-none");
  });

  it("the workout sheet opens the block editor on that week", () => {
    expect(sheet).toContain("focusBlockEditorWeek(ctx.week?.week_index ?? null);");
    expect(sheet).toContain('to: "/admin/blocks/$blockId", params: { blockId: ctx.block.id }');
  });
});
