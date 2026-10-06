/**
 * Exercise Library control center — pure logic.
 *
 *   FAMILY            group of related, distinct movements (Bench Press)
 *   CANONICAL EXERCISE an actual exercise/variation (Spoto Press)
 *   ALIAS             another name for the exact same exercise ("Comp Bench")
 *   VIDEO             demo attached to the canonical exercise; aliases inherit it
 *
 * Everything here is synchronous and runs over the already-loaded library so
 * search, filters and counts stay instant on a phone.
 */
import { normalizeText, searchExercises, SEARCH_TIER, type SearchableExercise } from "@/lib/exercise-search";
import { labelForMuscle } from "@/lib/volume";

export type LibraryExercise = SearchableExercise & {
  exercise_family?: string | null;
  /** squat | bench | deadlift | accessory — card colour. */
  movement_family?: string | null;
  competition_lift_type?: string | null;
  muscle_groups?: string[] | null;
  secondary_muscle_groups?: string[] | null;
  needs_muscle_review?: boolean | null;
  video_url?: string | null;
  vimeo_embed_url?: string | null;
  youtube_url?: string | null;
  secondary_vimeo_embed_url?: string | null;
  video_migration_status?: string | null;
  quality_warning?: string | null;
  created_at?: string | null;
};

export type ExerciseAlias = {
  alias_key: string;
  alias_name: string;
  exercise_id: string;
  source?: string | null;
};

export type ExerciseUsage = {
  exercise_id: string;
  programs: number;
  active_clients: number;
  templates: number;
  logged_workouts: number;
  logged_sets: number;
};

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

export type VideoStatus = "video" | "broken" | "none";

const isHttpUrl = (u: string | null | undefined) => !!u && /^https?:\/\/\S+$/i.test(u.trim());

/** The demo the athlete's How-To sheet plays (same precedence as the sheet). */
export function exerciseVideoUrl(e: LibraryExercise): string | null {
  return e.video_url || e.vimeo_embed_url || e.youtube_url || null;
}

/**
 * VIDEO = a playable URL is attached. BROKEN = something is attached but it is
 * flagged (quality warning / missing on Vimeo) or isn't a usable URL.
 */
export function videoStatus(e: LibraryExercise): VideoStatus {
  const urls = [e.video_url, e.vimeo_embed_url, e.youtube_url].filter((u) => !!u && String(u).trim());
  if (urls.length === 0) return "none";
  if (!urls.some(isHttpUrl)) return "broken";
  if (e.quality_warning && String(e.quality_warning).trim()) return "broken";
  if (e.video_migration_status === "missing_vimeo" || e.video_migration_status === "quality_warning") return "broken";
  return "video";
}

/** Embeddable player URL for a quick preview (Vimeo/YouTube), else the raw URL. */
export function previewEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo && !/player\.vimeo\.com/i.test(url)) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

/* ------------------------------------------------------------------ */
/* Muscles / family                                                    */
/* ------------------------------------------------------------------ */

/** Families where "Other" is an honest muscle answer (no strength target). */
const NON_STRENGTH_FAMILIES = new Set(["Mobility", "Conditioning"]);

export function hasMuscleTags(e: LibraryExercise): boolean {
  const p = (e.muscle_groups ?? []).filter(Boolean);
  if (p.length === 0) return false;
  if (p.every((m) => m === "other")) return NON_STRENGTH_FAMILIES.has(e.exercise_family ?? "");
  return true;
}

export function muscleLabels(keys: readonly string[] | null | undefined): string[] {
  return (keys ?? []).filter((k) => k && k !== "other").map(labelForMuscle);
}

/* ------------------------------------------------------------------ */
/* Possible duplicates                                                 */
/* ------------------------------------------------------------------ */

const DUP_SYNONYMS: Record<string, string> = {
  raises: "raise", curls: "curl", dumbbells: "dumbbell", db: "dumbbell", dbs: "dumbbell",
  bb: "barbell", bicep: "biceps", tricep: "triceps", calve: "calf", calves: "calf",
  rows: "row", flyes: "fly", flies: "fly", flye: "fly", extensions: "extension",
  pulldown: "pull down", pulldowns: "pull down", pushdown: "push down", pushdowns: "push down",
  pressdown: "push down", pressdowns: "push down", pushup: "push up", pushups: "push up",
  pullup: "pull up", pullups: "pull up", chinup: "chin up", chinups: "chin up",
  squats: "squat", lunges: "lunge", deadlifts: "deadlift", presses: "press", shrugs: "shrug",
  crunches: "crunch", dips: "dip", comp: "competition",
};
const DUP_STOP = new Set(["the", "a", "with", "on", "of", "and", "version", "v2", "2", "to"]);

/**
 * Order-insensitive identity: "Hip Thrust - Barbell" ≡ "Barbell Hip Thrust".
 * Direction stays significant ("high to low" ≠ "low to high").
 */
export function duplicateKey(name: string): string {
  const words = normalizeText(name).split(" ").filter(Boolean);
  const tokens = words.flatMap((w) => (DUP_SYNONYMS[w] ?? w).split(" "));
  const set = Array.from(new Set(tokens.filter((t) => !DUP_STOP.has(t)))).sort();
  const i = words.indexOf("to");
  const direction = i > 0 && i < words.length - 1 ? `|${words[i - 1]}>${words[i + 1]}` : "";
  return set.join(" ") + direction;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export type DuplicateMatch = { id: string; name: string; via: "name" | "alias" };

/** Active exercises that look like the same movement under another name. */
export function findPossibleDuplicates(
  exercises: readonly LibraryExercise[],
  aliases: readonly ExerciseAlias[],
  dismissed: ReadonlySet<string> = new Set(),
): Map<string, DuplicateMatch[]> {
  const active = exercises.filter((e) => !e.archived);
  const byId = new Map(active.map((e) => [e.id, e]));
  const byKey = new Map<string, LibraryExercise[]>();
  for (const e of active) {
    const k = duplicateKey(e.name);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const out = new Map<string, DuplicateMatch[]>();
  const add = (a: LibraryExercise, b: LibraryExercise, via: DuplicateMatch["via"]) => {
    if (a.id === b.id || dismissed.has(pairKey(a.id, b.id))) return;
    const list = out.get(a.id) ?? [];
    if (!list.some((m) => m.id === b.id)) list.push({ id: b.id, name: b.name, via });
    out.set(a.id, list);
  };
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const a of group) for (const b of group) add(a, b, "name");
  }
  // An exercise whose name is already another exercise's alias.
  const aliasKeys = new Map<string, ExerciseAlias[]>();
  for (const al of aliases) {
    const k = duplicateKey(al.alias_name);
    aliasKeys.set(k, [...(aliasKeys.get(k) ?? []), al]);
  }
  for (const e of active) {
    for (const al of aliasKeys.get(duplicateKey(e.name)) ?? []) {
      const owner = byId.get(al.exercise_id);
      if (owner && owner.id !== e.id) {
        add(e, owner, "alias");
        add(owner, e, "alias");
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Needs attention                                                     */
/* ------------------------------------------------------------------ */

export type ExerciseIssue =
  | "no_video"
  | "broken_video"
  | "missing_muscles"
  | "no_family"
  | "possible_duplicate"
  | "needs_review";

export const ISSUE_LABEL: Record<ExerciseIssue, string> = {
  no_video: "No video",
  broken_video: "Broken video",
  missing_muscles: "Missing muscle tags",
  no_family: "No family",
  possible_duplicate: "Possible duplicate",
  needs_review: "Needs review",
};

export function exerciseIssues(
  e: LibraryExercise,
  duplicates: ReadonlyMap<string, DuplicateMatch[]>,
): ExerciseIssue[] {
  const issues: ExerciseIssue[] = [];
  const v = videoStatus(e);
  if (v === "none") issues.push("no_video");
  if (v === "broken") issues.push("broken_video");
  if (!hasMuscleTags(e)) issues.push("missing_muscles");
  if (!e.exercise_family?.trim()) issues.push("no_family");
  if ((duplicates.get(e.id)?.length ?? 0) > 0) issues.push("possible_duplicate");
  if (e.needs_muscle_review) issues.push("needs_review");
  return issues;
}

/* ------------------------------------------------------------------ */
/* Search: names + aliases + families + muscles, with the "why"        */
/* ------------------------------------------------------------------ */

export type MatchReason =
  | { kind: "alias"; text: string }
  | { kind: "family"; text: string }
  | { kind: "muscle"; text: string };

export type LibraryHit<T extends LibraryExercise = LibraryExercise> = {
  exercise: T;
  reason: MatchReason | null;
  highlights: string[];
  /** Name or alias text match (not just family/muscle metadata). */
  strong: boolean;
};

const STRONG_TIER = SEARCH_TIER.nameSubstring;

export function searchLibrary<T extends LibraryExercise>(
  exercises: readonly T[],
  aliases: readonly ExerciseAlias[],
  query: string,
): { hits: LibraryHit<T>[]; highlightTerms: string[] } {
  const q = query.trim();
  if (!q) return { hits: exercises.map((exercise) => ({ exercise, reason: null, highlights: [], strong: false })), highlightTerms: [] };

  const byId = new Map(exercises.map((e) => [e.id, e]));
  type Best = { tier: number; score: number; reason: MatchReason | null; highlights: string[] };
  const best = new Map<string, Best>();
  const offer = (id: string, b: Best) => {
    const cur = best.get(id);
    if (!cur || b.tier < cur.tier || (b.tier === cur.tier && b.score > cur.score)) best.set(id, b);
  };

  const names = searchExercises(exercises, q, { limit: 5000 });
  for (const r of names.results) {
    if (!r.complete) continue;
    const viaName = r.tier <= STRONG_TIER;
    offer(r.exercise.id, {
      tier: r.tier,
      score: r.score,
      highlights: r.highlights,
      reason: viaName ? null : muscleReason(r.exercise, q),
    });
  }

  const aliasRows = aliases
    .filter((a) => byId.has(a.exercise_id))
    .map((a, i) => ({ id: `${a.exercise_id}#${i}`, name: a.alias_name, owner: a.exercise_id }));
  const aliasHits = searchExercises(aliasRows, q, { limit: 5000 });
  for (const r of aliasHits.results) {
    if (!r.complete || r.tier > STRONG_TIER) continue;
    const row = r.exercise as (typeof aliasRows)[number];
    // An alias hit ranks just behind the same-strength name hit.
    offer(row.owner, { tier: r.tier + 0.5, score: r.score, highlights: [], reason: { kind: "alias", text: row.name } });
  }

  const nq = normalizeText(q);
  const qTokens = nq.split(" ").filter(Boolean);
  for (const e of exercises) {
    const fam = normalizeText(e.exercise_family);
    if (fam && qTokens.every((t) => fam.split(" ").some((w) => w.startsWith(t)))) {
      offer(e.id, { tier: SEARCH_TIER.metadataComplete, score: 1, highlights: [], reason: { kind: "family", text: e.exercise_family! } });
    }
    const muscles = [...(e.muscle_groups ?? []), ...(e.secondary_muscle_groups ?? [])].map(labelForMuscle);
    const hit = muscles.find((m) => normalizeText(m) === nq || normalizeText(m).startsWith(nq));
    if (hit) offer(e.id, { tier: SEARCH_TIER.metadataComplete + 0.5, score: 0, highlights: [], reason: { kind: "muscle", text: hit } });
  }

  const hits = Array.from(best.entries())
    .sort(([ia, a], [ib, b]) =>
      a.tier - b.tier || b.score - a.score || byId.get(ia)!.name.localeCompare(byId.get(ib)!.name))
    .map(([id, b]) => ({ exercise: byId.get(id)!, reason: b.reason, highlights: b.highlights, strong: b.tier <= STRONG_TIER + 0.5 }));
  return { hits, highlightTerms: names.highlightTerms };
}

function muscleReason(e: LibraryExercise, q: string): MatchReason | null {
  const nq = normalizeText(q);
  const m = [...(e.muscle_groups ?? []), ...(e.secondary_muscle_groups ?? [])]
    .map(labelForMuscle)
    .find((l) => normalizeText(l).includes(nq) || nq.includes(normalizeText(l)));
  return m ? { kind: "muscle", text: m } : null;
}

/* ------------------------------------------------------------------ */
/* Health summary                                                      */
/* ------------------------------------------------------------------ */

export type LibrarySummary = {
  total: number;
  withVideo: number;
  missingVideo: number;
  brokenVideo: number;
  needsAttention: number;
  missingMuscles: number;
  duplicates: number;
  withAliases: number;
};

export function summarizeLibrary(
  exercises: readonly LibraryExercise[],
  issues: ReadonlyMap<string, ExerciseIssue[]>,
  aliasCount: ReadonlyMap<string, number>,
): LibrarySummary {
  const s: LibrarySummary = {
    total: 0, withVideo: 0, missingVideo: 0, brokenVideo: 0, needsAttention: 0,
    missingMuscles: 0, duplicates: 0, withAliases: 0,
  };
  for (const e of exercises) {
    if (e.archived) continue;
    s.total++;
    const v = videoStatus(e);
    if (v === "video") s.withVideo++;
    else if (v === "none") s.missingVideo++;
    else s.brokenVideo++;
    const list = issues.get(e.id) ?? [];
    if (list.length) s.needsAttention++;
    if (list.includes("missing_muscles")) s.missingMuscles++;
    if (list.includes("possible_duplicate")) s.duplicates++;
    if ((aliasCount.get(e.id) ?? 0) > 0) s.withAliases++;
  }
  return s;
}
