import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261006090000_full_unique_indexes_for_upserts.sql", "utf8");
const card = readFileSync("src/components/cardio/CardioCompletionCard.tsx", "utf8");

describe("upserts need a full unique index (Postgres can't infer a partial one)", () => {
  it.each([
    ["cardio_completions", "client_id, cardio_target_id, completed_date", "idx_cardio_completions_target_date"],
    ["nf_submissions", "fillout_submission_id", "nf_submissions_fillout_submission_id_uniq"],
    ["client_crm_activities", "client_id, dedupe_key", "uq_client_crm_activities_dedupe"],
    ["featured_member_items", "resource_id", "featured_member_items_resource_unique"],
  ])("%s gets a plain unique index and the partial one is dropped", (table, cols, oldIndex) => {
    expect(migration).toMatch(new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS \\w+\\s+ON public\\.${table} \\(${cols}\\);`));
    expect(migration).toContain(`DROP INDEX IF EXISTS public.${oldIndex};`);
  });
  it("never creates a partial index", () => {
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX[^;]*\bWHERE\b/i);
  });
});

describe("cardio card never reports success for a failed save", () => {
  it("every write throws on a database error (the client returns { error } instead of throwing)", () => {
    // 3 upserts (log, skip, details) + 1 delete (reset)
    expect(card.match(/^\s*\.throwOnError\(\);/gm)?.length).toBe(4);
    expect(card.match(/onConflict: "client_id,cardio_target_id,completed_date" \}\)\s*\.throwOnError\(\)/g)?.length).toBe(3);
  });
  it("shows an honest failure message instead of the raw database error", () => {
    expect(card).toContain("Couldn't save your cardio");
    expect(card).not.toContain('e?.message ?? "Could not save"');
  });
  it("surfaces a failed read so a load error isn't shown as 'Not started'", () => {
    expect(card).toContain("if (error) throw error;");
  });
});
