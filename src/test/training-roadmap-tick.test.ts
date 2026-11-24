/**
 * Nov 24 2026: rewriting every live block's words, runs of six blocks one after another were cut off
 * by the cron's 120 s limit after the second block (each takes 20–60 s with the plain-words check),
 * so the third was wasted and the queue crawled. A run writes three at a time and starts nothing
 * once it's `TICK_BUDGET_MS` old; what it didn't start stays queued for the next run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRoadmapTick, TICK_BUDGET_MS } from "@/lib/training-roadmap.server";

/** A database where every queued block is gone (so a block is one quick read), and each read takes `stepMs`. */
function fakeAdmin(ids: string[], stepMs: number) {
  let clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const queue = ids.map((id, i) => ({ block_id: id, queued_at: `2026-11-24T00:0${i}:00Z`, attempts: 0 }));
  const deleted: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const from = (table: string) => {
    let op = "select";
    const filters: Record<string, unknown> = {};
    const b: any = {
      select: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      in: () => b,
      is: () => b,
      not: () => b,
      eq: (k: string, v: unknown) => ((filters[k] = v), b),
      delete: () => ((op = "delete"), b),
      update: () => ((op = "update"), b),
      maybeSingle: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        clock += stepMs;
        inFlight--;
        return { data: null, error: null };
      },
      then: (res: any, rej: any) => {
        let out: any = { data: null, error: null };
        if (table === "pl_roadmap_queue" && op === "select") out = { data: queue, error: null };
        if (table === "pl_roadmap_queue" && op === "delete") deleted.push(String(filters.block_id));
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  };
  return { admin: { from }, deleted, peak: () => maxInFlight };
}

afterEach(() => vi.restoreAllMocks());

describe("a roadmap run answers inside the cron's time", () => {
  it("writes three blocks at a time", async () => {
    const f = fakeAdmin(["a", "b", "c", "d", "e", "f"], 1_000);
    const r = await runRoadmapTick(f.admin);
    expect(f.peak()).toBe(3);
    expect(r.checked).toBe(6);
    expect(r.left).toBe(0);
    expect(f.deleted.sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("starts nothing once the run is past its budget; the rest stay queued", async () => {
    const f = fakeAdmin(["a", "b", "c", "d", "e", "f"], TICK_BUDGET_MS);
    const r = await runRoadmapTick(f.admin);
    expect(r.checked).toBe(3);
    expect(r.left).toBe(3);
    expect(f.deleted.sort()).toEqual(["a", "b", "c"]);
  });
});
