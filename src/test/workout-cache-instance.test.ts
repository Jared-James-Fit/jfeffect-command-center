import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("workout logger's offline cache", () => {
  const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

  it("keeps logged sets and completion per scheduled instance", () => {
    expect(view).toMatch(/resultsCacheKey = \(clientId: string\) => `results:\$\{clientId\}:\$\{instanceCacheKey\}`/);
    expect(view).toMatch(/completionCacheKey = \(clientId: string\) => `completion:\$\{clientId\}:\$\{instanceCacheKey\}`/);
    expect(view).not.toMatch(/`results:\$\{client!?\.id\}`/);
    expect(view).not.toMatch(/`completion:\$\{client!?\.id\}`/);
  });

  it("never passes a cached copy off as fresh: every cached query says how old it is", () => {
    const seeded = view.match(/initialData: [^\n]*cachedInitialData/g) ?? [];
    const aged = view.match(/initialDataUpdatedAt: /g) ?? [];
    expect(seeded.length).toBeGreaterThan(0);
    expect(aged.length).toBe(seeded.length);
  });
});
