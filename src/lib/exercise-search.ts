/**
 * Shared exercise keyword search.
 *
 * One helper powers every exercise search surface (library, swap picker,
 * program-builder panel, inline add-exercise). Goals, in order:
 *   1. never miss a result because the words were typed out of order;
 *   2. understand gym shorthand ("db", "rdl", "ohp", "tri pushdown");
 *   3. still rank the closest match first;
 *   4. run locally over an already-loaded list so it feels instant.
 *
 * The matcher is deliberately additive: a query token can match the name,
 * an alias expansion, equipment, muscle group, movement pattern or a
 * category, and each of those contributes a different weight. Nothing is
 * filtered out for being a weak match — weak matches simply sort last, so
 * the UI can offer "closest results" instead of a dead end.
 */

export type SearchableExercise = {
  id: string;
  name: string;
  muscle_group?: string | null;
  primary_muscle_group?: string | null;
  category?: string | null;
  equipment?: string | null;
  primary_movement_pattern?: string | null;
  difficulty?: string | null;
  tags?: string[] | null;
};

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Lowercase, strip accents, collapse punctuation to spaces. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(input: string | null | undefined): string[] {
  const n = normalizeText(input);
  return n ? n.split(" ") : [];
}

/* ------------------------------------------------------------------ */
/* Aliases                                                             */
/* ------------------------------------------------------------------ */

/**
 * Multi-word phrases rewritten before tokenisation. The original phrase is
 * kept as well, so "ham curl" matches both "ham" + "curl" and
 * "hamstring curl".
 */
const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/\brear delt\b/g, "rear delts posterior deltoid"],
  [/\bside delt\b/g, "side delts lateral deltoid lateral raise"],
  [/\bfront delt\b/g, "front delts anterior deltoid"],
  [/\bham curl\b/g, "hamstring curl leg curl"],
  [/\bleg ext\b/g, "leg extension"],
  [/\bpec deck\b/g, "machine fly chest fly"],
  [/\bpull down\b/g, "pulldown lat pulldown"],
  [/\bchest press\b/g, "chest press bench press"],
  [/\bsingle leg\b/g, "single leg unilateral"],
  [/\bcalf raise\b/g, "calf raise calves"],
  [/\bface pull\b/g, "face pull rear delts"],
  [/\bgood morning\b/g, "good morning hinge hamstring"],
];

/**
 * Single-token expansions: gym shorthand, equipment nicknames and muscle
 * synonyms. Keys are normalised tokens; values are extra needles that count
 * as a match for that token.
 */
const TOKEN_ALIASES: Record<string, string[]> = {
  // equipment
  db: ["dumbbell"],
  dbs: ["dumbbell"],
  dumbell: ["dumbbell"],
  bb: ["barbell"],
  kb: ["kettlebell"],
  ez: ["ez bar", "ez-bar"],
  smith: ["smith machine", "machine"],
  cables: ["cable"],
  machines: ["machine"],
  bw: ["bodyweight"],
  band: ["bands", "resistance band"],
  // movements
  rdl: ["romanian deadlift", "romanian", "deadlift"],
  sldl: ["stiff leg deadlift", "deadlift"],
  ohp: ["overhead press", "shoulder press", "military press"],
  bp: ["bench press"],
  dl: ["deadlift"],
  sq: ["squat"],
  gm: ["good morning"],
  pulldown: ["lat pulldown", "pull down"],
  pullup: ["pull up", "chin up"],
  pullups: ["pull up"],
  chinup: ["chin up"],
  pushup: ["push up"],
  pushups: ["push up"],
  hyper: ["hyperextension", "back extension"],
  ext: ["extension"],
  ohe: ["overhead extension"],
  bulgarian: ["bulgarian split squat", "split squat"],
  bss: ["bulgarian split squat", "split squat"],
  // muscles
  tri: ["triceps", "tricep"],
  tris: ["triceps"],
  tricep: ["triceps"],
  bi: ["biceps", "bicep"],
  bis: ["biceps"],
  bicep: ["biceps"],
  ham: ["hamstring", "hamstrings", "leg curl"],
  hams: ["hamstring", "hamstrings"],
  hammy: ["hamstring"],
  quad: ["quads", "quadriceps"],
  quads: ["quad", "quadriceps"],
  glute: ["glutes"],
  glutes: ["glute"],
  delt: ["delts", "deltoid", "shoulder"],
  delts: ["delt", "deltoid", "shoulder"],
  shoulder: ["delts", "shoulders"],
  shoulders: ["delts", "shoulder"],
  lat: ["lats", "lat pulldown", "back"],
  lats: ["lat", "back"],
  pec: ["pecs", "chest"],
  pecs: ["pec", "chest"],
  chest: ["pec", "pecs"],
  back: ["lats", "row"],
  abs: ["core", "abdominals"],
  core: ["abs", "abdominals"],
  calves: ["calf"],
  calf: ["calves"],
  traps: ["trap", "shrug"],
  // context words
  home: ["dumbbell", "bodyweight", "band", "kettlebell"],
  gym: [],
};

/** Public read-only view — used by tests and by the "why did this match" hint. */
export const EXERCISE_TOKEN_ALIASES: Readonly<Record<string, readonly string[]>> = TOKEN_ALIASES;

/* ------------------------------------------------------------------ */
/* Query parsing                                                       */
/* ------------------------------------------------------------------ */

export type QueryTerm = {
  /** The token exactly as typed (normalised). */
  token: string;
  /** Token plus every alias expansion — any of these counts as a match. */
  needles: string[];
};

export type ParsedQuery = {
  raw: string;
  normalized: string;
  terms: QueryTerm[];
};

const NOISE_TOKENS = new Set(["a", "an", "the", "of", "for", "with", "and", "to"]);

export function parseQuery(raw: string): ParsedQuery {
  let normalized = normalizeText(raw);
  for (const [re, replacement] of PHRASE_ALIASES) {
    if (re.test(normalized)) {
      re.lastIndex = 0;
      normalized = `${normalized} ${replacement}`;
    }
    re.lastIndex = 0;
  }
  const seen = new Set<string>();
  const terms: QueryTerm[] = [];
  for (const token of words(raw)) {
    if (!token || NOISE_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    const needles = [token, ...(TOKEN_ALIASES[token] ?? [])];
    terms.push({ token, needles });
  }
  return { raw, normalized: normalizeText(raw), terms };
}

/* ------------------------------------------------------------------ */
/* Fuzzy matching                                                      */
/* ------------------------------------------------------------------ */

/** Bounded Levenshtein — returns `max + 1` as soon as it's clearly worse. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Typo tolerance scales with word length: 4-6 chars → 1 edit, 7+ → 2. */
function fuzzyBudget(token: string): number {
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export type TermMatchKind =
  | "exact-word"
  | "prefix"
  | "substring"
  | "alias"
  | "equipment"
  | "muscle"
  | "pattern"
  | "category"
  | "fuzzy"
  | "none";

const KIND_WEIGHT: Record<TermMatchKind, number> = {
  "exact-word": 100,
  prefix: 78,
  substring: 58,
  alias: 46,
  equipment: 34,
  muscle: 32,
  pattern: 26,
  category: 22,
  fuzzy: 14,
  none: 0,
};

/**
 * Deterministic ranking tiers. Tier ALWAYS beats score, so no
 * recommendation / muscle / equipment similarity signal can outrank an
 * explicit text match while the user is actively typing.
 */
export const SEARCH_TIER = {
  exactName: 0,
  namePrefix: 1,
  orderedTokens: 2,
  allTokensInName: 3,
  nameSubstring: 4,
  metadataComplete: 5,
  partial: 6,
} as const;
export type SearchTier = (typeof SEARCH_TIER)[keyof typeof SEARCH_TIER];

export type ScoredExercise<T extends SearchableExercise = SearchableExercise> = {
  exercise: T;
  score: number;
  /** Deterministic rank bucket — lower is stronger. */
  tier: SearchTier;
  /** True when every query term matched something. */
  complete: boolean;
  /** Literal strings to highlight inside the name. */
  highlights: string[];
  /** e.g. "DB = dumbbell" — only set when an alias/metadata carried the match. */
  reason?: string;
};


type Haystacks = {
  name: string;
  nameWords: string[];
  equipment: string;
  muscle: string;
  pattern: string;
  category: string;
};

function buildHaystacks(ex: SearchableExercise): Haystacks {
  const name = normalizeText(ex.name);
  return {
    name,
    nameWords: name ? name.split(" ") : [],
    equipment: normalizeText(ex.equipment),
    muscle: normalizeText(
      [ex.muscle_group, ex.primary_muscle_group, ...(ex.tags ?? [])].filter(Boolean).join(" "),
    ),
    pattern: normalizeText(ex.primary_movement_pattern),
    category: normalizeText(ex.category),
  };
}

/** Best match for one query term against one exercise. */
function matchTerm(
  term: QueryTerm,
  hay: Haystacks,
): { kind: TermMatchKind; weight: number; highlight?: string; alias?: string } {
  let best: { kind: TermMatchKind; weight: number; highlight?: string; alias?: string } = {
    kind: "none",
    weight: 0,
  };
  const consider = (
    kind: TermMatchKind,
    highlight?: string,
    alias?: string,
    bonus = 0,
  ) => {
    const weight = KIND_WEIGHT[kind] + bonus;
    if (weight > best.weight) best = { kind, weight, highlight, alias };
  };

  term.needles.forEach((needle, idx) => {
    const isAlias = idx > 0;
    // Alias hits are worth slightly less than the literal token.
    const penalty = isAlias ? -12 : 0;
    const aliasLabel = isAlias ? `${term.token.toUpperCase()} = ${needle}` : undefined;

    if (needle.includes(" ")) {
      if (hay.name.includes(needle)) consider(isAlias ? "alias" : "substring", needle, aliasLabel, isAlias ? 24 : 0);
    } else {
      for (const w of hay.nameWords) {
        if (w === needle) consider("exact-word", needle, aliasLabel, penalty);
        else if (w.startsWith(needle)) consider("prefix", needle, aliasLabel, penalty);
        else if (w.includes(needle) && needle.length >= 3)
          consider("substring", needle, aliasLabel, penalty);
      }
    }
    if (hay.equipment.includes(needle)) consider("equipment", undefined, aliasLabel);
    if (hay.muscle.includes(needle)) consider("muscle", undefined, aliasLabel);
    if (hay.pattern.includes(needle)) consider("pattern", undefined, aliasLabel);
    if (hay.category.includes(needle)) consider("category", undefined, aliasLabel);
  });

  // Typo tolerance only when nothing better was found.
  if (best.kind === "none") {
    const budget = fuzzyBudget(term.token);
    if (budget > 0) {
      for (const w of hay.nameWords) {
        if (Math.abs(w.length - term.token.length) > budget) continue;
        if (editDistance(w, term.token, budget) <= budget) {
          consider("fuzzy", w);
          break;
        }
      }
    }
  }
  return best;
}

/**
 * Position of the first place a term matches inside the *name* only.
 * Returns -1 when the term is not present in the name at all (metadata-only
 * matches deliberately do not count toward a name tier).
 */
function nameMatchIndex(term: QueryTerm, hay: Haystacks): number {
  let best = -1;
  for (const needle of term.needles) {
    if (!needle) continue;
    if (needle.includes(" ")) {
      const i = hay.name.indexOf(needle);
      if (i >= 0 && (best < 0 || i < best)) best = i;
      continue;
    }
    let cursor = 0;
    for (const w of hay.nameWords) {
      if (w === needle || w.startsWith(needle) || (needle.length >= 3 && w.includes(needle))) {
        if (best < 0 || cursor < best) best = cursor;
        break;
      }
      cursor += w.length + 1;
    }
  }
  return best;
}

function computeTier(query: ParsedQuery, hay: Haystacks, complete: boolean): SearchTier {
  const tokenQuery = query.terms.map((t) => t.token).join(" ");
  const needle = query.normalized || tokenQuery;
  if (hay.name === needle || hay.name === tokenQuery) return SEARCH_TIER.exactName;
  if (needle && hay.name.startsWith(needle)) return SEARCH_TIER.namePrefix;

  const positions = query.terms.map((t) => nameMatchIndex(t, hay));
  const allInName = positions.length > 0 && positions.every((p) => p >= 0);
  if (allInName) {
    let ordered = true;
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] <= positions[i - 1]) { ordered = false; break; }
    }
    return ordered ? SEARCH_TIER.orderedTokens : SEARCH_TIER.allTokensInName;
  }
  if (needle && hay.name.includes(needle)) return SEARCH_TIER.nameSubstring;
  return complete ? SEARCH_TIER.metadataComplete : SEARCH_TIER.partial;
}

export function scoreExercise<T extends SearchableExercise>(
  exercise: T,
  query: ParsedQuery,
  hay = buildHaystacks(exercise),
): ScoredExercise<T> | null {
  if (query.terms.length === 0) {
    return { exercise, score: 0, tier: SEARCH_TIER.partial, complete: true, highlights: [] };
  }
  let score = 0;
  let matched = 0;
  const highlights: string[] = [];
  let reason: string | undefined;

  for (const term of query.terms) {
    const m = matchTerm(term, hay);
    if (m.kind === "none") continue;
    matched += 1;
    score += m.weight;
    if (m.highlight) highlights.push(m.highlight);
    if (!reason && m.alias) reason = `Matched: ${m.alias}`;
    else if (!reason && (m.kind === "equipment" || m.kind === "muscle" || m.kind === "pattern" || m.kind === "category")) {
      reason = `Matched ${m.kind}: ${term.token}`;
    }
  }
  if (matched === 0) return null;

  const complete = matched === query.terms.length;
  if (complete) score += 220;
  // Whole-query bonuses.
  if (hay.name === query.normalized) score += 1200;
  else if (hay.name.startsWith(query.normalized)) score += 400;
  else if (query.normalized && hay.name.includes(query.normalized)) score += 180;
  // Prefer concise names when scores tie ("Leg Curl" over "Seated Leg Curl Machine Variation").
  score += Math.max(0, 40 - hay.nameWords.length * 4);

  const tier = computeTier(query, hay, complete);
  return { exercise, score, tier, complete, highlights, reason };
}


/* ------------------------------------------------------------------ */
/* Public search API                                                   */
/* ------------------------------------------------------------------ */

export type SearchResult<T extends SearchableExercise> = {
  /** Ranked matches, best first. Complete matches always outrank partials. */
  results: ScoredExercise<T>[];
  /** Terms to highlight (union of all matched needles + raw tokens). */
  highlightTerms: string[];
  /** False when nothing matched every term — UI shows "closest results". */
  hasExactMatches: boolean;
  parsed: ParsedQuery;
};

/**
 * Rank `list` against `query`. Pure and synchronous — call it inside a
 * `useMemo` keyed on the (debounced) query and the list identity.
 */
export function searchExercises<T extends SearchableExercise>(
  list: readonly T[],
  query: string,
  opts: { limit?: number } = {},
): SearchResult<T> {
  const parsed = parseQuery(query);
  const limit = opts.limit ?? 100;
  if (parsed.terms.length === 0) {
    return {
      results: list.slice(0, limit).map((exercise) => ({
        exercise, score: 0, tier: SEARCH_TIER.partial, complete: true, highlights: [],
      })),
      highlightTerms: [],
      hasExactMatches: true,
      parsed,
    };
  }

  const scored: ScoredExercise<T>[] = [];
  for (const ex of list) {
    const s = scoreExercise(ex, parsed);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.exercise.name.localeCompare(b.exercise.name);
  });

  const highlightTerms = new Set<string>();
  for (const term of parsed.terms) highlightTerms.add(term.token);
  for (const s of scored.slice(0, limit)) for (const h of s.highlights) highlightTerms.add(h);

  return {
    results: scored.slice(0, limit),
    highlightTerms: Array.from(highlightTerms),
    hasExactMatches: scored.some((s) => s.complete),
    parsed,
  };
}

/** Split `text` into highlighted / plain segments for any of `terms`. */
export function highlightSegments(
  text: string,
  terms: readonly string[],
): Array<{ text: string; match: boolean }> {
  const cleaned = terms
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0 || !text) return [{ text, match: false }];
  const escaped = cleaned.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[^a-z0-9]+"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const out: Array<{ text: string; match: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), match: false });
    out.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}
