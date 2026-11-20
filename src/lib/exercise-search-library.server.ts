/**
 * The exercise library as the shared search engine reads it, for the AI's
 * server-side lookups (Cleo's library search, Edit with AI's name resolution),
 * so a model finds an exercise the way a person does: any word order, gym
 * shorthand, plurals, a slip of spelling, the library's own aliases.
 *
 * Read page by page with the caller's own session (RLS decides; every
 * signed-in person can read the library) and kept for 10 minutes per server.
 * The library is the same for everyone, so one copy serves every caller.
 */
import type { SearchableExercise } from "@/lib/exercise-search";

type Db = any;

export type LibraryRow = SearchableExercise & {
  primary_muscle_group: string | null;
  muscle_group: string | null;
  equipment: string | null;
  movement_family: string | null;
  video_url: string | null;
  category: string | null;
  exercise_category: string | null;
  archived: boolean;
};

const COLS =
  "id, name, primary_muscle_group, muscle_group, equipment, movement_family, video_url, category, exercise_category, archived, primary_movement_pattern, muscle_groups, exercise_family";
const PAGE = 1000;
const TTL_MS = 10 * 60_000;

let cache: { at: number; rows: LibraryRow[] } | null = null;
let loading: Promise<LibraryRow[]> | null = null;

async function load(db: Db): Promise<LibraryRow[]> {
  const rows: LibraryRow[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await db
      .from("exercises")
      .select(COLS)
      .eq("archived", false)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`exercise library: ${error.message}`);
    rows.push(...((data ?? []) as LibraryRow[]));
    if (!data || data.length < PAGE) break;
  }
  const { data: aliases } = await db
    .from("exercise_aliases")
    .select("exercise_id, alias_name")
    .limit(5000);
  const byId = new Map<string, string[]>();
  for (const a of (aliases ?? []) as Array<{ exercise_id: string; alias_name: string }>) {
    if (!a?.exercise_id || !a.alias_name) continue;
    byId.set(a.exercise_id, [...(byId.get(a.exercise_id) ?? []), a.alias_name]);
  }
  return rows.map((r) => ({ ...r, aliases: byId.get(r.id) ?? [] }));
}

/** Every unarchived library exercise with its aliases, ready for searchExercises. */
export async function searchableLibrary(db: Db): Promise<LibraryRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (!loading) {
    loading = load(db)
      .then((rows) => {
        cache = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}
