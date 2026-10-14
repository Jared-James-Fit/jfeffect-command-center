import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { uid: string; role: string } | null,
  pov: false,
  viewMode: null as "staff" | "client" | null,
}));
vi.mock("@/lib/auth", () => ({ cachedSessionRole: () => state.session }));
vi.mock("@/lib/client-impersonation", () => ({ hasStoredClientPov: () => state.pov }));
vi.mock("@/lib/view-mode", () => ({ getViewMode: () => state.viewMode }));

const read = (p: string) => readFileSync(p, "utf8");

// the browser's storage, in memory (these tests run in Node)
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});
vi.stubGlobal("window", globalThis);

import { cachedLaunchTarget, crewHome, launchTarget } from "@/lib/launch-home";
import { clearLastRoute, resumableWorkoutRoute, saveLastRoute } from "@/lib/route-persistence";
import { RESUME_WORKOUT_WITHIN_MS } from "@/lib/workout-resume";

/** A workout being logged, as the Workout Session clock stores it. */
const logging = (dayId: string, lastSeenAt = Date.now()) => {
  store.set("workout-active-day", dayId);
  store.set(`wsession:${dayId}`, JSON.stringify({ startedAt: lastSeenAt - 600_000, pausedMs: 0, pausedAt: null, lastSeenAt, stoppedAt: null }));
};

describe("a fresh launch opens Crew; mid-workout it goes back to the workout", () => {
  beforeEach(() => {
    state.session = null;
    state.pov = false;
    state.viewMode = null;
    store.clear();
  });

  it("opens Crew for everyone with one; the finance login keeps its desk", () => {
    expect(crewHome("client")).toBe("/portal/community");
    expect(crewHome("member")).toBe("/portal/community");
    expect(crewHome("admin", "client")).toBe("/portal/community"); // staff + client account, client view
    expect(crewHome("admin")).toBe("/admin/community");
    expect(crewHome("coach")).toBe("/admin/community");
    expect(crewHome("finance")).toBe("/finance");
    // whatever screen they were on (Home, a client, Nutrition), a fresh launch is Crew
    saveLastRoute("u1", "/portal/nutrition-targets");
    expect(launchTarget("u1", "client")).toBe("/portal/community");
  });

  it("closed (or iOS closed it in the background) mid-workout: back to that workout, with its instance", () => {
    saveLastRoute("u1", "/portal/workouts/day-1", "?instance=sw-9");
    logging("day-1");
    expect(launchTarget("u1", "client")).toBe("/portal/workouts/day-1?instance=sw-9");
    expect(launchTarget("u1", "admin", "client")).toBe("/portal/workouts/day-1?instance=sw-9");
  });

  it("only an unfinished workout from the last 2 hours, and only the one they were on", () => {
    saveLastRoute("u1", "/portal/workouts/day-1");
    logging("day-1", Date.now() - RESUME_WORKOUT_WITHIN_MS - 60_000);
    expect(resumableWorkoutRoute("u1")).toBeNull(); // too long ago: Crew
    logging("day-2");
    expect(resumableWorkoutRoute("u1")).toBeNull(); // a different workout is running
    store.delete("workout-active-day"); // finished (the clock clears it)
    expect(launchTarget("u1", "client")).toBe("/portal/community");
    saveLastRoute("u1", "/portal/workouts/analytics");
    logging("analytics");
    expect(resumableWorkoutRoute("u1")).toBeNull(); // the analytics page isn't a workout
    saveLastRoute("u2", "/portal/workouts/day-3");
    logging("day-3");
    clearLastRoute("u2"); // signed out
    expect(resumableWorkoutRoute("u2")).toBeNull();
    expect(launchTarget("u2", "finance")).toBe("/finance");
  });

  it("the fast launch goes straight there when this device knows the role, else waits for the full check", () => {
    state.session = { uid: "u1", role: "client" };
    expect(cachedLaunchTarget()).toBe("/portal/community");
    saveLastRoute("u1", "/portal/workouts/day-1");
    logging("day-1");
    expect(cachedLaunchTarget()).toBe("/portal/workouts/day-1");
    state.session = { uid: "u2", role: "coach" };
    expect(cachedLaunchTarget()).toBe("/admin/community");
    state.session = { uid: "u3", role: "media_manager" };
    expect(cachedLaunchTarget()).toBeNull();
    state.session = { uid: "u2", role: "admin" };
    state.pov = true;
    expect(cachedLaunchTarget()).toBeNull(); // "View as client"
    state.pov = false;
    state.viewMode = "client";
    expect(cachedLaunchTarget()).toBeNull(); // dual account chose a view
    state.session = null;
    expect(cachedLaunchTarget()).toBeNull();
  });

  it("is wired in, and nothing sends an app coming back from another app anywhere", () => {
    expect(read("src/routes/__root.tsx")).toContain('saveLastRoute(user.id, location.pathname, location.searchStr ?? "");');
    const index = read("src/routes/index.tsx");
    expect(index).toContain("const target = cachedLaunchTarget();");
    expect(index).toContain('navigate({ href: launchTarget(user.id, role, "client"), replace: true });');
    expect(index).toContain('navigate({ href: viewOnly ? "/finance" : launchTarget(user.id, role), replace: true });');
    expect(read("src/routes/app.tsx")).toContain("const target = cachedLaunchTarget();");
    expect(read("src/lib/auth.tsx")).toContain("if (uid) clearLastRoute(uid);");
    expect(read("src/components/workout-day/WorkoutTimer.tsx")).toContain("const ACTIVE_DAY_KEY = ACTIVE_WORKOUT_DAY_KEY;");
    expect(existsSync("src/lib/app-reopen.ts")).toBe(false);
    expect(read("src/routes/_authenticated/route.tsx")).not.toContain("reopenTarget");
    expect(read("public/manifest.json")).toContain('"start_url": "/"');
  });
});
