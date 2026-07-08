/**
 * Slice 2c — write-isolation tests for the client adapter.
 *
 * The adapter mocks the Supabase client at module scope so we can assert
 * exactly which filters and payloads a write ended up with. These tests
 * verify that two calendar instances of the same source day never touch
 * the same pl_row_results, pl_day_completions, or activity heartbeat row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Filter = { col: string; op: string; val: any };

interface State {
  table: string;
  op: "select" | "insert" | "update" | "delete" | null;
  payload: any;
  filters: Filter[];
}

// Recorded write log so tests can inspect the whole sequence.
const log: State[] = [];
// Rows the mocked SELECT-maybeSingle should choose from.
let rows: any[] = [];

function makeBuilder(table: string) {
  const state: State = { table, op: null, payload: null, filters: [] };
  log.push(state);
  const api: any = {
    _state: state,
    select: () => {
      state.op = state.op ?? "select";
      return api;
    },
    insert: (payload: any) => {
      state.op = "insert";
      state.payload = payload;
      return api;
    },
    update: (payload: any) => {
      state.op = "update";
      state.payload = payload;
      return api;
    },
    delete: () => {
      state.op = "delete";
      return api;
    },
    eq: (col: string, val: any) => {
      state.filters.push({ col, op: "eq", val });
      return api;
    },
    is: (col: string, val: any) => {
      state.filters.push({ col, op: "is", val });
      return api;
    },
    in: (col: string, val: any[]) => {
      state.filters.push({ col, op: "in", val });
      return api;
    },
    order: () => api,
    limit: () => api,
    // Allow `await builder` to resolve to a shape that satisfies
    // .in()-based list queries in the adapter (rowIds fetch, etc).
    then: (resolve: any) => resolve({ data: rows, error: null }),
    single: async () => ({
      data: rows.find((r) =>
        state.filters.every((f) =>
          f.op === "is" ? r[f.col] === null && f.val === null : r[f.col] === f.val,
        ),
      ) ?? { id: "generated-id" },
      error: null,
    }),
    maybeSingle: async () => ({
      data:
        rows.find((r) =>
          state.filters.every((f) =>
            f.op === "is" ? r[f.col] === null && f.val === null : r[f.col] === f.val,
          ),
        ) ?? null,
      error: null,
    }),
  };
  return api;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => makeBuilder(t) },
}));

vi.mock("@/lib/schedule-bulk.functions", () => ({
  getClientSchedule: vi.fn(),
  applyBulkScheduleChange: vi.fn(),
}));
vi.mock("@/lib/pl-maxes", () => ({ listClientMaxes: vi.fn(async () => []) }));
vi.mock("@/lib/exercise-unit-prefs", () => ({ saveExerciseUnitPref: vi.fn() }));
vi.mock("@/lib/exercise-blocks.functions", () => ({ getRowBlockSummariesFn: vi.fn() }));
vi.mock("@/lib/support-alerts.functions", () => ({ notifyCoachOfWorkoutFailure: vi.fn() }));

import { createClientAdapter } from "@/lib/workout-context/client-adapter";

beforeEach(() => {
  log.length = 0;
  rows = [];
});

function lastWrite(table: string): State | undefined {
  return [...log].reverse().find((s) => s.table === table && (s.op === "insert" || s.op === "update"));
}
function lastSelect(table: string): State | undefined {
  return [...log].reverse().find((s) => s.table === table && s.op === "select");
}

describe("client adapter — pl_row_results write isolation across instances", () => {
  it("logging a set in Instance A inserts with instance A's scheduled_workout_id", async () => {
    const a = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-A",
    });
    await a.upsertRowResult({ rowId: "row-1", setIndex: 0, reps: 5, loadLb: 100 });
    const write = lastWrite("pl_row_results");
    expect(write?.op).toBe("insert");
    expect(write?.payload.scheduled_workout_id).toBe("inst-A");
    expect(write?.payload.row_id).toBe("row-1");
  });

  it("logging a set in Instance B is scoped to instance B — never touches instance A's row", async () => {
    // Pretend instance A already has a row saved for (row-1, set 0).
    rows = [
      { id: "existing-A", row_id: "row-1", set_index: 0, scheduled_workout_id: "inst-A", client_id: "client-1" },
    ];
    const b = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-B",
    });
    await b.upsertRowResult({ rowId: "row-1", setIndex: 0, reps: 3, loadLb: 200 });
    // Existence check filtered by scheduled_workout_id=inst-B → no match → INSERT
    const write = lastWrite("pl_row_results");
    expect(write?.op).toBe("insert");
    expect(write?.payload.scheduled_workout_id).toBe("inst-B");
    // Nothing should have UPDATE'd existing-A.
    const anyUpdateOfExistingA = log.some(
      (s) => s.table === "pl_row_results" && s.op === "update" && s.filters.some((f) => f.col === "id" && f.val === "existing-A"),
    );
    expect(anyUpdateOfExistingA).toBe(false);
  });

  it("re-logging the same set in Instance A updates instance A's row only", async () => {
    rows = [
      { id: "existing-A", row_id: "row-1", set_index: 0, scheduled_workout_id: "inst-A", client_id: "client-1" },
    ];
    const a = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-A",
    });
    await a.upsertRowResult({ rowId: "row-1", setIndex: 0, reps: 6, loadLb: 110 });
    const write = lastWrite("pl_row_results");
    expect(write?.op).toBe("update");
    expect(write?.filters.some((f) => f.col === "id" && f.val === "existing-A")).toBe(true);
  });

  it("legacy null-instance write stays isolated from instance rows", async () => {
    // A pre-slice-2 legacy row exists for (client-1, row-1, set 0).
    rows = [
      { id: "legacy", row_id: "row-1", set_index: 0, scheduled_workout_id: null, client_id: "client-1" },
    ];
    const legacyAdapter = createClientAdapter({ kind: "client", userId: "u", ownerId: "client-1" });
    await legacyAdapter.upsertRowResult({ rowId: "row-1", setIndex: 0, reps: 7 });
    const write = lastWrite("pl_row_results");
    expect(write?.op).toBe("update");
    expect(write?.filters.some((f) => f.col === "id" && f.val === "legacy")).toBe(true);
    // Same row_id + set_index but with an instance → different existence
    // check → will insert a NEW row, not touch the legacy one.
    log.length = 0;
    const inst = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-Z",
    });
    // Existence-check reads rows[] again; instance filter finds nothing.
    await inst.upsertRowResult({ rowId: "row-1", setIndex: 0, reps: 8 });
    const write2 = lastWrite("pl_row_results");
    expect(write2?.op).toBe("insert");
    expect(write2?.payload.scheduled_workout_id).toBe("inst-Z");
  });

  it("listRowResults for Instance A never returns Instance B's set logs", async () => {
    // The adapter first fetches row_ids, then queries pl_row_results with
    // an .in("row_id", …) + instance filter. Verify the filter set.
    rows = [{ id: "row-1" }];
    const a = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-A",
    });
    await a.listRowResults("day-1");
    // The last pl_row_results SELECT should be filtered by scheduled_workout_id=inst-A
    const sel = [...log].reverse().find((s) => s.table === "pl_row_results" && s.op === "select");
    expect(sel?.filters.some((f) => f.col === "scheduled_workout_id" && f.val === "inst-A")).toBe(true);
    // …and NOT by client_id (instance path uses instance alone).
    expect(sel?.filters.some((f) => f.col === "client_id")).toBe(false);
  });

  it("listRowResults legacy path filters by client_id AND scheduled_workout_id IS NULL", async () => {
    rows = [{ id: "row-1" }];
    const legacy = createClientAdapter({ kind: "client", userId: "u", ownerId: "client-1" });
    await legacy.listRowResults("day-1");
    const sel = [...log].reverse().find((s) => s.table === "pl_row_results" && s.op === "select");
    expect(sel?.filters.some((f) => f.col === "client_id" && f.val === "client-1")).toBe(true);
    expect(
      sel?.filters.some((f) => f.col === "scheduled_workout_id" && f.op === "is" && f.val === null),
    ).toBe(true);
  });
});

describe("client adapter — completion updates isolated per instance", () => {
  it("completing Instance A updates only A's completion row, never inserts a duplicate for B", async () => {
    rows = [
      { id: "comp-A", day_id: "day-X", scheduled_workout_id: "inst-A", client_id: "client-1", completed_at: null },
      { id: "comp-B", day_id: "day-X", scheduled_workout_id: "inst-B", client_id: "client-1", completed_at: null },
    ];
    const a = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-A",
    });
    await a.updateDayCompletion("day-X", { completedAt: "2026-07-08T00:00:00Z" });
    const write = lastWrite("pl_day_completions");
    expect(write?.op).toBe("update");
    expect(write?.filters.some((f) => f.col === "id" && f.val === "comp-A")).toBe(true);
    // Payload must not carry the wrong instance id.
    expect(write?.payload.scheduled_workout_id).toBeUndefined();
  });

  it("reopen-style patch on Instance A leaves Instance B untouched", async () => {
    rows = [
      { id: "comp-A", day_id: "day-X", scheduled_workout_id: "inst-A", client_id: "client-1" },
      { id: "comp-B", day_id: "day-X", scheduled_workout_id: "inst-B", client_id: "client-1" },
    ];
    const a = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-A",
    });
    await a.updateDayCompletion("day-X", { completedAt: null, startedAt: "2026-07-08T00:00:00Z" });
    const writes = log.filter((s) => s.table === "pl_day_completions" && s.op === "update");
    expect(writes.length).toBe(1);
    expect(writes[0].filters.some((f) => f.col === "id" && f.val === "comp-A")).toBe(true);
  });
});
