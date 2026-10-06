import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261006150000_rls_exercise_rows_set_based.sql", "utf8");
const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));

describe("pl_exercise_rows RLS stays tight while getting fast", () => {
  it("both helpers are SECURITY DEFINER with a pinned search_path", () => {
    for (const fn of ["client_visible_pl_day_ids", "coach_manageable_pl_day_ids"]) {
      const def = body.slice(body.indexOf(`FUNCTION public.${fn}()`), body.indexOf("$$;", body.indexOf(`FUNCTION public.${fn}()`)));
      expect(def).toContain("SECURITY DEFINER");
      expect(def).toContain("SET search_path = public");
      expect(def).toContain("auth.uid()");
    }
  });
  it("helpers are not callable by anon / public", () => {
    expect(body).toContain("REVOKE ALL ON FUNCTION public.client_visible_pl_day_ids() FROM PUBLIC, anon;");
    expect(body).toContain("REVOKE ALL ON FUNCTION public.coach_manageable_pl_day_ids() FROM PUBLIC, anon;");
    expect(body).not.toMatch(/GRANT EXECUTE[^;]*\banon\b/);
  });
  it("client rule is still read-only and still requires client_visible", () => {
    expect(body).toMatch(/FOR SELECT TO authenticated\s+USING \(day_id IN \(SELECT public\.client_visible_pl_day_ids\(\)\)\)/);
    expect(body).toContain("b.client_visible AND c.user_id = auth.uid()");
  });
  it("coach rule covers reads AND writes, and mirrors is_assigned_coach", () => {
    expect(body).toMatch(/FOR ALL TO authenticated\s+USING \(day_id IN \(SELECT public\.coach_manageable_pl_day_ids\(\)\)\)\s+WITH CHECK \(day_id IN \(SELECT public\.coach_manageable_pl_day_ids\(\)\)\)/);
    expect(body).toContain("co.archived = false AND co.status = 'Active'");
  });
  it("leaves the admin rule alone and documents a rollback", () => {
    expect(body).not.toContain("Admin manage pl_exercise_rows");
    expect(sql).toContain("-- Rollback (restores the previous rules verbatim):");
  });
});
