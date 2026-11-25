import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bodyweightGoalOf } from "@/lib/coaching-sessions/sessions.server";

/**
 * Coaching sessions read many tables the generated types already know. Their
 * unit tests mock the database, so a column that doesn't exist only shows up
 * in production (Nov 25 2026: clients.bodyweight_goal_kg failed every Meetings
 * read). Every plain column a coaching-sessions file selects from a table the
 * generated types know must be one of that table's columns.
 */

const TYPES = readFileSync(join(process.cwd(), "src/integrations/supabase/types.ts"), "utf8");

function columnsOf(table: string): Set<string> | null {
  const start = TYPES.indexOf(`\n      ${table}: {\n        Row: {`);
  if (start < 0) return null;
  const body = TYPES.slice(start, TYPES.indexOf("\n        }", start + 20));
  return new Set([...body.matchAll(/^\s{10}([a-z_0-9]+)\??:/gm)].map((m) => m[1]));
}

const DIRS = ["src/lib/coaching-sessions"];
const files = DIRS.flatMap((d) => readdirSync(join(process.cwd(), d)).filter((f) => f.endsWith(".ts")).map((f) => join(d, f)));

describe("coaching sessions read real columns", () => {
  for (const file of files) {
    it(file, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const problems: string[] = [];
      for (const m of src.matchAll(/\.from\("([a-z_0-9]+)"\)\s*\.select\("([^"]+)"\)/g)) {
        const [, table, select] = m;
        const cols = columnsOf(table);
        if (!cols) continue; // a table newer than the generated types
        for (const raw of select.replace(/[a-z_0-9]+(![a-z_0-9]+)?\([^)]*\)/g, "").split(",")) {
          const c = raw.trim();
          if (!c || c === "*" || c.includes("(") || c.includes("!")) continue;
          if (!cols.has(c)) problems.push(`${table}.${c}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("bodyweightGoalOf", () => {
  it("reads the goal in its own unit as kg", () => {
    expect(bodyweightGoalOf({ bodyweight_goal_type: "lose", bodyweight_goal_value: 143.3, bodyweight_goal_unit: "lb", bodyweight_goal_date: "2026-12-05" })).toEqual({ kg: 65, date: "2026-12-05" });
    expect(bodyweightGoalOf({ bodyweight_goal_type: "performance_cut", bodyweight_goal_value: "57", bodyweight_goal_unit: "kg", bodyweight_goal_date: null })).toEqual({ kg: 57, date: null });
  });
  it("has no target for maintain or no value", () => {
    expect(bodyweightGoalOf({ bodyweight_goal_type: "maintain", bodyweight_goal_value: 70, bodyweight_goal_unit: "kg" })).toBeNull();
    expect(bodyweightGoalOf({ bodyweight_goal_type: "lose", bodyweight_goal_value: null })).toBeNull();
  });
});
