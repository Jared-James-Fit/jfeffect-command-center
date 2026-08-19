import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("bodyweight write contract", () => {
  it("keeps portal bodyweight saves out of the legacy progress_metrics table", () => {
    for (const path of [
      "src/components/log-bodyweight-card.tsx",
      "src/components/portal/bodyweight-summary-card.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("logBodyweight");
      expect(source).not.toMatch(/from\("progress_metrics"\)\.(insert|update|delete)/);
    }
  });

  it("keeps the shared home card on the canonical series after edits and deletes", () => {
    const source = read("src/components/home/home-bodyweight-card.tsx");
    expect(source).toContain("listBodyweight");
    expect(source).not.toContain("getCombinedBodyweightSeries");
  });

  it("stages owner-scoped save and delete RPCs before revoking direct authenticated writes", () => {
    const migration = read("supabase/migrations/20260819013000_canonical_bodyweight_mutations.sql");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.save_progress_bodyweight");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.delete_progress_bodyweight");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.progress_bodyweight FROM authenticated",
    );
  });
});
