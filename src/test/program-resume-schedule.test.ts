import { describe, expect, it } from "vitest";
import { planCommittedRealign, type RealignDay } from "@/lib/committed-schedule-realign";
import { resumePreview } from "@/lib/plan-days-fit";
import type { WeekDay } from "@/lib/training-schedule";

/**
 * Resuming a paused program (member_program_resume) moves its block so the
 * week with the next workout opens just early enough that what's already done
 * that week sits before the resume date, gives the workouts left a date in
 * their new week, and leaves the calendar's own engine (planCommittedRealign)
 * to put them on the training days. These are the dates the local Postgres
 * run of the migration produced for a 4-week, 3-day program paused on Wed
 * Nov 18 after Week 3's Day 1 (Week 2's Day 2 missed), on Mon / Wed / Fri.
 */
const MWF: WeekDay[] = ["Monday", "Wednesday", "Friday"];

function program(blockStart: string, dates: string[][], touched: Set<string>) {
  const weeks = dates.map((_, i) => ({ id: `w${i + 1}`, week_index: i + 1, block_id: "b" }));
  const days: RealignDay[] = [];
  dates.forEach((week, wi) =>
    week.forEach((date, di) =>
      days.push({
        id: `w${wi + 1}d${di + 1}`,
        day_index: di + 1,
        week_id: `w${wi + 1}`,
        scheduled_date: date,
        schedule_source: "builder_assignment",
        schedule_locked: false,
      }),
    ),
  );
  return { blocks: [{ id: "b", start_date: blockStart }], weeks, days, touched };
}

const DONE = new Set(["w1d1", "w1d2", "w1d3", "w2d1", "w2d3", "w3d1"]);

describe("a resumed program lands on the training days the resume sheet showed", () => {
  it("resumed Wed Dec 2: the next workout is that day and nothing else needs moving", () => {
    const p = program(
      "2026-11-16",
      [
        ["2026-11-02", "2026-11-04", "2026-11-06"],
        ["2026-11-09", "2026-11-11", "2026-11-13"],
        ["2026-11-16", "2026-12-02", "2026-12-04"],
        ["2026-12-07", "2026-12-09", "2026-12-11"],
      ],
      DONE,
    );
    const plan = planCommittedRealign({
      committed: MWF,
      blocks: p.blocks,
      weeks: p.weeks,
      days: p.days,
      instances: [],
      touchedDayIds: p.touched,
      todayISO: "2026-12-02",
      role: "client",
      includePinned: false,
    });
    expect(plan.moves).toEqual([]);
    expect(plan.unplaced).toBe(0);
    expect(resumePreview("2026-12-02", MWF, 2, 3)).toEqual([
      { day: 2, date: "2026-12-02" },
      { day: 3, date: "2026-12-04" },
    ]);
  });

  it("resumed Mon Dec 14: Week 3's Day 2 is that Monday, the rest follow on Wed, Fri, Mon, Wed", () => {
    const p = program(
      "2026-11-27",
      [
        ["2026-11-02", "2026-11-04", "2026-11-06"],
        ["2026-11-09", "2026-11-11", "2026-11-13"],
        ["2026-11-16", "2026-12-14", "2026-12-15"],
        ["2026-12-18", "2026-12-20", "2026-12-22"],
      ],
      DONE,
    );
    const plan = planCommittedRealign({
      committed: MWF,
      blocks: p.blocks,
      weeks: p.weeks,
      days: p.days,
      instances: [],
      touchedDayIds: p.touched,
      todayISO: "2026-12-14",
      role: "client",
      includePinned: false,
    });
    const after = new Map(p.days.map((d) => [d.id, d.scheduled_date]));
    for (const m of plan.moves) after.set(m.dayId, m.next);
    expect(["w3d2", "w3d3", "w4d1", "w4d2", "w4d3"].map((id) => after.get(id))).toEqual([
      "2026-12-14",
      "2026-12-16",
      "2026-12-18",
      "2026-12-21",
      "2026-12-23",
    ]);
    // done and missed workouts never move
    expect(plan.moves.map((m) => m.dayId).filter((id) => /^w[12]|w3d1/.test(id))).toEqual([]);
    expect(resumePreview("2026-12-14", MWF, 2, 3)).toEqual([
      { day: 2, date: "2026-12-14" },
      { day: 3, date: "2026-12-16" },
    ]);
  });

  it("the preview needs training days and a real date", () => {
    expect(resumePreview("2026-12-14", [], 2, 3)).toEqual([]);
    expect(resumePreview("not a date", MWF, 2, 3)).toEqual([]);
    // the week's last workout alone
    expect(resumePreview("2026-12-15", MWF, 3, 3)).toEqual([{ day: 3, date: "2026-12-16" }]);
  });
});
