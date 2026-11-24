/**
 * Nov 24 2026: rewriting every live block's words, runs of six blocks one after another were cut off
 * by the cron's 120 s limit after the second block (each takes 20–60 s with the plain-words check),
 * so the third was wasted and the queue crawled. A run writes three at a time and starts nothing
 * once it's `TICK_BUDGET_MS` old; what it didn't start stays queued for the next run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/ai/model-client.server", () => ({
  callModel: async () => {
    calls.n++;
    throw new Error("the model should not be asked");
  },
}));

import { runRoadmapTick, TICK_BUDGET_MS, TICK_LIMIT_MS } from "@/lib/training-roadmap.server";

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

/** A database holding one programmed block; reading the block takes `readMs` of the run's time. */
function programmedBlock(readMs: number) {
  let clock = 2_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const writes: string[] = [];
  const block = { id: "b1", client_id: "c1", name: "Block 1 — Strength", goal: null, training_focus: null, start_date: "2026-11-23", end_date: "2026-12-20", weeks: 1, week_duration_days: 7, prep_id: null, status: "Active", archived: false, client_visible: true, sort_order: 1, created_at: "2026-11-01", source_template_block_key: null };
  const data: Record<string, unknown> = {
    pl_blocks: [block],
    pl_weeks: [{ id: "w1", week_index: 1, phase: null, start_date: "2026-11-23", end_date: "2026-11-29", archived: false, deleted_at: null }],
    pl_days: [{ id: "d1", week_id: "w1", day_index: 1, title: "Day 1", subtitle: "Lower", focus: null, archived: false, deleted_at: null }],
    pl_exercise_rows: [{ day_id: "d1", sort_order: 1, sets: 3, reps_text: "5", rpe: 7, rir: null, percentage: null, percentage_basis: null, tempo: null, intensity_techniques: null, exercise_name_override: null, exercises: { name: "Competition Squat", is_competition_lift: true, category: "squat", primary_muscle_group: "quads" } }],
    pl_roadmap_notes: [],
    pl_roadmap_queue: [{ block_id: "b1", queued_at: "2026-11-24T00:00:00Z", attempts: 0 }],
  };
  const from = (table: string) => {
    let op = "select";
    const b: any = {};
    for (const m of ["select", "eq", "neq", "in", "is", "not", "lte", "order", "limit"]) b[m] = () => b;
    b.update = () => ((op = "update"), writes.push(`${table}:update`), b);
    b.delete = () => ((op = "delete"), writes.push(`${table}:delete`), b);
    b.insert = () => (writes.push(`${table}:insert`), b);
    b.maybeSingle = async () => {
      if (table === "pl_blocks") {
        clock += readMs;
        return { data: block, error: null };
      }
      return { data: null, error: null };
    };
    b.then = (res: any, rej: any) => Promise.resolve({ data: op === "select" ? data[table] ?? [] : null, error: null }).then(res, rej);
    return b;
  };
  return { admin: { from }, writes };
}

describe("a model call never runs past the run's time", () => {
  it("a block with no time left for a call waits for the next run: no call, no try used, nothing written", async () => {
    calls.n = 0;
    const f = programmedBlock(TICK_LIMIT_MS - 5_000);
    const r = await runRoadmapTick(f.admin);
    expect(calls.n).toBe(0);
    expect(r.results).toEqual([{ blockId: "b1", outcome: "later" }]);
    expect(f.writes).toEqual([]);
  });
  it("with time left the writer is asked (and its failure is a normal try)", async () => {
    calls.n = 0;
    const f = programmedBlock(1_000);
    const r = await runRoadmapTick(f.admin);
    expect(calls.n).toBeGreaterThan(0);
    expect((r.results[0] as any).error).toMatch(/No model answered/);
    expect(f.writes).toEqual(["pl_roadmap_queue:update"]);
  });
});
