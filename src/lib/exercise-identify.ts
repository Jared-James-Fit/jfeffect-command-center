/**
 * Exercise search's "describe it" (pure, tested; Nov 20 2026).
 *
 * When someone describes an exercise instead of naming it ("that back
 * exercise where you pull a cable toward your waist") and the local search
 * can't place it by name, the AI names what it most likely is
 * (exercise-identify.server.ts) and the app finds those names in the list the
 * screen already has (`matchGuesses`), so a suggestion is always an existing
 * library exercise the person is allowed to pick, never a new one. Nothing is
 * ever picked for them: every suggestion says how sure it is, and "Likely" is
 * the most it ever says.
 */
import {
  normalizeText,
  searchExercises,
  SEARCH_TIER,
  type SearchableExercise,
  type SearchResult,
} from "@/lib/exercise-search";

export type GuessConfidence = "high" | "medium" | "low";
export type IdentifyGuess = { name: string; also: string[]; confidence: GuessConfidence };
export type IdentifyReply = { guesses: IdentifyGuess[]; vague: boolean };

export const IDENTIFY_MIN_CHARS = 8;
export const IDENTIFY_MAX_CHARS = 200;
const MAX_GUESSES = 4;
const MAX_ALSO = 3;
const MAX_NAME = 60;

/** The cache key for a description: what it says, not how it was typed. */
export function descriptionKey(text: string): string {
  return normalizeText(text).slice(0, IDENTIFY_MAX_CHARS);
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .split("")
    .map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
  if (!s || s.split(" ").length > 8) return null; // a sentence, not a name
  if (!/[a-z]/i.test(s)) return null;
  return s;
}

/** The model's answer, read strictly: anything malformed is dropped, never guessed at. */
export function parseIdentifyReply(text: string | null | undefined): IdentifyReply | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: any;
  try {
    j = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const raw = Array.isArray(j.guesses) ? j.guesses : [];
  const guesses: IdentifyGuess[] = [];
  const seen = new Set<string>();
  for (const g of raw) {
    const name = cleanName(g?.name);
    if (!name) continue;
    const key = normalizeText(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const also = (Array.isArray(g?.also) ? g.also : [])
      .map(cleanName)
      .filter((n: string | null): n is string => !!n && normalizeText(n) !== key)
      .slice(0, MAX_ALSO);
    const c = String(g?.confidence ?? "").toLowerCase();
    const confidence: GuessConfidence = c === "high" || c === "medium" ? c : "low";
    guesses.push({ name, also, confidence });
    if (guesses.length >= MAX_GUESSES) break;
  }
  return { guesses, vague: guesses.length === 0 || j.vague === true };
}

/**
 * Whether to ask the AI: a description, or a few words that match nothing by
 * name. Never a single word, a name the library already has, or something
 * too short or long to be either.
 */
export function shouldAskAi(
  query: string,
  local: Pick<SearchResult<SearchableExercise>, "parsed" | "hasExactMatches" | "results">,
): boolean {
  const q = query.trim();
  if (q.length < IDENTIFY_MIN_CHARS || q.length > IDENTIFY_MAX_CHARS) return false;
  const words = normalizeText(q).split(" ").filter(Boolean);
  if (words.length < 2) return false;
  if (local.parsed.descriptive) return true;
  // a few words the library doesn't have by name ("zercher carry", "jefferson curl")
  return words.length >= 2 && !local.hasExactMatches;
}

export type DescribedMatch<T extends SearchableExercise> = {
  exercise: T;
  /** "likely" only when the AI was sure and the library has that exact exercise. */
  confidence: "likely" | "possible";
  /** The name the AI gave ("Seated Cable Row"). */
  guess: string;
};

/**
 * The library exercises the AI's names point to, in its order: each name (and
 * its other names) searched in `pool` like anything typed, keeping only real
 * name matches. At most two exercises per name, four in all.
 */
export function matchGuesses<T extends SearchableExercise>(
  pool: readonly T[],
  guesses: readonly IdentifyGuess[],
  opts: { limit?: number } = {},
): DescribedMatch<T>[] {
  const limit = opts.limit ?? 4;
  const out: DescribedMatch<T>[] = [];
  const seen = new Set<string>();
  guesses.forEach((g, gi) => {
    const found: Array<{ ex: T; tier: number; score: number }> = [];
    for (const name of [g.name, ...g.also]) {
      const r = searchExercises(pool, name, { limit: 6 });
      for (const hit of r.results) {
        if (!hit.complete || hit.alternative || hit.tier > SEARCH_TIER.nameSubstring) continue;
        found.push({ ex: hit.exercise, tier: hit.tier, score: hit.score });
      }
    }
    found.sort((a, b) => a.tier - b.tier || b.score - a.score);
    let taken = 0;
    for (const f of found) {
      if (taken >= 2 || out.length >= limit) break;
      if (seen.has(f.ex.id)) continue;
      seen.add(f.ex.id);
      taken += 1;
      const named = f.tier <= SEARCH_TIER.tokenEquivalent;
      out.push({
        exercise: f.ex,
        guess: g.name,
        confidence:
          gi === 0 && taken === 1 && g.confidence === "high" && named ? "likely" : "possible",
      });
    }
  });
  return out;
}
