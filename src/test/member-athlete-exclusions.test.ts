import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Functions that list the coaching population. Member athletes (clients rows
// with athlete_kind = 'member', from member-built workouts) must never appear
// in them. If a migration redefines one of these, it has to keep the filter.
const COACHING_POPULATION_FUNCTIONS = [
  "can_view_community",
  "community_members",
  "community_week_stats",
  "community_week_wins",
  "league_month_scores",
  "league_current_prescriptions",
  "admin_dashboard_overview",
  "seed_messenger_checkin_occurrences",
  "admin_clients_directory",
];

const DIR = join(process.cwd(), "supabase/migrations");

function latestDefinition(name: string): { file: string; body: string } | null {
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "gi");
  let latest: { file: string; body: string } | null = null;
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    for (const m of sql.matchAll(re)) {
      const rest = sql.slice(m.index!);
      const tag = /\bas\s+(\$\w*\$)/i.exec(rest);
      if (!tag) continue;
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      latest = { file, body: rest.slice(0, end + tag[1].length) };
    }
  }
  return latest;
}

describe("member athletes stay out of coaching-population functions", () => {
  for (const name of COACHING_POPULATION_FUNCTIONS) {
    it(`${name} filters athlete_kind in its latest definition`, () => {
      const def = latestDefinition(name);
      expect(def).not.toBeNull();
      expect({ file: def!.file, filters: /athlete_kind\s*=\s*'coaching'/.test(def!.body) })
        .toEqual({ file: def!.file, filters: true });
    });
  }
});
