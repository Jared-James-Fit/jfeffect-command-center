import { describe, expect, it } from "vitest";
import { kindOfRole, paceByKind, runReadiness, runSessions, runWeeks, targetTop, weekStart, type RunLogSet } from "@/lib/running/running-analytics";

const set = (o: Partial<RunLogSet>): RunLogSet => ({
  date: "2026-11-10", sessionKey: "a", role: "Easy", seconds: 1800, meters: 5000, rpe: 4, targetRpe: "3-4", ...o,
});

describe("a session is one workout's running, filed under its main set", () => {
  it("a threshold day with a warm-up and cool-down is a threshold run, paced from the reps only", () => {
    const [s] = runSessions([
      set({ role: "Warm-up", seconds: 720, meters: 2000, rpe: 3, targetRpe: "2-3" }),
      set({ role: "Threshold", seconds: 1440, meters: 5000, rpe: 7, targetRpe: "6-7" }),
      set({ role: "Cool-down", seconds: 600, meters: 1500, rpe: 2, targetRpe: "2-3" }),
    ]);
    expect(s.kind).toBe("Threshold");
    expect(s.meters).toBe(8500); // all of it counts as volume
    expect(s.seconds).toBe(2760);
    expect(s.paceSecPerKm).toBeCloseTo(288, 0); // 4:48 /km, the reps alone
    expect(s.targetTop).toBe(7);
  });
  it("roles map to kinds; strides and warm-ups are never a kind", () => {
    expect(kindOfRole("Tempo")).toBe("Threshold");
    expect(kindOfRole("Medium-long")).toBe("Long run");
    expect(kindOfRole("Run/walk")).toBe("Easy");
    expect(kindOfRole("Strides")).toBeNull();
    expect(targetTop("6-7")).toBe(7);
  });
});

describe("weeks and pace", () => {
  it("weeks start on Monday and empty weeks stay in the list", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // a Sunday
    const weeks = runWeeks(runSessions([set({ date: "2026-11-10" }), set({ date: "2026-11-12", sessionKey: "b", meters: 8000 })]), "2026-11-15", 3);
    expect(weeks.map((w) => [w.weekStart, w.runs, w.meters, w.longestMeters])).toEqual([
      ["2026-10-26", 0, 0, 0],
      ["2026-11-02", 0, 0, 0],
      ["2026-11-09", 2, 13000, 8000],
    ]);
  });
  it("pace is compared only within one kind of run, last 4 against the 4 before", () => {
    const easy = Array.from({ length: 8 }, (_, i) =>
      set({ sessionKey: `e${i}`, date: `2026-10-${String(10 + i).padStart(2, "0")}`, seconds: i < 4 ? 1950 : 1860, meters: 5000 }),
    );
    const threshold = [set({ sessionKey: "t1", date: "2026-10-20", role: "Threshold", seconds: 1440, meters: 5000, targetRpe: "6-7" })];
    const kinds = paceByKind(runSessions([...easy, ...threshold]));
    const e = kinds.find((k) => k.kind === "Easy")!;
    expect(e.recent).toBeCloseTo(372, 0);
    expect(e.before).toBeCloseTo(390, 0);
    const t = kinds.find((k) => k.kind === "Threshold")!;
    expect(t.before).toBeNull(); // one session: nothing to compare
  });
});

describe("readiness is the programs' own rule, never the calendar", () => {
  const today = "2026-11-14";
  const planned = (n: number, done: number) =>
    Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(2 + i).padStart(2, "0")}`, dayId: `d${i}`, optional: false, done: i < done }));
  const runs = (n: number, rpe = 4) => runSessions(Array.from({ length: n }, (_, i) => set({ sessionKey: `r${i}`, date: `2026-11-${String(2 + i).padStart(2, "0")}`, rpe })));

  it("most runs done and easy runs feel easy: progress", () => {
    expect(runReadiness(runs(6), planned(6, 6), today).status).toBe("progress");
  });
  it("missed runs: repeat the week; under half: back off", () => {
    expect(runReadiness(runs(4), planned(6, 4), today).status).toBe("hold");
    expect(runReadiness(runs(2), planned(6, 2), today).status).toBe("back_off");
  });
  it("easy runs feeling hard holds the week even with everything done", () => {
    const r = runReadiness(runs(6, 6), planned(6, 6), today);
    expect(r.status).toBe("hold");
    expect(r.reasons.join(" ")).toMatch(/Easy runs are feeling hard/);
  });
  it("an optional run only counts once it's done", () => {
    const p = [...planned(4, 4), { date: "2026-11-08", dayId: "opt", optional: true, done: false }];
    expect(runReadiness(runs(4), p, today).status).toBe("progress");
  });
  it("too little to go on says so", () => {
    expect(runReadiness(runs(1), [], today).status).toBe("unknown");
  });
});
