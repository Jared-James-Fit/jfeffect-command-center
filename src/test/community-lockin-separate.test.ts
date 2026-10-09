import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const migration = read("supabase/migrations/20261026090000_community_lockin_separate_post.sql");
const queries = read("src/lib/community.queries.ts");

describe("a lock-in and the finished-workout share are separate posts", () => {
  it("allows one post per slot (lock-in / finish) instead of one per session", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS community_posts_one_per_completion");
    expect(migration).toContain("ON public.community_posts (completion_id, (locked_in_at IS NOT NULL))");
    expect(migration).toContain("ON CONFLICT (completion_id, (locked_in_at IS NOT NULL)) DO UPDATE");
  });

  it("saves to the lock-in slot only when asked or while the session is open", () => {
    expect(migration).toContain("v_lock := coalesce(_lock_in, false) OR NOT v_done;");
    expect(migration).toContain("CASE WHEN v_lock THEN now() ELSE NULL END");
    // the old 11-arg overload is dropped so calls are never ambiguous
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.community_save_post(uuid, text, text, text, text, text, text, integer, integer, boolean, jsonb);");
  });

  it("a lock-in that has a finish post shows as the lock-in only (numbers appear once)", () => {
    expect(migration).toContain("'live', n.kind = 'workout' AND pc.completed_at IS NULL AND NOT fin.superseded");
    expect(migration).toContain("'stats', CASE WHEN fin.superseded THEN NULL");
    expect(migration).toContain("IF public.community_lockin_has_finish(_post_id) THEN v_completion := NULL; END IF;");
    expect(migration).toContain("LEFT JOIN public.community_posts p ON p.completion_id = pc.id AND p.locked_in_at IS NULL");
  });

  it("the app loads and saves the right slot, so a finish share never touches the lock-in", () => {
    expect(queries).toContain('q = slot === "lockin" ? q.not("locked_in_at", "is", null) : q.is("locked_in_at", null);');
    expect(queries).toContain("_lock_in: input.lockIn ?? null");
    for (const f of ["src/components/community/lock-in.tsx", "src/components/community/share-workout-picker.tsx"]) {
      const src = read(f);
      expect(src, f).toContain('"lockin")');
      expect(src, f).toContain("lockIn: true");
    }
    expect(read("src/components/community/lock-in-editor.tsx")).toContain("lockIn: true");
  });
});
