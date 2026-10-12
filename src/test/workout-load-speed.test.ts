import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("workout screens load without repeat downloads", () => {
  it("a logged set never re-downloads the lift history", () => {
    const src = read("src/components/workout-day/WorkoutDayView.tsx");
    const refresh = src.slice(src.indexOf("const refresh = () => {"), src.indexOf("beginSessionOnAction();", src.indexOf("const refresh = () => {")));
    expect(refresh).toContain('qc.invalidateQueries({ queryKey: ["workout-previous-lifts"], refetchType: "none" });');
    expect(refresh).not.toMatch(/queryKey: \["workout-previous-lifts"\] \}\)/);
    // one history per client and lifts, not per day
    expect(src).toContain('adapter?.kind === "member" ? dayId : null,');
    // live sync ignores this device's own saves
    expect(src).toContain("if (isOwnResultEcho(payload?.new)) return;");
  });

  it("Home's light Today list never shares the Workouts list's cache entry", () => {
    expect(read("src/components/portal/dashboard-today-card.tsx")).toContain('queryKey: ["my-workouts", clientId, "today"]');
  });

  it("cardio reuses the Workouts list instead of loading the program again", () => {
    const src = read("src/components/cardio/ClientCardioSection.tsx");
    expect(src).toContain('queryKey: ["my-workouts", clientId]');
    expect(src).not.toContain('refetchOnMount: "always"');
  });

  it("the workouts list loads its program tree in one round trip, with a stepwise fallback", () => {
    const src = read("src/lib/pl-programs.ts");
    expect(src).toContain("(await loadProgramTreeNested(clientId, options).catch(() => null))");
    expect(src).toContain("?? (await loadProgramTreeStepwise(clientId, options));");
  });

  it("warm-ups for one workout go out as one request", () => {
    const src = read("src/components/workout-day/final-warmup-input.tsx");
    expect(src).toContain('.in("row_id", Array.from(batch.keys()))');
  });
});
