import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { COACH_NOTE_MAX, normalizeCoachNote } from "@/lib/session-credit";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("a coach's note on a session", () => {
  it("is saved trimmed and capped, and an empty one removes it", () => {
    expect(normalizeCoachNote("  foot tattoo for colten  ")).toBe("foot tattoo for colten");
    expect(normalizeCoachNote("   ")).toBeNull();
    expect(normalizeCoachNote(null)).toBeNull();
    expect(normalizeCoachNote("x".repeat(COACH_NOTE_MAX + 50))).toHaveLength(COACH_NOTE_MAX);
  });

  it("is only ever read through the coach notes module, which no client screen uses", () => {
    const files = walk("src").filter((f) => !f.includes("integrations/supabase/types") && !f.includes("/test/"));
    const readers = files.filter((f) => readFileSync(f, "utf8").includes("pt_session_coach_notes"));
    expect(readers).toEqual([join("src", "lib", "session-coach-notes.ts")]);
    const users = files.filter((f) => readFileSync(f, "utf8").includes("@/lib/session-coach-notes"));
    expect(users.length).toBeGreaterThan(0);
    for (const f of users) expect(f).not.toMatch(/portal|member|client-session-list|calendar-feed|booking/);
  });

  it("is closed to clients in the database (staff policies only, no anon)", () => {
    const sql = readFileSync("supabase/migrations/20261228090000_pt_session_coach_notes.sql", "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.pt_session_coach_notes FROM anon");
    expect(sql).not.toMatch(/c\.user_id|visible_to_client|TO anon/);
    expect((sql.match(/CREATE POLICY/g) ?? []).length).toBe(2);
  });
});
