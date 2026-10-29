/**
 * The client's Training tab (admin): one place for the program, its schedule,
 * athlete setup and workout notes; it flags only what needs the coach.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScheduleBlock } from "@/lib/block-schedule-model";
import { trainingRoadmap, trainingAlerts, unscheduledCount } from "@/lib/training-tab";
import { buildScheduleManagerRows } from "@/components/schedule/ScheduleManagerList";

const read = (p: string) => readFileSync(p, "utf8");

function block(id: string, status: ScheduleBlock["status_derived"], start: string | null, end: string | null, extra: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id, name: `Block ${id}`, prep_id: "p1", status: null, start_date: start, end_date: end, weeks: 4,
    status_derived: status, original_end: end, effective_start: start, effective_end: end,
    schedule_start: start, schedule_end: end, dates_from_schedule: false, next_workout_date: null,
    week_of: status === "Active" ? 2 : null, total_weeks: 4, ...extra,
  };
}

describe("trainingRoadmap", () => {
  it("runs now → next by date, keeps drafts and finished blocks apart, and only this program's blocks ahead", () => {
    const blocks = [
      block("old", "Completed", "2026-05-01", "2026-05-28"),
      block("b3", "Upcoming", "2026-12-01", "2026-12-28"),
      block("b1", "Active", "2026-10-01", "2026-10-28"),
      block("b2", "Upcoming", "2026-10-29", "2026-11-25"),
      block("other", "Upcoming", "2026-11-01", "2026-11-28", { prep_id: "p2" }),
      block("d", "Draft", null, null),
    ];
    const r = trainingRoadmap(blocks, "p1");
    expect(r.current?.id).toBe("b1");
    expect(r.live.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(r.drafts.map((b) => b.id)).toEqual(["d"]);
    expect(r.past.map((b) => b.id)).toEqual(["old"]);
  });
});

describe("unscheduledCount", () => {
  it("counts workouts with no date on live blocks only: this week on in the current block, all of an upcoming one", () => {
    const r = trainingRoadmap([
      block("b1", "Active", "2026-10-01", "2026-10-28", { week_of: 2 }),
      block("b2", "Upcoming", "2026-10-29", "2026-11-25"),
      block("d", "Draft", null, null),
      block("old", "Completed", "2026-05-01", "2026-05-28"),
    ], "p1");
    const u = [
      { dayId: "1", blockId: "b1", weekIndex: 1, title: "a" }, // last week: history
      { dayId: "2", blockId: "b1", weekIndex: 2, title: "b" },
      { dayId: "3", blockId: "b2", weekIndex: 1, title: "c" },
      { dayId: "4", blockId: "d", weekIndex: 1, title: "d" }, // a draft has no dates by design
      { dayId: "5", blockId: "old", weekIndex: 1, title: "e" },
    ];
    expect(unscheduledCount(r, u)).toBe(2);
  });
});

describe("trainingAlerts", () => {
  const today = "2026-10-20";
  it("says when the block ends soon with nothing planned after", () => {
    const blocks = [block("b1", "Active", "2026-10-01", "2026-10-28")];
    const r = trainingRoadmap(blocks, "p1");
    expect(trainingAlerts({ blocks, roadmap: r, unscheduled: [], today })).toEqual([
      { kind: "ends_soon", end: "2026-10-28", daysLeft: 8 },
    ]);
  });
  it("is quiet when the next block follows straight on and every workout has a date", () => {
    const blocks = [block("b1", "Active", "2026-10-01", "2026-10-28"), block("b2", "Upcoming", "2026-10-29", "2026-11-25")];
    expect(trainingAlerts({ blocks, roadmap: trainingRoadmap(blocks, "p1"), unscheduled: [], today })).toEqual([]);
  });
  it("flags a gap before the next block and workouts that need a date, the date first", () => {
    const blocks = [block("b1", "Active", "2026-10-01", "2026-10-28"), block("b2", "Upcoming", "2026-11-04", "2026-12-01")];
    const alerts = trainingAlerts({
      blocks,
      roadmap: trainingRoadmap(blocks, "p1"),
      unscheduled: [{ dayId: "x", blockId: "b2", weekIndex: 1, title: "x" }],
      today,
    });
    expect(alerts.map((a) => a.kind)).toEqual(["unscheduled", "gap"]);
    expect(alerts[1]).toEqual({ kind: "gap", days: 6 });
  });
  it("doesn't nag about a block a month from its end", () => {
    const blocks = [block("b1", "Active", "2026-10-01", "2026-12-28")];
    expect(trainingAlerts({ blocks, roadmap: trainingRoadmap(blocks, "p1"), unscheduled: [], today })).toEqual([]);
  });
});

describe("the Training tab holds only training", () => {
  const page = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
  const tab = read("src/components/clients/client-training-tab.tsx");
  const shell = read("src/components/schedule/ScheduleManagerShell.tsx");

  it("is one component: program, schedule, athlete setup, workout notes", () => {
    const training = page.slice(page.indexOf('<TabsContent value="training"'), page.indexOf('<TabsContent value="nutrition"'));
    expect(training).toContain("<ClientTrainingTab");
    expect(training).not.toMatch(/Phases|ImportantDates|AssignedPrograms|Warmup|Maxes/);
    expect(tab).toContain("<ProgramCard");
    expect(tab).toContain('<ScheduleManagerShell clientId={clientId} mode="coach" />');
    expect(tab).toContain("<AthleteSetupCard");
    expect(tab).toContain("<ClientNotesCard");
  });

  it("training days, maxes and warm-up are rows that open a sheet", () => {
    expect(tab).toMatch(/title="Training days"[\s\S]*title="Maxes"[\s\S]*title="Warm-up"/);
    expect(tab).toContain("<ClientMaxesPanel clientId={clientId} embedded />");
    expect(tab).toMatch(/<TrainingScheduleCard[\s\S]*?embedded[\s\S]*?coach/);
  });

  it("the coach's schedule has no weekly editor or info panel, and one ⋯ for bulk move and history", () => {
    expect(existsSync("src/components/schedule/CoachOverridePanel.tsx")).toBe(false);
    expect(shell).toContain("{!coach && (");
    expect(shell).toContain("Move several workouts");
    expect(shell).toContain("<ScheduleWorkoutSheet");
  });

  it("/admin/clients/$id/schedule opens the Training tab on the calendar", () => {
    const route = read("src/routes/_authenticated/admin/clients.$id.schedule.tsx");
    expect(route).toContain('search: { tab: "training" }');
    expect(route).toContain('hash: "schedule"');
  });

  it("the calendar's tray never offers a workout that's done or from a finished block", () => {
    const cal = read("src/components/schedule/ScheduleCalendar.tsx");
    expect(cal).toContain('return blk.status !== "Completed" && !(blk.end_date && blk.end_date < todayIso);');
  });
});

describe("Whole program list", () => {
  it("a done workout with no date isn't counted as missing", () => {
    const res = buildScheduleManagerRows({
      days: [{ id: "d1", week_id: "w1", day_index: 1, scheduled_date: null }, { id: "d2", week_id: "w1", day_index: 2, scheduled_date: null }],
      scheduledInstances: [],
      completions: [{ day_id: "d1", scheduled_workout_id: null, completed_at: "2026-06-01T10:00:00Z" }],
      todayISO: "2026-10-20",
    });
    expect(res.missingCount).toBe(1);
    expect(res.rows.find((r) => r.dayId === "d1")?.status).toBe("completed");
  });
});
