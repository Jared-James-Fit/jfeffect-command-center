/**
 * Slice 2c — instance-safety tests for the schedule calendar chip
 * builder. Every test below documents a required invariant from the
 * spec: instance-scoped moves, appends on occupied dates, completion
 * isolation, drag ids as instance ids, legacy fallback, and reorder
 * mapping. These run purely against the extracted helper — no React,
 * no Supabase — so they run under 1ms and gate the calendar's
 * duplicate-safety contract on every build.
 */
import { describe, it, expect } from "vitest";
import {
  buildScheduleChips,
  chipIdsToInstanceIds,
} from "@/lib/schedule-calendar-chips";

const day = (id: string, scheduled_date: string | null = null) => ({
  id,
  day_index: 1,
  title: `Day ${id}`,
  scheduled_date,
  week_id: "w1",
});

describe("schedule calendar chip builder — instance safety", () => {
  it("emits one chip per scheduled instance keyed by instance id", () => {
    const chips = buildScheduleChips({
      days: [day("d1")],
      instances: [
        { id: "iA", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0 },
        { id: "iB", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
    });
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.chipId)).toEqual(["inst:iA", "inst:iB"]);
    expect(chips.map((c) => c.instanceId)).toEqual(["iA", "iB"]);
  });

  it("moving instance A (changing its date) has no effect on instance B in the resulting chip list", () => {
    // Simulate the "before move" and "after move" input states.
    const before = buildScheduleChips({
      days: [day("d1")],
      instances: [
        { id: "iA", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0 },
        { id: "iB", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
    });
    const after = buildScheduleChips({
      days: [day("d1")],
      instances: [
        // iA moved from 07-10 → 07-15
        { id: "iA", source_day_id: "d1", scheduled_date: "2026-07-15", scheduled_time: null, order_index: 0 },
        // iB untouched
        { id: "iB", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
    });
    const bB = before.find((c) => c.instanceId === "iB")!;
    const aB = after.find((c) => c.instanceId === "iB")!;
    expect(aB.scheduledDate).toBe(bB.scheduledDate);
    expect(aB.orderIndex).toBe(bB.orderIndex);
  });

  it("moving onto an occupied date appends — both instances survive on that date", () => {
    const chips = buildScheduleChips({
      days: [day("d1"), day("d2")],
      instances: [
        { id: "keep", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0 },
        // moved onto the occupied date with next order_index
        { id: "moved", source_day_id: "d2", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 1 },
      ],
      completions: [],
    });
    const onDate = chips.filter((c) => c.scheduledDate === "2026-07-10");
    expect(onDate).toHaveLength(2);
    expect(onDate.map((c) => c.instanceId).sort()).toEqual(["keep", "moved"]);
  });

  it("changing instance A's time leaves instance B's time untouched in the chip output", () => {
    const chips = buildScheduleChips({
      days: [day("d1")],
      instances: [
        { id: "iA", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: "17:30", order_index: 0 },
        { id: "iB", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 1 },
      ],
      completions: [],
    });
    const a = chips.find((c) => c.instanceId === "iA")!;
    const b = chips.find((c) => c.instanceId === "iB")!;
    expect(a.scheduledTime).toBe("17:30");
    expect(b.scheduledTime).toBeNull();
  });

  it("reorder ids passed through chipIdsToInstanceIds strip the inst: prefix (uses exact scheduled instance IDs)", () => {
    const ordered = chipIdsToInstanceIds(["inst:x1", "inst:x2", "inst:x3"]);
    expect(ordered).toEqual(["x1", "x2", "x3"]);
  });

  it("chipIdsToInstanceIds drops legacy day chips — reorder only operates on scheduled instance IDs", () => {
    const ordered = chipIdsToInstanceIds(["day:legacy1", "inst:x1", "day:legacy2"]);
    expect(ordered).toEqual(["x1"]);
  });

  it("completion for instance A does not appear on instance B's chip", () => {
    const chips = buildScheduleChips({
      days: [day("d1")],
      instances: [
        { id: "iA", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0 },
        { id: "iB", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0 },
      ],
      completions: [
        { day_id: "d1", scheduled_workout_id: "iA", completed_at: "2026-07-10T18:00:00Z" },
      ],
    });
    expect(chips.find((c) => c.instanceId === "iA")!.completion?.completed_at).toBeTruthy();
    expect(chips.find((c) => c.instanceId === "iB")!.completion).toBeNull();
  });

  it("a legacy chip (no instance) uses day: prefix and a null instanceId, so callers can select the legacy write path", () => {
    const chips = buildScheduleChips({
      days: [day("legacy1", "2026-07-08")],
      instances: [],
      completions: [],
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].chipId).toBe("day:legacy1");
    expect(chips[0].instanceId).toBeNull();
  });

  it("a legacy pl_days row that also has a matching instance never emits a legacy chip (no double-render / no wrong-instance move)", () => {
    const chips = buildScheduleChips({
      days: [day("d1", "2026-07-08")],
      instances: [
        { id: "iA", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].instanceId).toBe("iA");
    // legacy pl_days.scheduled_date is not surfaced as a chip
    expect(chips.every((c) => c.chipId !== "day:d1")).toBe(true);
  });

  it("removing instance A leaves instance B on the calendar", () => {
    const chips = buildScheduleChips({
      days: [day("d1")],
      instances: [
        // iA has been removed; only iB remains
        { id: "iB", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0 },
      ],
      completions: [],
    });
    expect(chips.map((c) => c.instanceId)).toEqual(["iB"]);
  });
});
