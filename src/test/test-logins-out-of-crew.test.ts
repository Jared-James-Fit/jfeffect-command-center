import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20270203090000_test_logins_out_of_crew.sql", "utf8");

describe("test logins never show to the crew", () => {
  it("a test login is one on a reserved test domain, read from the login itself", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_test_login(_uid uuid)");
    expect(sql).toContain("IN ('example.com', 'example.org', 'example.net')");
    expect(sql).toContain("'\\.(test|example|invalid|localhost)$'");
    // only the database's own functions ask it
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.is_test_login(uuid) FROM public, anon, authenticated;");
  });

  it("they're out of the crew's one directory (Find athletes, suggestions, the @ picker)", () => {
    const dir = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.community_member_directory()"));
    expect(dir).toContain("AND NOT public.is_test_login(m.user_id)");
    // the rest of the live definition is kept as it was
    expect(dir).toContain("AND coalesce(c.status, '') <> 'Archived' AND coalesce(c.portal_access_disabled, false) = false");
    expect(dir).toContain("l.same_person_as IS NOT NULL");
  });

  it("and their views never count on anyone's post", () => {
    expect(sql).toContain("BEFORE INSERT ON public.community_post_views");
    expect(sql).toMatch(/IF public\.is_test_login\(NEW\.viewer_user_id\) THEN\s+RETURN NULL;/);
  });
});
