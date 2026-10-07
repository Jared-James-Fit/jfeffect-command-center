import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261008160000_fix_member_self_profile_saves.sql",
  "utf8",
);
const types = readFileSync("src/integrations/supabase/types.ts", "utf8");

/** Column names of a table's Row type in the generated Supabase types. */
function rowColumns(table: string): Set<string> {
  const start = types.indexOf(`      ${table}: {\n        Row: {`);
  const end = types.indexOf("        }", start + 1);
  const block = types.slice(start, end);
  return new Set([...block.matchAll(/^ {10}(\w+):/gm)].map((m) => m[1]));
}

describe("member self-update guards", () => {
  it("only reference columns app_members really has (a missing one breaks every member save)", () => {
    const cols = rowColumns("app_members");
    expect(cols.size).toBeGreaterThan(50);
    const referenced = new Set([...migration.matchAll(/\b(?:NEW|OLD)\.(\w+)/g)].map((m) => m[1]));
    const missing = [...referenced].filter((c) => !cols.has(c));
    expect(missing).toEqual([]);
  });

  it("still lock billing and access fields for the member themself", () => {
    for (const col of [
      "subscription_status",
      "stripe_price_id",
      "access_end_date",
      "trial_end_at",
      "manual_access_override",
      "user_id",
    ]) {
      expect(migration).toContain(`NEW.${col}`);
    }
  });

  it("let the macro calculator save its profile fields, nothing billing-related", () => {
    expect(migration).toContain(
      "GRANT UPDATE (height_cm, biological_sex, activity_level, units_preference)\n  ON public.app_members TO authenticated;",
    );
  });
});
