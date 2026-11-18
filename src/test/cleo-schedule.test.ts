/**
 * Cleo's schedule reads the app's two ways a workout is dated (Nov 18 2026): a schedule entry
 * (pl_scheduled_workouts) or the date on the workout itself (pl_days.scheduled_date, most of them).
 * Reading only the entries told the coach "nothing scheduled" for clients who were training.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datedWorkouts, isMissed, type DatedDay } from "@/lib/cleo-schedule";

const day = (id: string, date: string | null, extra: Partial<DatedDay> = {}): DatedDay => ({ id, clientId: "nico", title: `Workout ${id}`, focus: null, date, optional: false, visible: true, ...extra });

describe("datedWorkouts", () => {
  const days = [day("a", "2026-11-14"), day("b", "2026-11-15"), day("c", "2026-11-12"), day("opt", "2026-11-16", { optional: true }), day("hidden", "2026-11-13", { visible: false })];
  const out = datedWorkouts({
    days,
    // "c" was moved from Nov 12 to Nov 17 by a schedule entry
    entries: [{ id: "e1", clientId: "nico", dayId: "c", date: "2026-11-17", time: "07:00" }],
    scheduledDayIds: new Set(["c"]),
    completions: [
      { dayId: "a", entryId: null, completedAt: "2026-11-14T20:00:00Z", rating: 2 },
      { dayId: "b", entryId: null, completedAt: null, rating: null },
    ],
    from: "2026-11-11",
    to: "2026-11-18",
  });

  it("lists workouts dated on themselves and schedule entries, in date order, a moved one only where it moved", () => {
    expect(out.map((w) => `${w.date} ${w.dayId}${w.entryId ? `/${w.entryId}` : ""}`)).toEqual(["2026-11-13 hidden", "2026-11-14 a", "2026-11-15 b", "2026-11-16 opt", "2026-11-17 c/e1"]);
  });

  it("a workout dated on itself is done by its own completion; an unfinished one isn't", () => {
    expect(out.find((w) => w.dayId === "a")).toMatchObject({ done: true, rating: 2 });
    expect(out.find((w) => w.dayId === "b")?.done).toBe(false);
  });

  it("a miss is a past, visible, non-optional workout nobody finished", () => {
    const missed = out.filter((w) => isMissed(w, "2026-11-18")).map((w) => w.dayId);
    expect(missed).toEqual(["b", "c"]);
  });

  it("an entry's completion is its own: a finished entry is done even when the day has other entries", () => {
    const r = datedWorkouts({
      days: [day("x", null)],
      entries: [
        { id: "e1", clientId: "nico", dayId: "x", date: "2026-11-12", time: null },
        { id: "e2", clientId: "nico", dayId: "x", date: "2026-11-15", time: null },
      ],
      scheduledDayIds: new Set(["x"]),
      completions: [{ dayId: "x", entryId: "e2", completedAt: "2026-11-15T18:00:00Z", rating: 4 }],
      from: "2026-11-11",
      to: "2026-11-18",
    });
    expect(r.map((w) => [w.entryId, w.done])).toEqual([["e1", false], ["e2", true]]);
  });
});

describe("wiring", () => {
  const tools = readFileSync("src/lib/cleo-tools.server.ts", "utf8");
  it("training_program and team_training read the shared schedule, never the entries table alone", () => {
    expect(tools.match(/loadDatedWorkouts\(db/g)).toHaveLength(2);
    expect(tools).not.toContain('db.from("pl_scheduled_workouts").select("id, client_id, scheduled_date, source_day_id")');
  });
  it("a workout dated on itself moves the app's way, and its undo puts it back", () => {
    expect(readFileSync("src/lib/cleo-program.server.ts", "utf8")).toContain("await moveWorkout({ data: { dayId: t.day.id, newDate: p.date } })");
    expect(readFileSync("src/lib/cleo-history.server.ts", "utf8")).toContain("await moveWorkout({ data: { dayId: snap.movedDay.id, newDate: snap.movedDay.scheduled_date } })");
  });
});
