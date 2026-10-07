import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchAllPages } from "@/lib/supabase-paginate";
import { recentPRs } from "@/lib/pl-programs";

describe("fetchAllPages", () => {
  it("keeps reading past the 1,000-row cap until a short page", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllPages((from, to) => {
      calls.push([from, to]);
      return Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + 1000)), error: null });
    });
    expect(rows).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("surfaces errors instead of returning partial history", async () => {
    await expect(fetchAllPages(() => Promise.resolve({ data: null, error: new Error("boom") }))).rejects.toThrow("boom");
  });
});

describe("client analytics read the whole history", () => {
  const src = readFileSync("src/lib/pl-programs.ts", "utf8");
  it("getClientResults pages with a deterministic order and drops warm-ups", () => {
    expect(src).toMatch(/fetchAllPages\(\(from, to\) => sb\s+\.from\("pl_row_results"\)/);
    expect(src).toMatch(/\.order\("id", \{ ascending: true \}\)\s+\.range\(from, to\)/);
    expect(src).toContain('.filter((r: any) => r.is_working_set !== false)');
  });
});

describe("recentPRs ignores unreliable high-rep e1RMs", () => {
  const day = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const set = (load: number, reps: number, d: number) => ({ exercise_id: "sq", exercise_name: "Squat", load, reps, est_1rm: load * (1 + reps / 30), date: day(d) });
  it("a 20-rep set never becomes a PR over a heavy triple", () => {
    expect(recentPRs([set(400, 3, 20), set(260, 20, 2)])).toHaveLength(0);
  });
  it("a real heavier triple still is", () => {
    expect(recentPRs([set(400, 3, 20), set(410, 3, 2)])).toHaveLength(1);
  });
});
