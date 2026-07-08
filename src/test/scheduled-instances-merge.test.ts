import { describe, it, expect } from "vitest";
import { mergeScheduledInstances } from "@/lib/scheduled-instances-merge";

const day = (id: string, week_id = "w1", extra: Record<string, unknown> = {}) => ({
  id,
  week_id,
  day_index: 1,
  title: `Day ${id}`,
  ...extra,
});

const item = (dayId: string, extra: Record<string, unknown> = {}) => ({
  day: day(dayId, "w1", (extra as any).day ?? {}),
  week: { id: "w1", week_index: 1 },
  block: { id: "b1", name: "Block" },
  completion: null,
  logged_sets_count: 0,
  ...extra,
});

describe("mergeScheduledInstances", () => {
  it("emits one card per instance and does not double-render legacy scheduled_date", () => {
    const items = [item("d1", { day: day("d1", "w1", { scheduled_date: "2026-07-10" }) })];
    const instances = [{
      id: "inst-1", client_id: "c1", source_day_id: "d1",
      scheduled_date: "2026-07-10", scheduled_time: null,
      order_index: 0, schedule_source: "program",
    }];
    const out = mergeScheduledInstances({ items, instances, completions: [] });
    expect(out).toHaveLength(1);
    expect(out[0].scheduledWorkoutId).toBe("inst-1");
    expect(out[0].scheduledDate).toBe("2026-07-10");
    expect(out[0].scheduleSource).toBe("program");
  });

  it("emits two cards when two instances share one source_day_id (stack on same date)", () => {
    const items = [item("d1")];
    const instances = [
      { id: "i1", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0, schedule_source: "program" },
      { id: "i2", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 1, schedule_source: "manual" },
    ];
    const out = mergeScheduledInstances({ items, instances, completions: [] });
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.scheduledWorkoutId)).toEqual(["i1", "i2"]);
  });

  it("emits two cards for two instances on different dates", () => {
    const items = [item("d1")];
    const instances = [
      { id: "i1", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0, schedule_source: "program" },
      { id: "i2", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0, schedule_source: "copied" },
    ];
    const out = mergeScheduledInstances({ items, instances, completions: [] });
    expect(out.map((o) => o.scheduledDate)).toEqual(["2026-07-10", "2026-07-11"]);
  });

  it("links completion instance-first (does not share completion between instances)", () => {
    const items = [item("d1")];
    const instances = [
      { id: "i1", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0, schedule_source: "program" },
      { id: "i2", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-11", scheduled_time: null, order_index: 0, schedule_source: "copied" },
    ];
    const completions = [
      { id: "c1", day_id: "d1", scheduled_workout_id: "i1", completed_at: "2026-07-10T18:00:00Z" },
    ];
    const out = mergeScheduledInstances({ items, instances, completions });
    const [a, b] = out;
    expect(a.completion?.id).toBe("c1");
    expect(b.completion).toBeNull();
  });

  it("falls back to legacy scheduled_date when no instance exists", () => {
    const items = [item("d1", { day: day("d1", "w1", { scheduled_date: "2026-07-08" }) })];
    const out = mergeScheduledInstances({ items, instances: [], completions: [] });
    expect(out).toHaveLength(1);
    expect(out[0].scheduledWorkoutId).toBeNull();
    expect(out[0].scheduledDate).toBe("2026-07-08");
    expect(out[0].scheduleSource).toBe("legacy");
  });

  it("legacy completion (scheduled_workout_id null) attaches only to legacy fallback card", () => {
    const items = [item("d1", { day: day("d1", "w1", { scheduled_date: "2026-07-08" }) })];
    const completions = [
      { id: "c1", day_id: "d1", scheduled_workout_id: null, completed_at: "2026-07-08T18:00:00Z" },
    ];
    const out = mergeScheduledInstances({ items, instances: [], completions });
    expect(out[0].completion?.id).toBe("c1");
  });

  it("does not attach a legacy (null-instance) completion to an instance card", () => {
    const items = [item("d1")];
    const instances = [{
      id: "i1", client_id: "c1", source_day_id: "d1",
      scheduled_date: "2026-07-10", scheduled_time: null,
      order_index: 0, schedule_source: "program",
    }];
    // Historical no-instance completion left over from before backfill.
    const completions = [
      { id: "cLegacy", day_id: "d1", scheduled_workout_id: null, completed_at: "2026-06-01T00:00:00Z" },
    ];
    const out = mergeScheduledInstances({ items, instances, completions });
    expect(out[0].scheduledWorkoutId).toBe("i1");
    // Rule: instance card only gets its own instance-linked completion.
    expect(out[0].completion).toBeNull();
  });

  it("passes placeholder items (empty weeks) through untouched", () => {
    const placeholder = { day: null, week: { id: "w1", week_index: 1 }, block: { id: "b1" }, completion: null, logged_sets_count: 0 };
    const out = mergeScheduledInstances({ items: [placeholder], instances: [], completions: [] });
    expect(out).toEqual([placeholder]);
  });

  it("sorts stacked instances by (scheduled_date, order_index)", () => {
    const items = [item("d1")];
    const instances = [
      { id: "i2", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 5, schedule_source: "manual" },
      { id: "i1", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-10", scheduled_time: null, order_index: 0, schedule_source: "program" },
      { id: "i3", client_id: "c1", source_day_id: "d1", scheduled_date: "2026-07-09", scheduled_time: null, order_index: 0, schedule_source: "moved" },
    ];
    const out = mergeScheduledInstances({ items, instances, completions: [] });
    expect(out.map((o) => o.scheduledWorkoutId)).toEqual(["i3", "i1", "i2"]);
  });
});