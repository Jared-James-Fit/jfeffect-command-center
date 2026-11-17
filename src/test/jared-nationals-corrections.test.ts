import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCK_RENAMES,
  CORRECTIVE_MIGRATION,
  correctiveSql,
  NEW_TEMPLATE_NOTES,
  OFF_SEASON_BLOCKS,
  OFF_SEASON_PREP_ID,
  OPTIONAL_ROW_COUNT,
  OPTIONAL_ROWS,
  TEXT_FIXES,
} from "@/lib/jared-nationals/corrective";
import { PREP_ID } from "@/lib/jared-nationals/program";
import { buildProgramRoadmap } from "@/lib/training-roadmap";

describe("Jared's Nationals prep: the Nov 17 corrections", () => {
  it("the committed migration is exactly what the definitions write", () => {
    expect(readFileSync(CORRECTIVE_MIGRATION, "utf8")).toBe(correctiveSql());
  });

  it("marks every optional row the program has, Tuesday's paused pull first", () => {
    expect(OPTIONAL_ROW_COUNT).toBe(29);
    const w1Tue = OPTIONAL_ROWS.filter((o) => o.week === 1 && o.dayIndex === 2);
    expect(w1Tue.map((o) => o.role)).toContain("Deadlift Technique (optional)");
    // W1–3 and W5–7: the paused conventional pull is optional every week it's programmed
    expect(OPTIONAL_ROWS.filter((o) => o.role === "Deadlift Technique (optional)").map((o) => o.week)).toEqual([1, 2, 3, 5, 6, 7]);
    // finds each row by place, never by its wording
    expect(correctiveSql()).not.toMatch(/notes LIKE 'Optional\. %' AND NOT r\.is_optional/);
  });

  it("numbers the Nationals blocks 1–4 and keeps the off-season as its own program", () => {
    expect(BLOCK_RENAMES.map((b) => b.to)).toEqual([
      "Block 1 — Nationals Base",
      "Block 2 — Nationals Strength",
      "Block 3 — Nationals Peak",
      "Block 4 — Nationals Taper",
    ]);
    expect(OFF_SEASON_BLOCKS).toHaveLength(2);
    const sql = correctiveSql();
    const data = sql.slice(sql.indexOf("DO $jc$"));
    // nothing deleted (the meet-day function's DELETE is its own temp table), logged training untouched
    expect(data).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/pl_row_results|pl_day_completions\s+SET/);
  });

  it("calls 14 / 11 / 9 days out what they are, placeholders", () => {
    for (const f of [TEXT_FIXES.w11Notes, TEXT_FIXES.w11Summary, TEXT_FIXES.peakGoal]) {
      expect(f.to).not.toBe(f.from);
      expect(f.to).toMatch(/placeholder|once the lifting day is confirmed|until the lifting day is confirmed/i);
    }
    expect(NEW_TEMPLATE_NOTES).toMatch(/bench recovers fastest/);
    expect(NEW_TEMPLATE_NOTES).toMatch(/never rewrite Weeks 1–10/);
    expect(NEW_TEMPLATE_NOTES).toMatch(/never from the 270 kg sumo meet pull/);
  });

  it("backs everything up first and runs once", () => {
    const sql = correctiveSql();
    const doBlock = sql.slice(sql.indexOf("DO $jc$"));
    const backup = doBlock.indexOf("backup of everything this changes");
    expect(backup).toBeGreaterThan(0);
    for (const step of ["UPDATE public.pl_exercise_rows", "UPDATE public.pl_blocks SET prep_id", "UPDATE public.pl_templates"]) {
      expect(doBlock.indexOf(step)).toBeGreaterThan(backup);
    }
    expect(doBlock).toMatch(/already applied/);
  });

  it("the Nationals prep reads Week 1 of 12 on Nov 17, the off-season as its own finished program", () => {
    const blocks = [
      { id: OFF_SEASON_BLOCKS[0].id, name: OFF_SEASON_BLOCKS[0].name, start_date: "2026-09-27", end_date: "2026-10-31", weeks: 5, status: "Completed", prep_id: OFF_SEASON_PREP_ID, sort_order: 0 },
      { id: OFF_SEASON_BLOCKS[1].id, name: OFF_SEASON_BLOCKS[1].name, start_date: "2026-11-01", end_date: "2026-11-14", weeks: 2, status: "Completed", prep_id: OFF_SEASON_PREP_ID, sort_order: 1 },
      ...BLOCK_RENAMES.map((b, i) => {
        const starts = ["2026-11-15", "2026-12-13", "2027-01-10", "2027-01-31"];
        const ends = ["2026-12-12", "2027-01-09", "2027-01-30", "2027-02-06"];
        const weeks = [4, 4, 3, 1];
        return { id: b.id, name: b.to, start_date: starts[i], end_date: ends[i], weeks: weeks[i], status: i === 0 ? "Active" : "Draft", prep_id: PREP_ID, sort_order: i };
      }),
    ];
    const weeks = blocks.flatMap((b) =>
      Array.from({ length: b.weeks }, (_, k) => ({ id: `${b.id}-w${k + 1}`, block_id: b.id, week_index: k + 1 })),
    );
    const rm = buildProgramRoadmap({
      blocks,
      weeks,
      notes: [],
      preps: [
        { id: PREP_ID, title: "Jared McIntyre — 2027 Canadian Nationals Prep", status: "Active", event_name: "2027 Canada Powerlifting National Championships", event_date: "2027-02-08", event_end_date: "2027-02-13", event_day_tbd: true },
        { id: OFF_SEASON_PREP_ID, title: "Jared McIntyre — Off-Season Development", status: "Completed" },
      ],
      today: "2026-11-17",
      ownerName: "Jared McIntyre",
    })!;
    expect(rm.program.title).toBe("2027 Canadian Nationals Prep");
    expect(rm.programWeek).toBe(1);
    expect(rm.totalWeeks).toBe(12);
    expect(rm.blocks).toHaveLength(4);
    const off = rm.programs.find((p) => p.id === `prep:${OFF_SEASON_PREP_ID}`)!;
    expect(off.status).toBe("completed");
    expect(off.totalWeeks).toBe(7);
  });
});
