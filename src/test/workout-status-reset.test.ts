import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const invalidateQueries = vi.fn(async () => {});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
const useQueryMock = vi.fn((opts: unknown) => ({ opts, data: undefined }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries }), useQuery: (o: unknown) => useQueryMock(o) }));

const { useWorkoutStatusChange, useWorkoutVersions, versionWhen, versionReason, versionSummary } = await import("@/lib/workout-status-change");

const sheet = readFileSync("src/components/workout-status-sheet.tsx", "utf8");
const card = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
const today = readFileSync("src/components/smart-today-card.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20261007220000_workout_status_undo_reset.sql", "utf8");
const history = readFileSync("supabase/migrations/20261007230000_workout_version_history.sql", "utf8");
const historySheet = readFileSync("src/components/workout-history-sheet.tsx", "utf8");

describe("workout status change + undo", () => {
  beforeEach(() => { rpc.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); invalidateQueries.mockClear(); });

  it("resets through the server for exactly this workout instance and offers Undo", async () => {
    rpc.mockResolvedValueOnce({
      data: { snapshot_id: "snap-1", from_status: "in_progress", to_status: "not_started", cleared_sets: 3, cleared_warmups: 1 },
      error: null,
    });
    const { change } = useWorkoutStatusChange({ dayId: "day-1", clientId: "client-1", scheduledWorkoutId: "inst-1" });
    await change("not_started");
    expect(rpc).toHaveBeenCalledWith("workout_set_status", {
      _client_id: "client-1", _day_id: "day-1", _scheduled_workout_id: "inst-1", _status: "not_started",
    });
    const [msg, opts] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toBe("Workout reset · 3 sets cleared");
    expect(opts.action.label).toBe("Undo");

    rpc.mockResolvedValueOnce({ data: { status: "in_progress", restored_sets: 3 }, error: null });
    opts.action.onClick();
    await vi.waitFor(() => expect(rpc).toHaveBeenLastCalledWith("workout_undo_status", { _snapshot_id: "snap-1" }));
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenLastCalledWith("Restored · 3 sets back"));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("plain status changes get Undo too", async () => {
    rpc.mockResolvedValueOnce({
      data: { snapshot_id: "snap-2", from_status: "in_progress", to_status: "completed", cleared_sets: 0, cleared_warmups: 0 },
      error: null,
    });
    const { change } = useWorkoutStatusChange({ dayId: "day-1", clientId: "client-1" });
    await change("completed");
    expect(rpc.mock.calls[0][1]).toMatchObject({ _scheduled_workout_id: null, _status: "completed" });
    expect(toastSuccess.mock.calls[0][0]).toBe("Status: Completed");
    expect((toastSuccess.mock.calls[0][1] as any).action.label).toBe("Undo");
  });

  it("surfaces a refused undo instead of failing silently", async () => {
    const { undo } = useWorkoutStatusChange({ dayId: "day-1", clientId: "client-1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "New sets were logged after the reset — undo would overwrite them" } });
    await undo("snap-3");
    expect(toastError).toHaveBeenCalledWith("Couldn't undo", { description: "New sets were logged after the reset — undo would overwrite them" });
  });
});

describe("one way to each action", () => {
  it("the status sheet resets via the server hook, never a client-side delete", () => {
    expect(sheet).toContain("useWorkoutStatusChange");
    expect(sheet).toContain("Reset this workout?");
    expect(sheet).not.toContain("will not delete your logs");
  });
  it("the workout card's ⋯ menu doesn't repeat the card's Change status / Reschedule buttons", () => {
    expect(card).not.toContain("Reschedule workout");
    expect(card).not.toContain('<CircleDot className="mr-2 h-4 w-4" /> Change status');
    expect(card).toContain("Reset workout");
    expect(card).not.toContain('.from("pl_row_results")\n        .delete()');
  });
  it("the Today card targets the scheduled workout instance", () => {
    expect(today).toContain("scheduledWorkoutId={it.scheduledWorkoutId ?? null}");
  });
});

describe("reset migration safety", () => {
  it("never deletes the completion row (XP is keyed to it)", () => {
    expect(migration).not.toMatch(/DELETE FROM public\.pl_day_completions/);
  });
  it("is limited to signed-in users allowed to act for the client", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.workout_set_status(uuid, uuid, uuid, text) FROM anon;");
    expect(migration).toContain("IF NOT public.workout_can_act_for_client(_client_id) THEN");
  });
  it("scopes everything to one workout instance", () => {
    expect(migration.match(/scheduled_workout_id IS NOT DISTINCT FROM _scheduled_workout_id/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("version history", () => {
  beforeEach(() => { rpc.mockReset(); toastSuccess.mockReset(); });

  it("restores a version and offers Undo back to the version saved just before", async () => {
    rpc.mockResolvedValueOnce({ data: { before_version_id: "pre-1", status: "in_progress", restored_sets: 3 }, error: null });
    const { restore } = useWorkoutStatusChange({ dayId: "day-1", clientId: "client-1", scheduledWorkoutId: "inst-1" });
    await restore("ver-1", "10:15 AM");
    expect(rpc).toHaveBeenCalledWith("workout_restore_version", { _version_id: "ver-1" });
    const [msg, opts] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toBe("Restored to 10:15 AM");
    rpc.mockResolvedValueOnce({ data: { status: "in_progress", restored_sets: 4 }, error: null });
    opts.action.onClick();
    await vi.waitFor(() => expect(rpc).toHaveBeenLastCalledWith("workout_undo_status", { _snapshot_id: "pre-1" }));
  });

  it("loads the list only while the sheet is open, for this workout instance", () => {
    useWorkoutVersions({ dayId: "day-1", clientId: "client-1", scheduledWorkoutId: "inst-1" }, false);
    const opts = useQueryMock.mock.calls.at(-1)![0] as { enabled: boolean; queryKey: unknown[] };
    expect(opts.enabled).toBe(false);
    expect(opts.queryKey).toEqual(["workout-versions", "client-1", "day-1", "inst-1"]);
  });

  it("labels versions the way a lifter reads them", () => {
    const now = new Date();
    now.setHours(10, 15, 0, 0);
    expect(versionWhen(now.toISOString())).toBe("10:15 AM");
    const y = new Date(now.getTime() - 864e5);
    expect(versionWhen(y.toISOString())).toBe("Yesterday 10:15 AM");
    expect(versionReason({ reason: "edit", to_status: null })).toBe("Auto-saved while logging");
    expect(versionReason({ reason: "reset", to_status: "not_started" })).toBe("Before reset");
    expect(versionReason({ reason: "status", to_status: "completed" })).toBe("Before marking Completed");
    expect(versionSummary({ summary: { status: "in_progress", sets: 3, done_sets: 2, review: false } })).toBe("In Progress · 3 sets (2 done)");
    expect(versionSummary({ summary: { status: "completed", sets: 12, done_sets: 12, review: true } })).toBe("Completed · 12 sets · review");
    expect(versionSummary({ summary: { status: "not_started", sets: 0 } })).toBe("Not Started · no sets");
  });

  it("the sheet confirms before restoring and says the current version is kept", () => {
    expect(historySheet).toContain("Restore this version?");
    expect(historySheet).toContain("Your current version is saved first");
  });
});

describe("version history migration: cheap and never in the way", () => {
  it("auto-saves at most once per 15 minutes per workout", () => {
    expect(history).toContain("IF _reason = 'edit' AND latest.id IS NOT NULL AND latest.created_at > now() - interval '15 minutes' THEN");
  });
  it("caps storage: 30 versions per workout, 45 days", () => {
    expect(history).toContain("ORDER BY k.created_at DESC LIMIT 30");
    expect(history).toContain("created_at < now() - interval '45 days'");
  });
  it("a failed capture never blocks a set save", () => {
    expect(history).toContain("EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'workout_version_on_edit: %', SQLERRM;");
  });
  it("only lifecycle changes on the completion row create versions", () => {
    expect(history).toContain("WHEN (OLD.completed_at IS DISTINCT FROM NEW.completed_at");
  });
  it("restoring saves the current state first and never deletes the completion row", () => {
    expect(history).toContain("before_id := public.workout_capture_version(v.client_id, v.day_id, v.scheduled_workout_id, 'restore');");
    expect(history).not.toMatch(/DELETE FROM public\.pl_day_completions/);
  });
  it("internals aren't callable by app users; the list returns summaries only", () => {
    expect(history).toContain("REVOKE ALL ON FUNCTION public.workout_capture_version(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;");
    expect(history).toContain("RETURNS TABLE (id uuid, created_at timestamptz, reason text, to_status text, summary jsonb)");
  });
});
