import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The library's movement-family rules live in SQL (so new exercises classify
 * themselves in the database). This test pulls the rules out of the migration
 * itself and runs them in JS, so the committed SQL — not a copy — is what's
 * checked against real exercise names from the library.
 *
 *   squat = yellow, bench = blue, deadlift = green, everything else = red.
 */
const sql = readFileSync("supabase/migrations/20261006160000_movement_family_comp_aiding_rules.sql", "utf8");
const fn = sql.slice(
  sql.indexOf("CREATE OR REPLACE FUNCTION public.exercise_movement_family_for"),
  sql.indexOf("$$;", sql.indexOf("RETURN 'accessory';")),
);

/** `' a|b' || ' c|d'` (possibly in parentheses) -> "a|b" + "c|d" */
function sqlString(expr: string): string {
  return [...expr.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join("");
}

type Rule = { ret: string; conds: Array<{ neg: boolean; re: RegExp }> };
const rules: Rule[] = [];
for (const m of fn.matchAll(/IF\s+(n\s*!?~[\s\S]*?)\s+THEN RETURN '(squat|bench|deadlift)'; END IF;/g)) {
  const cond = m[1];
  const conds = [...cond.matchAll(/n\s*(!?~)\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|'[^']*')/g)].map((c) => ({
    neg: c[1] === "!~",
    re: new RegExp(sqlString(c[2])),
  }));
  rules.push({ ret: m[2], conds });
}

function family(name: string, comp: string | null = null): string {
  if (comp === "squat" || comp === "bench" || comp === "deadlift") return comp;
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (const r of rules) if (r.conds.every((c) => c.re.test(n) !== c.neg)) return r.ret;
  return "accessory";
}

const squat = [
  "High Bar Squat", "Belt Squat", "Landmine Belt Squat", "Safety Squat Bar Squat", "Box Squat", "Barbell Box Squat", "Pin Squat",
  "2-Count Paused Squat", "2-Count Pause Squat", "3-0-0 Tempo Squat", "3-Second Tempo Squat", "Barbell Full Squat(Back)",
  "Barbell Front Squats", "Barbell Low Bar Squat", "Pause Squat",
];
const bench = [
  "Paused Bench Press", "2-Count Pause Bench Press", "3-Count Pause Bench Press", "TNG Bench Press", "Touch and Go Bench Press",
  "Spoto Press 1\"", "Spotto Press 1\"", "Spoto Press", "Larsen Press", "Close-Grip Larsen Press", "Close-Grip Bench Press",
  "Floor Press", "Incline Dumbbell Press", "Incline Bench Press - Dumbbell", "Barbell Bench Press", "Barbell Incline Bench Press",
  "Pin Bench Press", "Slingshot Bench Press", "Dead Bench",
];
const deadlift = [
  "Conventional Deadlift", "3-0-0 Tempo to Knee Sumo Deadlift", "Two-Count Paused Deadlift",
  "Two-Count Paused Conventional Deadlift Below Knee", "Deficit Conventional Deadlift", "Tempo Deadlift", "Barbell Rack Pull",
  "Block Pull Deadlift", "Trap Bar Deadlift", "Snatch-Grip Deadlift", "2-Second Pause-at-Knee Sumo Deadlift", "Barbell Sumo Deadlift",
];
const accessory = [
  // squat-ish
  "Hack Squat", "Pendulum Squat", "Leg Press", "Bulgarian Split Squats", "Goblet Squat", "Dumbbell Front Squat", "Normal Squat Smith Machine",
  "Bodyweight Squat", "Barbell Jump Squat", "Barbell Overhead Squat", "Barbell Full Zercher Squat", "Landmine Squat", "Dumbbell Split Squat",
  "Barbell Split Squat", "Goblet Sumo Squat", "Wall Squat Bodyweight", "Leg Extension - Machine", "Walking Lunges", "Dumbbell Step Up On Bench",
  // bench-ish
  "Flat Bench Press - Dumbbell", "Dumbbell Bench Press", "Chest Press Machine", "Smith Machine Press Incline", "Chest Fly - Machine", "Cable Fly",
  "Pec Deck", "Kneeling Push-Up or Full Push-Up", "Cable Triceps Pushdown", "Paused Dumbbell Floor Press", "Barbell Jm Bench Press",
  "Machine Shoulder Press", "Barbell Shoulder Press", "Svend Press Flat Bench", "Dumbbell Fly Flat Bench", "Lateral Raise Dumbbell - Constant Tension",
  // deadlift-ish: hinges from the top and posterior chain are accessories
  "Romanian Deadlift", "Barbell Romanian Deadlift", "Dumbbell Romanian Deadlift", "Stiff-Leg Deadlift", "Good Mornings", "Lying Hamstring Curl - Machine",
  "45-Degree Back Extension", "Hip Thrust - Barbell", "Bent-Over Barbell Row", "Landmine Row", "Dumbbell Sumo Deadlift", "Barbell Single Leg Deadlift",
  "Trap Bar Shrug", "Barbell Clean Deadlift", "Barbell Deadlift High Pull", "Plate Deadlift", "Chin Ups", "Plank", "EZ Bar Curl",
];

describe("exercise movement family (the colour on a program card)", () => {
  it("found the rules in the migration", () => {
    // belt squat, incline DB press, then the squat / bench / deadlift variation rules
    expect(rules.map((r) => r.ret)).toEqual(["squat", "bench", "squat", "bench", "deadlift"]);
  });
  it.each(squat)("%s is squat (yellow)", (n) => expect(family(n)).toBe("squat"));
  it.each(bench)("%s is bench (blue)", (n) => expect(family(n)).toBe("bench"));
  it.each(deadlift)("%s is deadlift (green)", (n) => expect(family(n)).toBe("deadlift"));
  it.each(accessory)("%s is an accessory (red)", (n) => expect(family(n)).toBe("accessory"));
  it("competition lifts are always their own family", () => {
    expect(family("Competition Squat", "squat")).toBe("squat");
    expect(family("Competition Bench", "bench")).toBe("bench");
    expect(family("Competition Deadlift", "deadlift")).toBe("deadlift");
  });
  it("only fills unset families, never overwriting a coach's choice", () => {
    expect(sql).toMatch(/SET movement_family = public\.exercise_movement_family_for\(name, competition_lift_type\)\s+WHERE movement_family IS NULL;/);
  });
  it("touches nothing but the family during the backfill", () => {
    expect(sql).toContain("DISABLE TRIGGER");
    expect(sql).toContain("exercises_updated_at");
    expect(sql).toContain("exercises_default_volume_multiplier");
    expect(sql.indexOf("DISABLE TRIGGER")).toBeLessThan(sql.indexOf("SET movement_family"));
    expect(sql.indexOf("SET movement_family")).toBeLessThan(sql.lastIndexOf("ENABLE TRIGGER"));
  });
});
