import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildProgramRoadmap,
  digestBlock,
  noteText,
  parseRoadmapReply,
  weekStats,
  type DigestRow,
} from "@/lib/training-roadmap";

const squat = { name: "Back Squat", is_competition_lift: true };
const curl = { name: "DB Curl", is_competition_lift: false, primary_muscle_group: "biceps" };

function block(weeks: number) {
  const ws = Array.from({ length: weeks }, (_, i) => ({ id: `w${i + 1}`, week_index: i + 1 }));
  const days = ws.map((w) => ({ id: `d${w.week_index}`, week_id: w.id, day_index: 1, title: "Lower" }));
  const rows: DigestRow[] = ws.flatMap((w) => [
    { day_id: `d${w.week_index}`, sort_order: 1, sets: 3 + w.week_index, reps_text: "5", rpe: String(6 + w.week_index), exercise: squat },
    { day_id: `d${w.week_index}`, sort_order: 2, sets: 3, reps_text: "10-12", rir: "2", exercise: curl },
  ]);
  return {
    block: { id: "b1", name: "Block 1", start_date: "2026-01-05", end_date: null, weeks },
    weeks: ws,
    days,
    rows,
  };
}

describe("training roadmap notes", () => {
  it("shows the coach's wording over Cleo's, field by field, and nothing when hidden", () => {
    const n = { block_id: "b", week_id: null, ai_label: "Hypertrophy", ai_summary: "Cleo says", coach_label: " ", coach_summary: "Coach says" };
    expect(noteText(n)).toEqual({ label: "Hypertrophy", summary: "Coach says", byCoach: true });
    expect(noteText({ ...n, coach_summary: null })).toEqual({ label: "Hypertrophy", summary: "Cleo says", byCoach: false });
    expect(noteText({ ...n, hidden: true })).toEqual({ label: null, summary: null, byCoach: false });
  });
});

describe("Cleo's digest of a block", () => {
  it("counts sets, competition-lift sets, effort and rep range per week", () => {
    const b = block(2);
    const s = weekStats([b.days[1]], b.rows);
    expect(s).toMatchObject({ days: 1, exercises: 2, sets: 8, compSets: 5, rpeMax: 8, repsMin: 5, repsMax: 12 });
  });

  it("hashes only the training: dates moving don't trigger a rewrite, a changed set does", () => {
    const a = digestBlock(block(3));
    const moved = digestBlock({ ...block(3), block: { ...block(3).block, start_date: "2026-03-02" } });
    expect(moved.hash).toBe(a.hash);
    const b = block(3);
    b.rows[0] = { ...b.rows[0], sets: 9 };
    expect(digestBlock(b).hash).not.toBe(a.hash);
    expect(a.hasTraining).toBe(true);
    expect(a.weekIndexes).toEqual([1, 2, 3]);
    expect(a.text).toContain("Back Squat (comp lift): 4x5 @RPE 7");
    expect(a.text).toContain("Week 2 (2026-01-12 to 2026-01-18)");
  });

  it("says where the meet falls relative to the block", () => {
    const d = digestBlock({ ...block(4), context: { meet: { name: "Nationals", date: "2026-02-14" } } });
    expect(d.text).toContain("Competition: Nationals on 2026-02-14 (2 weeks after this block ends).");
  });

  it("flags an empty block so Cleo describes nothing", () => {
    expect(digestBlock({ ...block(2), rows: [] }).hasTraining).toBe(false);
  });
});

describe("Cleo's reply", () => {
  it("keeps only the block's real weeks, once each, and trims long text", () => {
    const reply = `Here you go: {"style":"Meet Prep","label":"Peak","purpose":"${"x".repeat(400)}","weeks":[{"week":1,"label":"Heavy singles","focus":"Top single at RPE 8 — then back-offs."},{"week":1,"label":"dup","focus":"dup"},{"week":7,"label":"Ghost","focus":"not a week"}]}`;
    const r = parseRoadmapReply(reply, [1, 2]);
    expect(r?.style).toBe("meet_prep");
    expect(r?.purpose.length).toBeLessThanOrEqual(260);
    expect(r?.weeks).toEqual([{ week: 1, label: "Heavy singles", focus: "Top single at RPE 8, then back-offs." }]);
  });

  it("rejects replies that aren't usable", () => {
    expect(parseRoadmapReply("no json here", [1])).toBeNull();
    expect(parseRoadmapReply('{"style":"strength","label":"","purpose":"","weeks":[]}', [1])).toBeNull();
    expect(parseRoadmapReply('{"style":"yoga","label":"Base","purpose":"Builds work capacity.","weeks":[]}', [1])?.style).toBe("general_fitness");
  });
});

describe("program roadmap", () => {
  const blocks = [
    { id: "a", name: "Hypertrophy", start_date: "2026-01-05", end_date: "2026-02-01", weeks: 4, prep_id: "p" },
    { id: "b", name: "Strength", start_date: "2026-02-02", end_date: "2026-03-01", weeks: 4, prep_id: "p" },
    { id: "c", name: "Peak", start_date: "2026-03-02", end_date: "2026-03-15", weeks: 2, prep_id: "p" },
    // A program from last year: a separate program, not part of this one.
    { id: "old", name: "Old block", start_date: "2025-01-06", end_date: "2025-02-02", weeks: 4 },
  ];
  const weeks = blocks.flatMap((b) => Array.from({ length: b.weeks }, (_, i) => ({ id: `${b.id}${i + 1}`, block_id: b.id, week_index: i + 1 })));

  it("places today in the program: block, week of total, statuses, meet countdown", () => {
    const r = buildProgramRoadmap({
      blocks,
      weeks,
      notes: [
        { block_id: "b", week_id: null, ai_label: "Strength Base", ai_summary: "Heavier triples and doubles." },
        { block_id: "b", week_id: "b2", ai_label: "Volume build", ai_summary: "More top sets.", coach_label: "Big week" },
      ],
      preps: [{ id: "p", event_name: "Nationals", event_date: "2026-03-14" }],
      today: "2026-02-10",
    });
    expect(r.blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(r.blocks.map((b) => b.status)).toEqual(["completed", "current", "upcoming"]);
    expect(r.currentBlockId).toBe("b");
    expect(r.programWeek).toBe(6);
    expect(r.totalWeeks).toBe(10);
    expect(r.meet).toEqual({ name: "Nationals", date: "2026-03-14", daysOut: 32 });
    const b = r.byBlock.b;
    expect(b.label).toBe("Strength Base");
    expect(b.weeks.map((w) => w.status)).toEqual(["completed", "current", "upcoming", "upcoming"]);
    expect(b.weeks[1]).toMatchObject({ label: "Big week", focus: "More top sets." });
    expect(r.byBlock.old.status).toBe("completed");
  });

  it("between programs, shows the next one that hasn't started", () => {
    const r = buildProgramRoadmap({ blocks, weeks, notes: [], today: "2025-12-20" });
    expect(r.blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(r.programWeek).toBeNull();
    expect(r.currentBlockId).toBe("a");
  });
});

describe("roadmap wiring", () => {
  const sql = readFileSync("supabase/migrations/20261106090000_training_roadmap.sql", "utf8");

  it("athletes never read hidden notes, and every program change queues the block", () => {
    expect(sql).toMatch(/Client read own pl_roadmap_notes[\s\S]*not hidden/);
    expect(sql).toMatch(/Linked login reads own pl_roadmap_notes[\s\S]*not hidden/);
    for (const t of ["pl_weeks", "pl_days", "pl_exercise_rows"]) {
      for (const op of ["insert", "update", "delete"]) {
        expect(sql).toMatch(new RegExp(`after ${op} on public\\.${t}`));
      }
    }
    expect(sql).toMatch(/after insert or update of name[^;]*on public\.pl_blocks/);
  });

  it("Cleo only ever writes her own columns", () => {
    const server = readFileSync("src/lib/training-roadmap.server.ts", "utf8");
    expect(server).not.toMatch(/coach_label|coach_summary/);
    expect(server).not.toMatch(/from\("pl_(blocks|weeks|days|exercise_rows)"\)\s*\.(update|insert|delete|upsert)/);
  });
});

describe("Cleo's wording rules", () => {
  it("speaks in prescriptions, not week totals, and backup blocks are skipped", async () => {
    const { ROADMAP_SYSTEM_PROMPT } = await import("@/lib/training-roadmap");
    expect(ROADMAP_SYSTEM_PROMPT).toMatch(/Never quote the week's totals or averages/);
    const server = readFileSync("src/lib/training-roadmap.server.ts", "utf8");
    expect(server).toMatch(/isAtHomeBackupSessionBlock\(loaded\.block\)/);
  });
});
