import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261006170000_full_unique_indexes_for_upserts.sql", "utf8");
const appointments = readFileSync("src/lib/appointments.functions.ts", "utf8");

describe("upserts need a full unique index (Postgres can't infer a partial one)", () => {
  it.each([
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
  it("the new index is created before the old one is dropped", () => {
    for (const old of ["nf_submissions_fillout_submission_id_uniq", "uq_client_crm_activities_dedupe", "featured_member_items_resource_unique"]) {
      expect(migration.indexOf("CREATE UNIQUE INDEX")).toBeLessThan(migration.indexOf(`DROP INDEX IF EXISTS public.${old}`));
    }
  });
});

describe("appointment CRM activity", () => {
  it("logs a failed write instead of dropping it (best-effort, but never silent)", () => {
    expect(appointments).toContain("const { error: crmErr } = await supabaseAdmin.from(\"client_crm_activities\").upsert(");
    expect(appointments).toContain('console.error("[appointments] CRM activity write failed", crmErr)');
  });
});
