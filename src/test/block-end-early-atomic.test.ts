import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("end block early atomic contract", () => {
  const lifecycle = fs.readFileSync("src/lib/block-lifecycle.functions.ts", "utf8");
  const migration = fs.readFileSync("drizzle/migrations/0008_pl_end_block_early_atomic.sql", "utf8");

  it("uses the canonical atomic RPC instead of sequential destructive writes", () => {
    const fn = lifecycle.slice(
      lifecycle.indexOf("export const endBlockEarlyFn"),
      lifecycle.indexOf("// ─────────────────────────────────────────────────────────────────────────────\n// SET BLOCK DATES"),
    );

    expect(fn).toContain('.rpc("pl_end_block_early"');
    expect(fn).not.toContain('.from("pl_scheduled_workouts")');
    expect(fn).not.toContain('.from("pl_days")');
    expect(fn).not.toContain('.from("pl_blocks")');
  });

  it("uses the only valid manual completion method", () => {
    expect(migration).toContain("completion_method = 'manual'");
    expect(migration).not.toContain("completion_method = 'ended_early'");
  });

  it("preserves completed workouts while removing only future uncompleted schedule", () => {
    expect(migration).toContain("s.scheduled_date > _new_end");
    expect(migration).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.pl_day_completions c[\s\S]*c\.completed_at IS NOT NULL/);
    expect(migration).toContain("d.scheduled_date > _new_end");
  });

  it("preview prefers the actual schedule end over stale block metadata", () => {
    expect(lifecycle).toContain("currentEnd: loaded.actualEnd ?? (loaded.block.end_date as string | null) ?? null");
  });

  it("RPC updates schedule cleanup and block completion in one transaction", () => {
    const deletePos = migration.indexOf("DELETE FROM public.pl_scheduled_workouts");
    const clearPos = migration.indexOf("UPDATE public.pl_days d");
    const blockPos = migration.indexOf("UPDATE public.pl_blocks");

    expect(deletePos).toBeGreaterThan(-1);
    expect(clearPos).toBeGreaterThan(deletePos);
    expect(blockPos).toBeGreaterThan(clearPos);
  });
});
