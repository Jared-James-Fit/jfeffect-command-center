/**
 * Program version history (Nov 24 2026): what changed between two saves, in
 * a coach's words, and putting any part of an older version back into the
 * program as it is now without touching anything else.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlanExercise, ProgramPlan } from "@/lib/program-plan";
import {
  allWeekRefs,
  planChanges,
  prescriptionChange,
  restoreFrom,
  versionHeadline,
  weeksLabel,
} from "@/lib/program-versions";
import { pickDraft } from "@/lib/program-draft-status";
import type { ProgramDraft } from "@/lib/athlete-programs";

const ex = (
  key: string,
  id: string,
  name: string,
  p: Partial<PlanExercise> = {},
): PlanExercise => ({
  key,
  exercise_id: id,
  name,
  sets: 3,
  reps: "5",
  rpe: "7",
  ...p,
});

function plan(weeks = 4): ProgramPlan {
  return {
    v: 1,
    blocks: [
      {
        key: "b1",
        name: "Volume",
        weeks: Array.from({ length: weeks }, (_, i) => ({
          key: `w${i + 1}`,
          days: [
            {
              key: "d1",
              title: "Lower A",
              exercises: [
                ex("e1", "sq", "Competition Squat"),
                ex("e2", "rdl", "Romanian Deadlift", { reps: "8" }),
              ],
            },
            { key: "d2", title: "Upper A", exercises: [ex("e3", "bp", "Competition Bench")] },
          ],
        })),
      },
    ],
  };
}

const clone = (p: ProgramPlan): ProgramPlan => JSON.parse(JSON.stringify(p));

describe("what changed between two versions", () => {
  it("says a prescription change in one week the way a coach writes it", () => {
    const a = plan();
    const b = clone(a);
    b.blocks[0].weeks[2].days[0].exercises[0] = {
      ...b.blocks[0].weeks[2].days[0].exercises[0],
      sets: 4,
      reps: "4",
    };
    const c = planChanges({ title: "P", plan: a }, { title: "P", plan: b });
    expect(c).toHaveLength(1);
    expect(c[0].where).toBe("Week 3 · Lower A");
    expect(c[0].text).toBe("Competition Squat 3 × 5 → 4 × 4");
    expect(c[0].restore).toEqual({
      kind: "exercise",
      weeks: [{ blockKey: "b1", weekKey: "w3" }],
      dayKey: "d1",
      exKey: "e1",
    });
  });

  it("says the same change across weeks once, with its weeks", () => {
    const a = plan();
    const b = clone(a);
    for (const w of b.blocks[0].weeks)
      w.days[1].exercises.push(ex("e9", "row", "Barbell Row", { sets: 3, reps: "10" }));
    const c = planChanges({ title: "P", plan: a }, { title: "P", plan: b });
    expect(c).toHaveLength(1);
    expect(c[0].where).toBe("Weeks 1–4 · Upper A");
    expect(c[0].text).toBe("Added Barbell Row (3 × 10 RPE 7)");
  });

  it("names swaps, removals, renames, length and order", () => {
    const a = plan();
    const b = clone(a);
    b.blocks[0].weeks[0].days[0].exercises[1] = {
      ...b.blocks[0].weeks[0].days[0].exercises[1],
      exercise_id: "gm",
      name: "Good Morning",
    };
    b.blocks[0].weeks[1].days[1].exercises = [];
    b.blocks[0].weeks[3].days[0].exercises.reverse();
    b.blocks[0].weeks.push({ key: "w5", days: clone(a).blocks[0].weeks[0].days });
    const nameOf = (id: string) => ({ rdl: "Romanian Deadlift", gm: "Good Morning" })[id] ?? null;
    const texts = planChanges({ title: "Old", plan: a }, { title: "New", plan: b }, nameOf).map(
      (c) => `${c.where}: ${c.text}`,
    );
    expect(texts).toContain('Program: Renamed to "New"');
    expect(texts).toContain("Program: Length 4 → 5 weeks");
    expect(texts).toContain("Week 1 · Lower A: Romanian Deadlift swapped for Good Morning");
    expect(texts).toContain("Week 2 · Upper A: Removed Competition Bench");
    expect(texts).toContain("Week 4 · Lower A: Exercise order changed");
  });

  it("finds nothing when nothing changed", () => {
    expect(planChanges({ title: "P", plan: plan() }, { title: "P", plan: plan() })).toEqual([]);
  });

  it("only the parts that changed are said", () => {
    const a = ex("k", "x", "Bench", { rpe: "7", rest_seconds: 120 });
    expect(prescriptionChange(a, { ...a, rpe: "8" })).toBe("RPE 7 → RPE 8");
    expect(prescriptionChange(a, { ...a, notes: "pause" })).toBe("note added");
    expect(prescriptionChange(a, a)).toBeNull();
  });

  it("reads weeks like a person", () => {
    expect(weeksLabel([3])).toBe("Week 3");
    expect(weeksLabel([1, 2, 3, 4])).toBe("Weeks 1–4");
    expect(weeksLabel([2, 5, 9])).toBe("Weeks 2, 5 and 9");
  });
});

describe("restoring part of an older version", () => {
  const old = plan();
  const now = (() => {
    const p = clone(old);
    p.blocks[0].weeks[0].days[0].exercises[0].sets = 5; // week 1 changed
    p.blocks[0].weeks[1].days[0].exercises[0].sets = 6; // week 2 changed
    p.blocks[0].weeks[1].days[1].title = "Push"; // week 2's other day renamed
    p.blocks[0].weeks[2].days.push({
      key: "d3",
      title: "Arms",
      exercises: [ex("e7", "curl", "Curl")],
    }); // week 3 gained a day
    return p;
  })();

  it("one exercise in one week, and nothing else", () => {
    const out = restoreFrom(now, old, {
      kind: "exercise",
      weeks: [{ blockKey: "b1", weekKey: "w1" }],
      dayKey: "d1",
      exKey: "e1",
    });
    expect(out.blocks[0].weeks[0].days[0].exercises[0].sets).toBe(3);
    expect(out.blocks[0].weeks[1].days[0].exercises[0].sets).toBe(6);
    expect(out.blocks[0].weeks[1].days[1].title).toBe("Push");
  });

  it("a week", () => {
    const out = restoreFrom(now, old, { kind: "week", blockKey: "b1", weekKey: "w2" });
    expect(out.blocks[0].weeks[1]).toEqual(old.blocks[0].weeks[1]);
    expect(out.blocks[0].weeks[0].days[0].exercises[0].sets).toBe(5);
  });

  it("a day added since is taken out when that day is restored", () => {
    const out = restoreFrom(now, old, { kind: "day", weeks: allWeekRefs(now), dayKey: "d3" });
    expect(out.blocks[0].weeks[2].days.map((d) => d.key)).toEqual(["d1", "d2"]);
  });

  it("a day removed since comes back in its place", () => {
    const later = clone(old);
    later.blocks[0].weeks[0].days.splice(0, 1);
    const out = restoreFrom(later, old, {
      kind: "day",
      weeks: [{ blockKey: "b1", weekKey: "w1" }],
      dayKey: "d1",
    });
    expect(out.blocks[0].weeks[0].days.map((d) => d.key)).toEqual(["d1", "d2"]);
  });

  it("an exercise of a set group comes back with its whole group", () => {
    const withGroup = clone(old);
    withGroup.blocks[0].weeks[0].days[0].exercises = [
      ex("t", "sq", "Squat", { role: "top", group: "g1", sets: 1 }),
      ex("bo", "sq", "Squat", { role: "backoff", group: "g1", pct: 90, pct_of: "top_set" }),
    ];
    const removed = clone(withGroup);
    removed.blocks[0].weeks[0].days[0].exercises = [];
    const out = restoreFrom(removed, withGroup, {
      kind: "exercise",
      weeks: [{ blockKey: "b1", weekKey: "w1" }],
      dayKey: "d1",
      exKey: "t",
    });
    expect(out.blocks[0].weeks[0].days[0].exercises.map((e) => e.key)).toEqual(["t", "bo"]);
  });

  it("the whole program", () => {
    expect(restoreFrom(now, old, { kind: "program" })).toBe(old);
  });

  it("never changes the plan it was given", () => {
    const before = JSON.stringify(now);
    restoreFrom(now, old, { kind: "week", blockKey: "b1", weekKey: "w1" });
    expect(JSON.stringify(now)).toBe(before);
  });
});

describe("version words", () => {
  it("says what made a version", () => {
    expect(versionHeadline({ source: "restore", restored_from: 3, label: null })).toBe(
      "Restored version 3",
    );
    expect(versionHeadline({ source: "import", restored_from: null, label: null })).toBe(
      "Imported",
    );
  });
});

describe("picking the draft to come back to", () => {
  const base: ProgramDraft = {
    id: "p",
    title: "Prog",
    description: "",
    goal: null,
    level: null,
    plan: plan(),
  };
  const edited: ProgramDraft = { ...base, title: "Prog edited" };
  const same = (a: ProgramDraft, b: ProgramDraft) => a.title === b.title;

  it("takes the newer of the device's and the server's copy", () => {
    const newer = { ...base, title: "From the computer" };
    const out = pickDraft({
      initial: base,
      base: "t1",
      local: { draft: edited, at: 1000 },
      remote: { draft: newer, base: "t1", updated_at: new Date(5000).toISOString() },
      same,
    });
    expect(out?.title).toBe("From the computer");
  });

  it("never brings back a draft made from an older save, or one that says nothing new", () => {
    expect(
      pickDraft({
        initial: base,
        base: "t2",
        local: null,
        remote: { draft: edited, base: "t1", updated_at: "2026-01-01" },
        same,
      }),
    ).toBeNull();
    expect(
      pickDraft({ initial: base, base: "t1", local: { draft: base, at: 1 }, remote: null, same }),
    ).toBeNull();
  });
});

describe("the database keeps every save", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20270523090000_program_drafts_versions.sql"),
    "utf8",
  );
  it("writes versions by trigger, folds bursts, never trims a named one", () => {
    expect(sql).toMatch(/CREATE TRIGGER athlete_program_keep_version/);
    expect(sql).toMatch(/interval '3 minutes'/);
    expect(sql).toMatch(/label IS NULL AND version_no > 1/);
  });
  it("keeps drafts to their owner and versions to the program's owner", () => {
    expect(sql).toMatch(
      /CREATE POLICY "Own program drafts read"[\s\S]*user_id = \(SELECT auth\.uid\(\)\)/,
    );
    expect(sql).toMatch(/program_id IN \(SELECT public\.my_athlete_program_ids\(\)\)/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE)[^;]*athlete_program_versions TO authenticated/);
  });
});

describe("a coach template's versions (Nov 24 2026)", () => {
  const payload = (sets: number, extra = false) => ({
    schema_version: 2,
    blocks: [
      {
        id: "blkA",
        name: "Strength",
        phase: null,
        notes: "",
        order_index: 0,
        archived: false,
        archived_at: null,
        deleted_at: null,
        estimated_minutes: null,
        weeks: [1, 2, 3].map((n) => ({
          week_index: n,
          days: [
            {
              day_index: 1,
              title: "Day 1 — Lower",
              rows: [
                { exercise_id: "sq", sets: n === 2 ? sets : 3, reps_text: "5", rpe: "8" },
                ...(extra ? [{ exercise_id: "rdl", sets: 3, reps_text: "8", rpe: "7" }] : []),
              ],
            },
          ],
        })),
      },
    ],
  });
  const nameOf = (id: string) => ({ sq: "Back Squat", rdl: "Romanian Deadlift" })[id] ?? null;

  it("says a change and an addition the way a coach would", async () => {
    const { templateChanges } = await import("@/lib/template-versions");
    const c = templateChanges(payload(3), payload(4, true), nameOf).map((x) => `${x.where}: ${x.text}`);
    expect(c).toContain("Week 2 · Day 1 Lower: Back Squat 3 × 5 RPE 8 → 4 × 5 RPE 8");
    expect(c).toContain("Weeks 1–3 · Day 1 Lower: Added Romanian Deadlift (3 × 8 RPE 7)");
  });

  it("puts one week back and leaves the rest", async () => {
    const { restoreTemplatePart } = await import("@/lib/template-versions");
    const out = restoreTemplatePart(payload(5, true), payload(3), { kind: "week", blockId: "blkA", weekIndex: 2 })!;
    const weeks = out.blocks[0].weeks;
    expect(weeks[1].days[0].rows).toHaveLength(1);
    expect(weeks[1].days[0].rows[0].sets).toBe(3);
    expect(weeks[0].days[0].rows).toHaveLength(2);
  });
});
