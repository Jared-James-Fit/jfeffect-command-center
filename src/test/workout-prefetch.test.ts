import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const maybeSingle = vi.fn();
const adapter = { getDayRaw: vi.fn(), listRowsRaw: vi.fn(), listRowResultsRaw: vi.fn() };
const createClientAdapter = vi.fn(() => adapter);
const writePlanCache = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: (...a: unknown[]) => getSession(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => maybeSingle(...a) }) }) }),
  },
}));
vi.mock("@/lib/workout-context/client-adapter", () => ({ createClientAdapter: (...a: unknown[]) => createClientAdapter(...(a as [])) }));
vi.mock("@/lib/workout-plan-cache", () => ({ writePlanCache: (...a: unknown[]) => writePlanCache(...a) }));

const { prefetchWorkoutOpen } = await import("@/lib/workout-prefetch");
const { plDayKey, plDayResultsKey, plDayRowsKey, portalRouteMyClientKey } = await import("@/lib/workout-query-keys");

const DAY = "day-1", CLIENT = "client-1", USER = "user-1", INSTANCE = "inst-1";

beforeEach(() => {
  (globalThis as any).window = {};
  getSession.mockResolvedValue({ data: { session: { user: { id: USER } } } });
  maybeSingle.mockResolvedValue({ data: { id: CLIENT, user_id: USER } });
  adapter.getDayRaw.mockResolvedValue({ id: DAY, week_id: "w1" });
  adapter.listRowsRaw.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
  adapter.listRowResultsRaw.mockResolvedValue([{ row_id: "r1", set_index: 0 }]);
});
afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as any).window;
});

describe("prefetchWorkoutOpen", () => {
  it("fills the exact cache entries the logger reads", async () => {
    const qc = new QueryClient();
    await prefetchWorkoutOpen(qc, { dayId: DAY, instanceId: INSTANCE });
    expect(qc.getQueryData(portalRouteMyClientKey(USER))).toEqual({ id: CLIENT, user_id: USER });
    expect(qc.getQueryData(plDayKey(DAY, "client", CLIENT))).toEqual({ id: DAY, week_id: "w1" });
    expect(qc.getQueryData(plDayRowsKey(DAY, "client", CLIENT))).toHaveLength(2);
    expect(qc.getQueryData(plDayResultsKey(DAY, CLIENT, "client", CLIENT, INSTANCE))).toEqual([{ row_id: "r1", set_index: 0 }]);
    // results are scoped by the row ids just fetched, and by the instance
    expect(adapter.listRowResultsRaw).toHaveBeenCalledWith(DAY, ["r1", "r2"]);
    expect(createClientAdapter).toHaveBeenCalledWith({ kind: "client", userId: USER, ownerId: CLIENT, scheduledWorkoutId: INSTANCE });
  });

  it("keeps the offline plan cache fresh, like the logger's own queries", async () => {
    await prefetchWorkoutOpen(new QueryClient(), { dayId: DAY });
    expect(writePlanCache).toHaveBeenCalledWith(`portal:${DAY}`, "day", expect.anything());
    expect(writePlanCache).toHaveBeenCalledWith(`portal:${DAY}`, "rows", expect.anything());
    expect(writePlanCache).toHaveBeenCalledWith(`portal:${DAY}`, `results:${CLIENT}`, expect.anything());
  });

  it("doesn't refetch while data is fresh (hover, then tap)", async () => {
    const qc = new QueryClient();
    await prefetchWorkoutOpen(qc, { dayId: DAY });
    await prefetchWorkoutOpen(qc, { dayId: DAY });
    expect(adapter.getDayRaw).toHaveBeenCalledTimes(1);
    expect(adapter.listRowsRaw).toHaveBeenCalledTimes(1);
    expect(adapter.listRowResultsRaw).toHaveBeenCalledTimes(1);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a signed-in session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await prefetchWorkoutOpen(new QueryClient(), { dayId: DAY });
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(adapter.getDayRaw).not.toHaveBeenCalled();
  });

  it("does nothing on the server (no window)", async () => {
    delete (globalThis as any).window;
    await prefetchWorkoutOpen(new QueryClient(), { dayId: DAY });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("skips quietly for an account with no client row (e.g. a coach)", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    await prefetchWorkoutOpen(new QueryClient(), { dayId: DAY });
    expect(adapter.getDayRaw).not.toHaveBeenCalled();
  });

  it("never throws — it's only an optimisation", async () => {
    adapter.listRowsRaw.mockRejectedValue(new Error("network"));
    await expect(prefetchWorkoutOpen(new QueryClient(), { dayId: DAY })).resolves.toBeUndefined();
    getSession.mockRejectedValue(new Error("boom"));
    await expect(prefetchWorkoutOpen(new QueryClient(), { dayId: DAY })).resolves.toBeUndefined();
  });

  it("skips the results query for a workout with no exercises", async () => {
    adapter.listRowsRaw.mockResolvedValue([]);
    await prefetchWorkoutOpen(new QueryClient(), { dayId: DAY });
    expect(adapter.listRowResultsRaw).not.toHaveBeenCalled();
  });
});

describe("cache keys stay identical to the logger's originals", () => {
  it("builders produce the exact arrays the logger used to inline", () => {
    expect(plDayKey("d", "client", "o")).toEqual(["pl-day", "d", "client", "o"]);
    expect(plDayKey("d", undefined, undefined)).toEqual(["pl-day", "d", null, null]);
    expect(plDayRowsKey("d", "client", "o")).toEqual(["pl-day-rows", "d", "client", "o"]);
    expect(plDayResultsKey("d", "c", "client", "o", "s")).toEqual(["pl-day-results", "d", "c", "client", "o", "s"]);
    expect(portalRouteMyClientKey("u")).toEqual(["portal-route-my-client", "u"]);
  });
  it("the logger and the route both use the shared builders", () => {
    const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const route = readFileSync("src/routes/_authenticated/portal/workouts.$dayId.tsx", "utf8");
    expect(logger).toContain("queryKey: plDayKey(dayId, adapter?.kind, adapter?.ref.ownerId)");
    expect(logger).toContain("queryKey: plDayRowsKey(dayId, adapter?.kind, adapter?.ref.ownerId)");
    expect(logger).toContain("queryKey: plDayResultsKey(dayId, client?.id, adapter?.kind, adapter?.ref.ownerId, scheduledWorkoutId)");
    expect(logger).not.toContain('queryKey: ["pl-day", dayId, adapter?.kind ?? null');
    expect(logger).not.toContain('queryKey: ["pl-day-rows", dayId, adapter?.kind ?? null');
    expect(route).toContain("queryKey: portalRouteMyClientKey(portalUserId)");
    expect(route).toContain("prefetchWorkoutOpen(context.queryClient");
  });
});
