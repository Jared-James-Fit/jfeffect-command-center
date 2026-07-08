/**
 * Slice 2b — instance-scoped completion for the client workout adapter.
 *
 * These tests mock the Supabase client at module scope so the adapter
 * runs entirely in-memory. They verify the completion-scoping rules that
 * make two scheduled instances of the same source day keep independent
 * completion state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Filter = { col: string; op: string; val: any };

// Recording query builder. Each `from(...)` call captures the filters +
// operation, so tests can assert exactly how the adapter scoped the
// query.
function makeBuilder(rows: any[]) {
  const state: {
    filters: Filter[];
    op: "select" | "insert" | "update" | null;
    payload: any;
  } = { filters: [], op: null, payload: null };
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
    eq: (col: string, val: any) => {
      state.filters.push({ col, op: "eq", val });
      return api;
    },
    is: (col: string, val: any) => {
      state.filters.push({ col, op: "is", val });
      return api;
    },
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      // Return the first row matching every filter, or null.
      const match = rows.find((r) =>
        state.filters.every((f) => {
          if (f.op === "is") return r[f.col] === null && f.val === null;
          return r[f.col] === f.val;
        }),
      );
      return { data: match ?? null, error: null };
    },
  };
  return api;
}

const captured: any = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const b = makeBuilder(captured.rows ?? []);
      captured.lastTable = table;
      captured.last = b._state;
      return b;
    },
  },
}));

vi.mock("@/lib/schedule-bulk.functions", () => ({
  getClientSchedule: vi.fn(),
  applyBulkScheduleChange: vi.fn(),
}));
vi.mock("@/lib/pl-maxes", () => ({ listClientMaxes: vi.fn(async () => []) }));
vi.mock("@/lib/exercise-unit-prefs", () => ({ saveExerciseUnitPref: vi.fn() }));
vi.mock("@/lib/exercise-blocks.functions", () => ({
  getRowBlockSummariesFn: vi.fn(),
}));
vi.mock("@/lib/support-alerts.functions", () => ({
  notifyCoachOfWorkoutFailure: vi.fn(),
}));

import { createClientAdapter } from "@/lib/workout-context/client-adapter";

beforeEach(() => {
  captured.rows = [];
  captured.last = null;
  captured.lastTable = null;
});

describe("client adapter — instance-scoped completion", () => {
  it("scopes getDayCompletionRaw by scheduled_workout_id when provided", async () => {
    captured.rows = [
      { id: "c1", day_id: "day-A", client_id: "client-1", scheduled_workout_id: "inst-1", completed_at: "2026-07-10T00:00:00Z" },
      { id: "c2", day_id: "day-A", client_id: "client-1", scheduled_workout_id: "inst-2", completed_at: null },
    ];
    const adapter = createClientAdapter({
      kind: "client",
      userId: "user-1",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-2",
    });
    const row = await adapter.getDayCompletionRaw("day-A");
    expect(row?.id).toBe("c2");
    // Filters should have scheduled_workout_id eq, and NOT day_id/client_id.
    const f = captured.last.filters;
    expect(f.some((x: any) => x.col === "scheduled_workout_id" && x.val === "inst-2")).toBe(true);
    expect(f.some((x: any) => x.col === "day_id")).toBe(false);
  });

  it("uses legacy scope (client+day+null instance) when no scheduledWorkoutId", async () => {
    captured.rows = [
      { id: "legacy", day_id: "day-A", client_id: "client-1", scheduled_workout_id: null, completed_at: "2026-01-01T00:00:00Z" },
      { id: "inst",   day_id: "day-A", client_id: "client-1", scheduled_workout_id: "inst-1", completed_at: null },
    ];
    const adapter = createClientAdapter({
      kind: "client",
      userId: "user-1",
      ownerId: "client-1",
    });
    const row = await adapter.getDayCompletionRaw("day-A");
    // Must NOT return the instance row — legacy path stays null-scoped.
    expect(row?.id).toBe("legacy");
    const f = captured.last.filters;
    expect(f.some((x: any) => x.col === "client_id" && x.val === "client-1")).toBe(true);
    expect(f.some((x: any) => x.col === "day_id" && x.val === "day-A")).toBe(true);
    expect(f.some((x: any) => x.col === "scheduled_workout_id" && x.op === "is" && x.val === null)).toBe(true);
  });

  it("two instances of the same day resolve to two different completion rows", async () => {
    captured.rows = [
      { id: "c-inst-A", day_id: "day-X", client_id: "client-1", scheduled_workout_id: "inst-A", completed_at: null },
      { id: "c-inst-B", day_id: "day-X", client_id: "client-1", scheduled_workout_id: "inst-B", completed_at: "2026-07-08T00:00:00Z" },
    ];
    const a = createClientAdapter({ kind: "client", userId: "u", ownerId: "client-1", scheduledWorkoutId: "inst-A" });
    const b = createClientAdapter({ kind: "client", userId: "u", ownerId: "client-1", scheduledWorkoutId: "inst-B" });
    const rowA = await a.getDayCompletionRaw("day-X");
    const rowB = await b.getDayCompletionRaw("day-X");
    expect(rowA?.id).toBe("c-inst-A");
    expect(rowB?.id).toBe("c-inst-B");
    expect(rowA?.completed_at).toBeNull();
    expect(rowB?.completed_at).not.toBeNull();
  });

  it("insert path stamps scheduled_workout_id when instance is provided", async () => {
    // No existing row → adapter will insert.
    captured.rows = [];
    const adapter = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-99",
    });
    await adapter.updateDayCompletion("day-Q", { completedAt: "2026-07-08T00:00:00Z" });
    // Last operation captured should be the insert.
    expect(captured.last.op).toBe("insert");
    expect(captured.last.payload.scheduled_workout_id).toBe("inst-99");
    expect(captured.last.payload.day_id).toBe("day-Q");
    expect(captured.last.payload.client_id).toBe("client-1");
  });

  it("legacy insert path never sets scheduled_workout_id", async () => {
    captured.rows = [];
    const adapter = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
    });
    await adapter.updateDayCompletion("day-Q", { completedAt: "2026-07-08T00:00:00Z" });
    expect(captured.last.op).toBe("insert");
    expect(captured.last.payload.scheduled_workout_id).toBeUndefined();
  });

  it("upsertPlDayCompletionRaw stamps scheduled_workout_id on insert when instance is set", async () => {
    const adapter = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-77",
    });
    await adapter.upsertPlDayCompletionRaw({ day_id: "day-Q", client_id: "client-1", client_notes: "hi" }, null);
    expect(captured.last.op).toBe("insert");
    expect(captured.last.payload.scheduled_workout_id).toBe("inst-77");
  });

  it("upsertPlDayCompletionRaw with explicit id issues an UPDATE and never overwrites instance ID", async () => {
    const adapter = createClientAdapter({
      kind: "client",
      userId: "u",
      ownerId: "client-1",
      scheduledWorkoutId: "inst-77",
    });
    await adapter.upsertPlDayCompletionRaw({ client_notes: "hi" }, "existing-completion-id");
    expect(captured.last.op).toBe("update");
    // Payload should be passed through as-is (no scheduled_workout_id added to update).
    expect(captured.last.payload.scheduled_workout_id).toBeUndefined();
  });
});