/**
 * The Nov 18 2026 accessory-flow pass on the library and live programs: the JF Effect
 * sessions reordered in programs.ts, the migration that brings the installed copies in
 * line (generated from the definitions), and the guards on the client and coach-template
 * migrations (untouched workouts only, backed up, checked).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLibrary } from "@/lib/jf-programs/build";
import { SESSION_ORDER_CHANGES, SESSION_ORDER_MIGRATION, sessionOrderSql, sessionOrders } from "@/lib/jf-programs/session-order-sql";
import { EX } from "@/lib/jf-programs/catalog";

const lib = new Map(buildLibrary().map((t) => [t.id, t]));
const nameOf = new Map(Object.values(EX).map((e: any) => [e.id, { name: e.name, equipment: e.equipment ?? null }]));

describe("JF Effect library: sessions reordered for flow", () => {
  it("the migration is generated from the definitions (never hand-edited)", () => {
    expect(readFileSync(SESSION_ORDER_MIGRATION, "utf8")).toBe(sessionOrderSql());
  });

  it("each reordered session: the dumbbell work and the cable work together, compounds still first", () => {
    const want: Record<string, Record<string, string[]>> = {
      "jf-strength-development": { "Day 1 — Squat + Bench": ["Competition Squat", "Competition Squat", "Competition Bench", "Cable Close-Grip Row", "High Cable Kneeling Crunch", "Seated Leg Curl Machine"] },
      "jf-muscle-foundation": {
        "Day 2 — Full Body B": ["Goblet Squat", "Incline Dumbbell Press", "Chin-Grip Lat Pulldown", "Cable Triceps Pushdown", "Seated Leg Curl Machine", "Standing Calf Raise - Machine"],
        "Day 3 — Full Body C": ["Belt Squat", "Chest Press Machine", "Hip Thrust - Barbell", "Chest Supported Dumbbell Row", "Dumbbell Curl", "Dead Bug"],
      },
      // the curls come back to the dumbbells at the end: after the pulldown, never before it
      "jf-muscle-strength": { "Day 1 — Upper A": ["Incline Dumbbell Press", "Chest Supported Dumbbell Row", "Chin-Grip Lat Pulldown", "Cable Lateral Raises", "Cable Triceps Pushdown", "Dumbbell Curl"] },
      "jf-fitness-foundation": { "Day 2 — Full Body B": ["Hip Thrust - Barbell", "Dumbbell Split Squat", "Seated Shoulder Press - Dumbbell", "Cable Close-Grip Row", "Seated Leg Curl Machine", "Dead Bug"] },
      "jf-glute-physique-builder": { "Day 4 — Upper B": ["Chest Press Machine", "Chest Supported Dumbbell Row", "Seated Shoulder Press - Dumbbell", "Dumbbell Curl", "Machine Rear Delt Fly", "High Cable Kneeling Crunch"] },
    };
    for (const c of SESSION_ORDER_CHANGES) {
      const t = lib.get(c.templateId)!;
      const orders = sessionOrders(t.payload, c.days);
      for (const [title, ids] of Object.entries(orders)) expect(ids.map((id) => nameOf.get(id)?.name ?? id), `${t.name} ${title}`).toEqual(want[t.slug][title]);
    }
  });

  it("only the installed copy that's still exactly as installed changes, backed up, checked, and the members' copy kept in step", () => {
    const sql = readFileSync(SESSION_ORDER_MIGRATION, "utf8");
    expect(sql.match(/IF _n = 0 THEN RETURN; END IF;/g)).toHaveLength(SESSION_ORDER_CHANGES.length);
    expect(sql).toContain("INSERT INTO public.template_flow_backup");
    expect(sql.match(/RAISE EXCEPTION/g)).toHaveLength(SESSION_ORDER_CHANGES.length * 2);
    expect(sql).toContain("last_published_version = coalesce(t.payload_revision, 0) + 1");
    const executable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/DELETE FROM/);
  });
});

describe("live programs and the coach's templates", () => {
  it("a client's workout changes only while nothing is logged in it and every moved row is where it was read", () => {
    const sql = readFileSync("supabase/migrations/20270411090000_accessory_flow_live_programs.sql", "utf8");
    expect(sql).toContain("public.pl_day_touched(");
    expect(sql).toContain("bool_and(EXISTS (SELECT 1 FROM public.pl_exercise_rows r WHERE r.id = p.row_id AND r.day_id = p.day_id AND r.sort_order = p.old_sort))");
    expect(sql).toContain("INSERT INTO public.accessory_flow_backup");
    expect(sql).toContain("public.instant_to_local(now(), 'America/Winnipeg')");
    // order and three station cues only: no exercise, set, rep or load changes
    const executable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(executable).not.toMatch(/SET (exercise_id|sets|reps_text|rpe|rir|percentage|load_kg|load_lb)\b/);
    expect(executable).not.toMatch(/DELETE FROM/);
  });

  it("a coach template changes only while it's exactly as read, and comes out in the planned order or not at all", () => {
    const sql = readFileSync("supabase/migrations/20270411092000_coach_templates_session_order.sql", "utf8");
    expect(sql).toContain("md5(t.payload::text) = _md5");
    expect(sql).toContain("RAISE EXCEPTION 'session order: template % did not come out in the planned order'");
    expect(sql.match(/SELECT pg_temp\.reorder_template\(/g)).toHaveLength(4);
  });
});
