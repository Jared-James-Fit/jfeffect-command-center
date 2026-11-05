import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LESSON_ROTATION, LESSON_TRACK, LESSON_TRACKS, lessonTrackFor } from "@/lib/lessons";

const sql = readFileSync("supabase/migrations/20270130090000_lessons_twice_a_week.sql", "utf8");
/** The SQL without its comments. */
const code = sql.replace(/--.*$/gm, "");
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe("lessons twice a week", () => {
  it("only Monday and Thursday, the tracks taking turns week by week", () => {
    const planned = days("2026-11-05", 46)
      .map((d) => [d, lessonTrackFor(d)] as const)
      .filter(([, t]) => t);
    expect(planned).toEqual([
      ["2026-11-05", "truth"],
      ["2026-11-09", "strength"],
      ["2026-11-12", "methods"],
      ["2026-11-16", "hypertrophy"],
      ["2026-11-19", "mind"],
      ["2026-11-23", "fix"],
      ["2026-11-26", "truth"],
      ["2026-11-30", "strength"],
      ["2026-12-03", "methods"],
      ["2026-12-07", "hypertrophy"],
      ["2026-12-10", "mind"],
      ["2026-12-14", "fix"],
      ["2026-12-17", "truth"],
    ]);
    // two a week, every week, and before the anchor too
    for (const from of ["2025-06-02", "2026-11-02", "2027-03-01"]) expect(days(from, 7).filter((d) => lessonTrackFor(d)).length).toBe(2);
    expect(lessonTrackFor("not a day")).toBeNull();
  });

  it("an uncomfortable truth once every three weeks, never the Sunday reset", () => {
    const year = days("2026-11-02", 7 * 12).map(lessonTrackFor);
    expect(year.filter((t) => t === "truth")).toHaveLength(4);
    expect(year).not.toContain("reset");
    expect(LESSON_TRACK.reset.isoDay).toBeNull();
    // each track's day label is the day it's planned on
    for (const t of LESSON_TRACKS.filter((x) => x !== "reset")) {
      const dow = LESSON_TRACK[t].isoDay as 1 | 4;
      expect(LESSON_ROTATION[dow], t).toContain(t);
    }
  });

  it("the database plans the same days and turns", () => {
    expect(sql).toContain("WHEN 1 THEN (ARRAY['strength', 'hypertrophy', 'fix'])[x.w + 1]");
    expect(sql).toContain("WHEN 4 THEN (ARRAY['methods', 'mind', 'truth'])[x.w + 1]");
    expect(sql).toContain("floor((_day - date '2025-12-29')::numeric / 7)::int % 3) + 3) % 3");
    // a fix's level counts the fix days left in the month, not Saturdays
    expect(sql).toContain("WHERE public.community_lesson_track(d::date) = 'fix'");
    expect(sql).not.toMatch(/isodow FROM d\) = 6/);
  });

  it("the coach's clock through local_to_instant / instant_to_local, never a bare AT TIME ZONE", () => {
    expect(code).not.toMatch(/AT TIME ZONE/i);
    expect(sql).toContain("SELECT public.local_to_instant(");
    expect(sql.match(/v_today date := public\.instant_to_local\(now\(\), 'America\/Winnipeg'\)::date;/g)).toHaveLength(3);
  });

  it("lessons already planned move onto the new days in their track's turn, the resets go back to the library", () => {
    expect(sql).toContain("WHERE p.status IN ('planned', 'approved') AND p.day > v_today;");
    expect(sql).toContain("SELECT m.id INTO v_id FROM lesson_moves m WHERE m.new_day IS NULL AND m.track = v_track ORDER BY m.old_day LIMIT 1;");
    expect(sql).toContain("DELETE FROM public.community_lesson_plan p USING lesson_moves m WHERE m.id = p.id AND m.new_day IS NULL;");
    // a Tuesday crew-numbers preview only for a Tuesday lesson
    expect(sql).toContain("WHERE extract(isodow FROM p.day) = 2 AND p.status IN ('planned', 'approved')");
  });
});
