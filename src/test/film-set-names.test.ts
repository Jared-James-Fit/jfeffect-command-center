// Set videos and workout film name every set the way the workout does
// ("Top set", "Backoff 2", "Set 3"), with no emoji, and a film post's own
// caption is the best set of each main lift (Nov 13 2026: Jared's paused
// bench top set and first backoff both read "Set 1", under "Thursday — …
// · 9 sets on film 🎥").
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20270311090000_film_set_names.sql", "utf8");
const code = (s: string) => s.replace(/^\s*--.*$/gm, "");

describe("every set by its name in the workout (pl_day_set_names)", () => {
  it("a row the coach calls a backoff (label or notes) is one, and what comes before it of the same exercise is the top set", () => {
    expect(sql).toContain("WHEN coalesce(r.purpose_label, '') ~* 'back\\s*-?\\s*off' OR coalesce(r.notes, '') ~* '^\\s*back\\s*-?\\s*offs?\\M' THEN 'backoff'");
    expect(sql).toContain("WHEN g2.first_backoff IS NOT NULL AND g2.sort_order < g2.first_backoff THEN 'top'");
  });
  it("with nothing said, a 1-set row and one more row of the same lift are a top set and backoffs, unless the second was heavier", () => {
    expect(sql).toContain("WHEN g2.said_in = 0 AND g2.rows_in = 2 AND g2.planned1 = 1");
    expect(sql).toContain("AND NOT (g2.kg1 IS NOT NULL AND g2.kg2 IS NOT NULL AND g2.kg2 > g2.kg1)");
  });
  it("numbers run across the rows of one exercise, so nothing reads \"Set 1\" twice", () => {
    expect(sql).toContain("WHEN 'top' THEN CASE WHEN n.of_k = 1 THEN 'Top set' ELSE 'Top set ' || n.k END");
    expect(sql).toContain("WHEN 'backoff' THEN CASE WHEN n.of_k = 1 THEN 'Backoff' ELSE 'Backoff ' || n.k END");
    expect(sql).toContain("ELSE 'Set ' || n.k");
  });
  it("is the server's only (no one else can call it)", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.pl_day_set_names(uuid) FROM PUBLIC, anon, authenticated;");
  });
});

describe("the coach chat", () => {
  it("says the set's name, never with an emoji", () => {
    expect(sql).toContain("v_body := left(v_ex || ' · ' || v_name || coalesce(' · ' || nullif(v_label, ''), ''), 200);");
    expect(sql).toContain("SET body = left(v_ex || ' · ' || v_name || coalesce(' · ' || nullif(v_label, ''), ''), 200),");
    // no emoji anywhere the migration writes (only in what it reads and the comments)
    const written = code(sql).split("\n").filter((l) => l.includes("🎥"));
    expect(written).toEqual([expect.stringContaining("sets? on film 🎥$'")]);
  });
  it("messages already sent are relabelled without an \"edited\" copy, and the history trigger comes back on", () => {
    expect(sql).toContain("ALTER TABLE public.messages DISABLE TRIGGER messages_keep_history;");
    expect(sql.trim().endsWith("ALTER TABLE public.messages ENABLE TRIGGER messages_keep_history;")).toBe(true);
  });
});

describe("the film post's own caption (film_caption)", () => {
  it("is the best set of each main lift filmed, at most three, else of the first two exercises", () => {
    expect(sql).toContain("ORDER BY s.ex, s.kg DESC NULLS LAST, s.ord");
    expect(sql).toContain("WHERE p.rn <= CASE WHEN EXISTS (SELECT 1 FROM ex WHERE ex.main) THEN 3 ELSE 2 END");
    expect(sql).toContain("' · ' ORDER BY p.first_ord), '')");
  });
  it("names only on a post that hides weights, and follows the switch while it's still ours", () => {
    expect(sql).toContain("CASE WHEN coalesce(_hide, false) OR b.work = '' THEN p.ex ELSE p.ex || ' ' || b.work END");
    expect(sql).toContain("BEFORE UPDATE OF hide_loads ON public.community_posts");
    expect(sql).toContain("IF v_was <> '' AND coalesce(NEW.caption, '') = v_was THEN");
  });
  it("a move keeps it in step only while it's still the one the film wrote", () => {
    expect(sql).toContain("caption = CASE WHEN m.caption IS NOT DISTINCT FROM public.film_caption(m.old_film, m.hide)");
  });
  it("the move's toast names the set the same way", () => {
    expect(readFileSync("src/components/workout-day/set-video-move.tsx", "utf8")).toContain("${res.set_name || `Set ${set.n}`}");
  });
});
