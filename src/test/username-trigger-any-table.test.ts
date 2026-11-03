/**
 * The Crew username trigger runs on clients and user_roles. It must never
 * read NEW.role directly: clients has no role column, and PL/pgSQL resolves
 * every field before evaluating the OR, so every new client and member failed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../supabase/migrations/20270117100000_username_trigger_any_table.sql", import.meta.url),
  "utf8",
);

describe("community_username_on_member", () => {
  it("reads the role through to_jsonb, never NEW.role", () => {
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(body).toContain("(to_jsonb(NEW) ->> 'role') IN ('admin', 'coach')");
    expect(body).not.toMatch(/NEW\.role/);
  });

  it("never blocks the write that added the person", () => {
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN NULL;");
  });
});
