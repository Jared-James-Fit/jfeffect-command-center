/**
 * Shared exercise search (Nov 20 2026 rewrite of the keyword matcher).
 *
 * One pure, synchronous engine powers every place an exercise is searched,
 * added or swapped (the logger's add / swap sheets, both program builders,
 * the inline editor, the library pages). It runs over the list the screen has
 * already loaded, so a keystroke never waits on the network.
 *
 * How a query is read:
 *   1. Canonical words, the same way for the query and every name: lower case,
 *      accents and punctuation gone, plurals singular, gym shorthand spelled out
 *      ("DB" = dumbbell, "laying" = lying, "tris" = tricep) and split words
 *      joined ("pull-ups" = "pull ups" = "pullups").
 *   2. Equivalent names are one term ("RDL" = "Romanian deadlift", "side raise"
 *      = "lateral raise", "OHP" = "overhead press"); a muscle ("side delt",
 *      "lats"), an equipment word ("cable") or a movement ("pull", "hinge") can
 *      also be met by the exercise's own tags in the library.
 *   3. A description ("that back exercise where you pull a cable toward your
 *      waist") drops its filler words and its cues become movements ("toward
 *      your waist" = a row). Anything the cues can't place is the AI's
 *      (useExerciseSearch, exercise-identify), which only ever suggests.
 *
 * How results are ranked (lower `tier` first, then `score`):
 *   0 the exact name; 1 the same words in any order (or an equivalent name);
 *   2-5 every term found in the name (spelling slips and half-typed words
 *   included), ranked by how much of the name the query explains, so
 *   "lateral raise cable" puts Cable Lateral Raises before "Lateral Raise To
 *   Shoulder Press Resistance Band Cable"; 6 every term met, some only by the
 *   library's tags ("quad machine" → Leg Extension); 7 partial. Partial matches
 *   are dropped whenever anything matches every term, so a search never buries
 *   the answer under loosely related exercises. A caller's `boost` (their recent
 *   or program exercises) only breaks ties inside a tier.
 */

export type SearchableExercise = {
  id: string;
  name: string;
  archived?: boolean | null;
  muscle_group?: string | null;
  primary_muscle_group?: string | null;
  category?: string | null;
  equipment?: string | null;
  primary_movement_pattern?: string | null;
  difficulty?: string | null;
  tags?: string[] | null;
  /** The library's muscle keys ("side_delts", "upper_back"). Optional. */
  muscle_groups?: string[] | null;
  secondary_muscle_groups?: string[] | null;
  /** "Lateral Raise", "Row"… Optional. */
  exercise_family?: string | null;
  /** Other names for this exact exercise ("Comp Bench"). Optional — see the alias index. */
  aliases?: readonly string[] | null;
};

/* ------------------------------------------------------------------ */
/* Alias index                                                         */
/* ------------------------------------------------------------------ */

let aliasIndex: ReadonlyMap<string, readonly string[]> = new Map();
let aliasVersion = 0;

/**
 * Register the library's aliases (exercise_aliases rows) once; every search
 * surface then understands them without each picker loading aliases itself.
 * Searching an alias returns the CANONICAL exercise, never a duplicate.
 */
export function setExerciseAliasIndex(
  rows: ReadonlyArray<{ exercise_id: string; alias_name: string }>,
): void {
  const next = new Map<string, string[]>();
  for (const r of rows) {
    if (!r?.exercise_id || !r.alias_name) continue;
    const list = next.get(r.exercise_id) ?? [];
    list.push(r.alias_name);
    next.set(r.exercise_id, list);
  }
  aliasIndex = next;
  aliasVersion += 1;
}

function aliasesFor(ex: SearchableExercise): readonly string[] {
  return ex.aliases ?? aliasIndex.get(ex.id) ?? [];
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

/** Lowercase, strip accents, collapse punctuation to spaces. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Conservative English singularisation for exercise-name search tokens. */
export function singularizeSearchToken(token: string): string {
  const value = normalizeText(token);
  if (value.length <= 3) return value;
  if (/(?:ss|us|is)$/.test(value)) return value;
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|z)es$/.test(value)) return value.slice(0, -2);
  if (value.endsWith("s")) return value.slice(0, -1);
  return value;
}

/**
 * Words that mean the same thing in an exercise name. Keys are singular,
 * normalised tokens; values are the one spelling both sides are read as.
 */
const WORD_CANON: Record<string, string> = {
  db: "dumbbell",
  dbs: "dumbbell",
  dumbell: "dumbbell",
  dumbel: "dumbbell",
  dumbbel: "dumbbell",
  dumbells: "dumbbell",
  bb: "barbell",
  barbel: "barbell",
  kb: "kettlebell",
  kbs: "kettlebell",
  kettlebel: "kettlebell",
  ez: "ezbar",
  tri: "tricep",
  tris: "tricep",
  bi: "bicep",
  bis: "bicep",
  ham: "hamstring",
  hams: "hamstring",
  hammy: "hamstring",
  hammie: "hamstring",
  quadricep: "quad",
  deltoid: "delt",
  pectoral: "pec",
  gluteus: "glute",
  glut: "glute",
  abs: "ab",
  abdominal: "ab",
  trapezius: "trap",
  calve: "calf",
  laying: "lying",
  flye: "fly",
  alt: "alternate",
  alternating: "alternate",
  ext: "extension",
  extention: "extension",
  comp: "competition",
  bw: "bodyweight",
  one: "single",
  sitting: "seated",
  inclined: "incline",
  declined: "decline",
  rev: "reverse",
  legged: "leg",
  pressdown: "pushdown",
  farmers: "farmer",
};

/** Two words that are one exercise word ("pull up" = "pullup"). After WORD_CANON. */
const COMPOUNDS: Record<string, Record<string, string>> = {
  pull: {
    up: "pullup",
    ups: "pullup",
    down: "pulldown",
    over: "pullover",
    through: "pullthrough",
    apart: "pullapart",
  },
  push: { up: "pushup", ups: "pushup", down: "pushdown" },
  press: { down: "pushdown" },
  chin: { up: "chinup", ups: "chinup" },
  sit: { up: "situp", ups: "situp" },
  step: { up: "stepup", ups: "stepup" },
  skull: { crusher: "skullcrusher" },
  dead: { lift: "deadlift", bug: "deadbug" },
  kick: { back: "kickback" },
  hyper: { extension: "hyperextension" },
  t: { bar: "tbar" },
  ezbar: { bar: "ezbar", curl: "" },
  trap: { bar: "trapbar" },
  hex: { bar: "trapbar" },
  v: { bar: "vbar" },
  body: { weight: "bodyweight" },
};

/** Never part of an exercise's identity. */
const NOISE = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "with",
  "and",
  "to",
  "on",
  "in",
  "at",
  "or",
  "by",
  "from",
  "into",
  "onto",
  "version",
]);

/** Camera angles and duplicates of the same demo ("Left", "Side View", "Version 2"). */
const VIEW_WORDS = new Set(["left", "right", "view", "pov", "female", "male", "v2", "variation"]);

type CanonWord = { word: string; raw: string };

function canonToken(t: string): string {
  if (WORD_CANON[t]) return WORD_CANON[t];
  const s = singularizeSearchToken(t);
  return WORD_CANON[s] ?? s;
}

/** Canonical words with the raw text each came from (for highlighting). */
function canonWordsWithRaw(text: string | null | undefined): CanonWord[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  const rawTokens = norm.split(" ");
  const out: CanonWord[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i];
    let word = canonToken(raw);
    // "1 arm" / "one arm" = "single arm"
    if (raw === "1" && /^(arm|leg|hand|side|foot)/.test(rawTokens[i + 1] ?? "")) word = "single";
    const prev = out[out.length - 1];
    if (prev) {
      const joined = COMPOUNDS[prev.word]?.[word] ?? COMPOUNDS[prev.word]?.[raw];
      if (joined !== undefined) {
        if (joined) {
          prev.word = joined;
          prev.raw = `${prev.raw} ${raw}`;
        } else {
          out.push({ word, raw });
        }
        continue;
      }
      if (prev.word === "hip" && (word === "thruster" || word === "thrusters")) word = "thrust";
    }
    out.push({ word, raw });
  }
  return out.filter((w) => !NOISE.has(w.word));
}

function canonWords(text: string | null | undefined): string[] {
  return canonWordsWithRaw(text).map((w) => w.word);
}

/** Programming role labels are prescription metadata, not exercise identity. */
export function canonicalExerciseIdentity(input: string | null | undefined): string {
  const raw = String(input ?? "").trim();
  const withoutRole = raw.replace(
    /^\s*(?:primary|secondary|tertiary|quaternary|quinary|limiter|accessory|isolation|gpp)(?:\s+(?:squat|bench(?:\s+press)?|deadlift))?\s*(?:[-—–:|]+)\s*/i,
    "",
  );
  return normalizeText(withoutRole || raw);
}

function canonicalExerciseKey(input: string | null | undefined): string {
  const identity = canonicalExerciseIdentity(input);
  if (!identity) return "";
  return canonWords(identity).join(" ");
}

/** Word-order-insensitive key. Direction phrases ("high to low") are never folded. */
function orderInsensitiveKey(input: string | null | undefined): string {
  const identity = canonicalExerciseIdentity(input);
  if (!identity || /(^| )to( |$)/.test(identity)) return "";
  const key = canonWords(identity);
  return Array.from(new Set(key)).sort().join(" ");
}

/**
 * The existing library exercise a requested name already refers to, or null.
 * Order: canonical name -> alias -> same words in another order. Used before
 * any create so a differently-worded name reuses the exercise instead of
 * adding a duplicate.
 */
export function findCanonicalExerciseMatch<T extends SearchableExercise>(
  list: readonly T[],
  requestedName: string,
  aliases: ReadonlyArray<{ exercise_id: string; alias_name: string }> = [],
): T | null {
  const identity = canonicalExerciseIdentity(requestedName);
  const key = canonicalExerciseKey(requestedName);
  if (!key) return null;
  const matches = list.filter(
    (exercise) => !exercise.archived && canonicalExerciseKey(exercise.name) === key,
  );
  if (matches.length === 0) {
    const live = new Map(list.filter((e) => !e.archived).map((e) => [e.id, e] as const));
    const viaAlias = aliases.find(
      (a) => live.has(a.exercise_id) && canonicalExerciseKey(a.alias_name) === key,
    );
    if (viaAlias) return live.get(viaAlias.exercise_id) ?? null;
    const loose = orderInsensitiveKey(requestedName);
    if (!loose) return null;
    const reordered = list.filter(
      (exercise) => !exercise.archived && orderInsensitiveKey(exercise.name) === loose,
    );
    return reordered.length === 1 ? reordered[0] : null;
  }
  // Prefer the established, concise canonical name over role-prefixed,
  // punctuation-only, singular/plural, or shorthand duplicates.
  return [...matches].sort((a, b) => {
    const aExact = normalizeText(a.name) === identity ? 0 : 1;
    const bExact = normalizeText(b.name) === identity ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.length - b.name.length;
  })[0];
}

/* ------------------------------------------------------------------ */
/* Vocabulary: equivalent names, muscles, equipment, movements          */
/* ------------------------------------------------------------------ */

/**
 * Names for the same exercise (or the same part of one). A query that says any
 * of them matches a name that says any other, ranked a little under the words
 * typed. Written as they'd be typed; read through canonWords.
 */
const EQUIVALENT_NAMES: string[][] = [
  [
    "lateral raise",
    "side raise",
    "side lateral raise",
    "lat raise",
    "side delt raise",
    "lateral delt raise",
  ],
  ["romanian deadlift", "rdl"],
  ["stiff leg deadlift", "sldl", "straight leg deadlift"],
  ["overhead press", "ohp", "shoulder press", "military press"],
  ["bench press", "bp"],
  ["deadlift", "dl"],
  ["bulgarian split squat", "bss", "rear foot elevated split squat", "rfess"],
  ["skullcrusher", "lying tricep extension", "lying extension"],
  ["pec deck", "machine fly", "chest fly machine", "butterfly machine"],
  ["lat pulldown", "pulldown", "lat pull"],
  ["leg curl", "hamstring curl"],
  ["leg extension", "quad extension"],
  ["good morning", "gm"],
  ["glute ham raise", "ghr"],
  ["calf raise", "heel raise"],
  ["safety bar squat", "safety squat bar squat", "safety squat bar", "ssb squat", "ssb"],
  ["touch go", "tng"],
  ["close grip bench press", "cgbp"],
  ["handstand pushup", "hspu"],
  ["back extension", "hyperextension", "hyper"],
  ["reverse fly", "rear delt fly", "reverse pec deck"],
  ["chest fly", "pec fly"],
  ["ab wheel", "ab rollout", "rollout"],
  ["farmer walk", "farmer carry"],
  ["hanging leg raise", "hlr"],
  ["overhead extension", "ohe", "overhead tricep extension", "french press"],
  ["single leg", "unilateral"],
  ["single arm", "unilateral"],
  ["tricep pushdown", "pushdown"],
  ["front squat", "fsq"],
  ["sumo deadlift", "sumo"],
  ["hip thrust", "glute thrust"],
  ["jm press", "jm"],
];

/**
 * Different exercises close enough to offer when the one asked for isn't in
 * the library (never as the same exercise: shown as an alternative).
 */
const RELATED_NAMES: Array<[string, string[]]> = [
  ["t bar row", ["landmine row", "chest supported row"]],
  ["seal row", ["chest supported row", "prone row", "lying row"]],
  ["meadows row", ["landmine row", "single arm row"]],
  ["kroc row", ["single arm dumbbell row"]],
  ["yates row", ["barbell row"]],
  ["zercher squat", ["front squat", "goblet squat"]],
  ["sissy squat", ["leg extension"]],
  ["reverse hyper", ["back extension", "glute bridge"]],
  ["hack squat", ["leg press", "pendulum squat"]],
  ["pendulum squat", ["hack squat", "leg press"]],
  ["glute ham raise", ["nordic", "leg curl"]],
  ["nordic", ["leg curl"]],
  ["jm press", ["close grip bench press", "skullcrusher"]],
  ["pullover", ["straight arm pulldown"]],
  ["safety bar squat", ["front squat", "high bar squat"]],
  ["bayesian curl", ["cable curl"]],
  ["spider curl", ["preacher curl"]],
  ["cable crunch", ["kneeling crunch", "machine crunch"]],
  ["belt squat", ["leg press"]],
  ["jefferson curl", ["stiff leg deadlift"]],
  ["landmine row", ["t bar row"]],
  ["trap bar deadlift", ["deadlift"]],
  ["chest press", ["bench press"]],
];

/** Abbreviations that only ever stand for their phrase (shown as the "why"). */
const ABBREVIATIONS = new Set([
  "rdl",
  "sldl",
  "ohp",
  "bp",
  "dl",
  "bss",
  "rfess",
  "gm",
  "ghr",
  "ssb",
  "tng",
  "cgbp",
  "hspu",
  "hlr",
  "ohe",
  "fsq",
  "jm",
]);

type Attr = string; // "eq:cable", "mu:side_delts", "pt:horizontal_pull"

const DELTS = ["mu:front_delts", "mu:side_delts", "mu:rear_delts"];
const BACK = ["mu:lats", "mu:upper_back", "mu:lower_back", "mu:traps"];
const LEGS = ["mu:quads", "mu:hamstrings", "mu:glutes", "mu:calves", "mu:adductors"];
const ARMS = ["mu:biceps", "mu:triceps", "mu:forearms"];

/** Muscle words in a query: what they need from the exercise's tags (and names that are that muscle's lift). */
const MUSCLE_TERMS: Array<{ phrase: string; attrs: Attr[]; names?: string[] }> = [
  { phrase: "side delt", attrs: ["mu:side_delts"], names: ["lateral raise", "side raise"] },
  { phrase: "lateral delt", attrs: ["mu:side_delts"], names: ["lateral raise", "side raise"] },
  { phrase: "middle delt", attrs: ["mu:side_delts"], names: ["lateral raise", "side raise"] },
  {
    phrase: "rear delt",
    attrs: ["mu:rear_delts"],
    names: ["rear delt", "reverse fly", "face pull"],
  },
  { phrase: "posterior delt", attrs: ["mu:rear_delts"], names: ["rear delt", "reverse fly"] },
  { phrase: "front delt", attrs: ["mu:front_delts"], names: ["front raise"] },
  { phrase: "anterior delt", attrs: ["mu:front_delts"], names: ["front raise"] },
  { phrase: "upper back", attrs: ["mu:upper_back", "mu:traps"] },
  { phrase: "mid back", attrs: ["mu:upper_back"] },
  { phrase: "lower back", attrs: ["mu:lower_back"] },
  { phrase: "inner thigh", attrs: ["mu:adductors"] },
  { phrase: "outer thigh", attrs: ["mu:abductors", "mu:glutes"] },
  { phrase: "delt", attrs: DELTS },
  { phrase: "shoulder", attrs: DELTS },
  { phrase: "chest", attrs: ["mu:chest"] },
  { phrase: "pec", attrs: ["mu:chest"] },
  { phrase: "lat", attrs: ["mu:lats"] },
  { phrase: "back", attrs: BACK },
  { phrase: "trap", attrs: ["mu:traps"] },
  { phrase: "tricep", attrs: ["mu:triceps"] },
  { phrase: "bicep", attrs: ["mu:biceps"] },
  { phrase: "forearm", attrs: ["mu:forearms"] },
  { phrase: "quad", attrs: ["mu:quads"] },
  { phrase: "hamstring", attrs: ["mu:hamstrings"], names: ["leg curl"] },
  { phrase: "glute", attrs: ["mu:glutes"] },
  { phrase: "butt", attrs: ["mu:glutes"] },
  { phrase: "calf", attrs: ["mu:calves"] },
  { phrase: "adductor", attrs: ["mu:adductors"] },
  { phrase: "groin", attrs: ["mu:adductors"] },
  { phrase: "abductor", attrs: ["mu:abductors"] },
  { phrase: "ab", attrs: ["mu:core"] },
  { phrase: "core", attrs: ["mu:core"] },
  { phrase: "oblique", attrs: ["mu:core"] },
  { phrase: "leg", attrs: LEGS },
  { phrase: "arm", attrs: ARMS },
];

/** Equipment words in a query (canonical) → the equipment tag they need. */
const EQUIPMENT_TERMS: Record<string, Attr[]> = {
  cable: ["eq:cable"],
  dumbbell: ["eq:dumbbell"],
  barbell: ["eq:barbell"],
  machine: ["eq:machine"],
  band: ["eq:band"],
  resistance: ["eq:band"],
  kettlebell: ["eq:kettlebell"],
  bodyweight: ["eq:bodyweight"],
  smith: ["eq:smith"],
  landmine: ["eq:landmine"],
  plate: ["eq:plate"],
  ezbar: ["eq:ezbar"],
  trapbar: ["eq:trapbar"],
  sled: ["eq:sled"],
  trx: ["eq:suspension"],
  suspension: ["eq:suspension"],
  bench: ["eq:bench"],
};

/** Words that refine an exercise without being its identity: met for a bonus, never required. */
const SOFT_TERMS: Record<string, Attr[]> = {
  rope: ["eq:cable"],
  handle: ["eq:cable"],
  attachment: [],
  grip: [],
  wide: [],
  close: [],
  narrow: [],
  neutral: [],
  underhand: [],
  overhand: [],
  supinated: [],
  pronated: [],
  stance: [],
  home: ["eq:dumbbell", "eq:bodyweight", "eq:band", "eq:kettlebell"],
  left: [],
  right: [],
  heavy: [],
  light: [],
  weighted: [],
};

/** Movement words → the movement pattern they mean. */
const PATTERN_TERMS: Record<string, Attr[]> = {
  pull: ["pt:horizontal_pull", "pt:vertical_pull"],
  push: ["pt:horizontal_push", "pt:vertical_push"],
  press: ["pt:horizontal_push", "pt:vertical_push"],
  row: ["pt:horizontal_pull"],
  pulldown: ["pt:vertical_pull"],
  hinge: ["pt:hip_hinge"],
  squat: ["pt:squat"],
  curl: ["pt:arms", "pt:hamstring_curl"],
  fly: ["pt:horizontal_push"],
  raise: [],
  isolation: [],
};

/** Words never needed to say what an exercise is. */
const GYM_NOISE = new Set(["gym", "exercise", "exercises", "movement", "lift"]);

/* ------------------------------------------------------------------ */
/* Descriptions                                                        */
/* ------------------------------------------------------------------ */

/** Filler in a described exercise ("that one where you…"). Never exercise words. */
const FILLER = new Set([
  "that",
  "this",
  "these",
  "those",
  "where",
  "which",
  "what",
  "who",
  "when",
  "while",
  "you",
  "your",
  "yours",
  "yourself",
  "i",
  "im",
  "me",
  "my",
  "it",
  "its",
  "is",
  "are",
  "was",
  "be",
  "do",
  "does",
  "doing",
  "done",
  "thing",
  "things",
  "exercise",
  "exercises",
  "movement",
  "move",
  "moves",
  "workout",
  "kind",
  "sort",
  "type",
  "like",
  "called",
  "name",
  "forgot",
  "remember",
  "some",
  "something",
  "can",
  "could",
  "would",
  "should",
  "will",
  "just",
  "really",
  "very",
  "get",
  "got",
  "go",
  "goes",
  "going",
  "keep",
  "keeping",
  "make",
  "makes",
  "using",
  "use",
  "uses",
  "have",
  "has",
  "had",
  "there",
  "then",
  "than",
  "so",
  "also",
  "again",
  "guy",
  "guys",
  "people",
  "work",
  "works",
  "working",
  "train",
  "trains",
  "training",
  "hit",
  "hits",
  "target",
  "targets",
  "help",
  "helps",
  "muscle",
  "muscles",
  "part",
  "them",
  "they",
  "their",
  "his",
  "her",
  "he",
  "she",
  "dont",
  "doesnt",
  "know",
  "think",
  "maybe",
  "kinda",
  "sorta",
  "up",
  "down",
  "out",
  "over",
  "off",
  "back and forth",
  "toward",
  "towards",
  "against",
  "between",
  "under",
  "above",
  "below",
  "through",
  "while",
  "each",
  "both",
  "hold",
  "holding",
  "held",
  "lift",
  "lifting",
  "lifts",
  "bring",
  "bringing",
  "brings",
  "weight",
  "weights",
  "position",
  "start",
  "starting",
  "end",
  "ending",
  "slowly",
  "slow",
  "fast",
  "time",
  "times",
  "rep",
  "reps",
  "set",
  "sets",
  "lie",
  "lay",
  "stand",
  "sit",
  "one",
  "body",
  "floor",
  "ground",
  "foot",
  "feet",
  "hand",
  "hands",
  "head",
  "face",
  "ceiling",
  "wall",
  "waist",
  "stomach",
  "belly",
  "navel",
  "torso",
  "hips",
  "ribs",
  "sternum",
  "collarbone",
  "chin",
  "ear",
  "ears",
  "sides",
  "behind",
  "way",
  "same",
  "time",
  "other",
  "another",
  "lot",
  "bit",
  "little",
]);

/** Words that mark a query as a description rather than a name. */
const DESCRIPTION_CUES = new Set([
  "you",
  "your",
  "that",
  "where",
  "which",
  "while",
  "when",
  "thing",
  "exercise",
  "movement",
  "called",
  "like",
  "toward",
  "towards",
]);

/** Plain-English cues → the movement they describe. `when` must also be in the text. */
const DESCRIPTION_RULES: Array<{ match: RegExp; when?: RegExp; unless?: RegExp; add: string }> = [
  {
    match:
      /\b(?:pull|pulling|pulls|bring|bringing)\s+(?:a\s+|the\s+|it\s+)?(?:bar\s+|handle\s+|cable\s+|weight\s+)?down(?:\s+(?:to|toward|towards)\s+(?:your\s+|the\s+|my\s+)?(?:chest|chin|collarbone|sternum))?\b|\bfrom above\b|\boverhead (?:cable|bar)\b/,
    add: "pulldown",
  },
  {
    match:
      /\b(?:to|toward|towards|into|in to)\s+(?:your\s+|the\s+|my\s+)?(?:waist|stomach|belly|navel|torso|hips?|abs|lower ribs|ribs)\b/,
    when: /\b(?:pull|pulling|pulls|row|rowing|bring|bringing|draw|drawing|tug)\b/,
    add: "row",
  },
  {
    match: /\b(?:to|toward|towards)\s+(?:your\s+|the\s+|my\s+)?(?:chest|sternum)\b/,
    when: /\b(?:pull|pulling|row|rowing|bring|bringing)\b/,
    unless: /\bpulldown\b|\bdown\b/,
    add: "row",
  },
  {
    match:
      /\bpull\w*\s+(?:yourself|your body|your chin|your chest)\s+(?:up|over|to)\b|\bchin over (?:the )?bar\b/,
    add: "pullup|chinup",
  },
  { match: /\bhang(?:ing|s)?\s+(?:from|on|off)\b/, add: "hanging" },
  {
    match: /\b(?:out to|to) (?:the|your) sides?\b|\barms? (?:out|up) (?:wide|to the side)\b/,
    when: /\b(?:raise|raising|lift|lifting|arms?|dumbbells?|weights?|cables?)\b/,
    add: "lateral raise",
  },
  {
    match: /\b(?:over|above) (?:your|the|my) head\b|\boverhead\b/,
    when: /\b(?:press|pressing|push|pushing)\b/,
    add: "overhead press",
  },
  {
    match: /\bbehind (?:your|the|my) head\b/,
    when: /\b(?:arms?|elbows?|extend|extending|straighten|tricep\w*)\b/,
    add: "overhead extension",
  },
  {
    match: /\b(?:on|onto) (?:your|the|my) back\b|\bface up\b/,
    when: /\b(?:lie|lying|laying|lay)\b/,
    add: "lying",
  },
  {
    match: /\bface down\b|\bon (?:your|the|my) (?:stomach|belly)\b|\bchest down\b|\bprone\b/,
    add: "prone",
  },
  { match: /\b(?:bend|bent|bending|hinged?|hinging)\s+over\b/, add: "bent over" },
  { match: /\bpush\w*\s+(?:your\s+|the\s+)?(?:hips|butt)\s+back\b|\bhip hinge\b/, add: "hinge" },
  {
    match:
      /\b(?:(?:push|pushing|drive|driving|lift|lifting|raise|raising|thrust|thrusting)\s+(?:your\s+|the\s+|my\s+)?)?(?:hips?|butt|pelvis)\s+(?:up|upward|to the ceiling)\b|\bbridge\b/,
    when: /\b(?:on|onto) (?:your|the|my) back\b|\blying\b|\blie\b|\bfloor\b/,
    add: "glute bridge|hip thrust",
  },
  {
    match:
      /\b(?:(?:push|pushing|drive|driving|lift|lifting|raise|raising|thrust|thrusting)\s+(?:your\s+|the\s+|my\s+)?)?(?:hips?|butt|pelvis)\s+(?:up|upward|to the ceiling)\b|\bbridge\b/,
    add: "hip thrust|glute bridge",
  },
  {
    match:
      /\b(?:dumbbell|kettlebell|weight|plate)\s+(?:at|against|in front of|to)\s+(?:your|the|my)\s+chest\b|\bat (?:your|my) chest\b/,
    when: /\bsquat/,
    add: "goblet",
  },
  { match: /\bon (?:one|your|the|my) side\b|\bsideways\b/, add: "side" },
  {
    match:
      /\b(?:onto|on) (?:your |the |my )?(?:toes|tiptoes|tip toes|balls of)\b|\bheels? (?:up|off)\b/,
    add: "calf raise",
  },
  {
    match:
      /\bcurl\w*\s+(?:your\s+|the\s+|my\s+)?legs?\b|\bheels? (?:to|toward|towards) (?:your |my )?(?:butt|glutes)\b/,
    add: "leg curl",
  },
  {
    match:
      /\b(?:straighten|straightening|extend|extending|kick|kicking)\s+(?:your\s+|the\s+|my\s+)?(?:legs?|knees?)\b/,
    add: "leg extension",
  },
  {
    match:
      /\b(?:straighten|straightening|extend|extending)\s+(?:your\s+|the\s+|my\s+)?(?:arms?|elbows?)\b/,
    add: "tricep extension",
  },
  { match: /\bshoulders? (?:up|to (?:your |my )?ears)\b/, add: "shrug" },
  { match: /\bstep\w*\s+(?:up|onto)\b/, add: "stepup" },
  {
    match:
      /\b(?:back|rear) foot (?:up|on|elevated)\b|\bfoot (?:up )?(?:on|behind) (?:a |the )?(?:bench|box|chair)\b/,
    add: "bulgarian split squat",
  },
  {
    match: /\b(?:squeeze|squeezing|pinch|pinching)\s+(?:your\s+|the\s+|my\s+)?shoulder blades\b/,
    add: "upper back",
  },
  {
    match: /\b(?:lower|lowering|dip|dipping)\s+(?:yourself|your body)\b/,
    when: /\b(?:bars?|bench|parallel|dip)\b/,
    add: "dip",
  },
  { match: /\b(?:on|from) (?:your |my )?knees\b|\bkneel\w*/, add: "kneeling" },
  { match: /\bwalk\w*\s+(?:with|holding|carrying)\b|\bcarry\w*\b/, add: "carry" },
  {
    match:
      /\bpush\w*\s+(?:the\s+|a\s+)?(?:weight|handles?|bar|it|dumbbells?)\s+(?:away|forward|out|up)\b/,
    add: "press",
  },
  { match: /\b(?:twist|twisting|rotate|rotating|rotation)\b/, add: "twist rotation" },
  { match: /\b(?:jump|jumping|hop|hopping)\b/, add: "jump" },
];

/** A query long and wordy enough to be a description, not a name. */
export function isDescriptiveQuery(raw: string): boolean {
  const words = normalizeText(raw).split(" ").filter(Boolean);
  if (words.length >= 6) return true;
  return words.length >= 4 && words.some((w) => DESCRIPTION_CUES.has(w));
}

/* ------------------------------------------------------------------ */
/* Query parsing                                                       */
/* ------------------------------------------------------------------ */

/**
 * A spelling that meets a term in a name. `rel`: "muscle" = a lift that is
 * that muscle's (side delt → lateral raise), never the same exercise;
 * "alternative" = a different exercise offered only when nothing matches.
 */
type Needle = {
  tokens: string[];
  synonym: boolean;
  label?: string;
  rel?: "muscle" | "alternative";
};

export type QueryTerm = {
  /** As typed (normalised), or the movement a description named. */
  token: string;
  /** Every spelling that counts as a name match, joined ("romanian deadlift"). */
  needles: string[];
  /** Exercise tags that also meet it ("eq:cable", "mu:side_delts", "pt:hip_hinge"). */
  attrs: string[];
  /** Refines (grip, rope…): adds when met, never required. */
  soft: boolean;
  /** Named by a description's cue ("toward your waist" → row). */
  injected: boolean;
};

type InternalTerm = QueryTerm & {
  canon: string;
  raw: string;
  parsedNeedles: Needle[];
  last: boolean;
  /** A description's posture or generic word: never required, whatever the pool's names say. */
  optional?: boolean;
  /** Names with any of these words are another movement ("row" never means an upright row). */
  notWith?: string[];
};

export type ParsedQuery = {
  raw: string;
  normalized: string;
  terms: QueryTerm[];
  /** A description, not a name: filler dropped, partial matches kept. */
  descriptive: boolean;
};

type Phrase = { tokens: string[]; needles: Needle[]; attrs: Attr[] };

let phraseTable: Phrase[] | null = null;
let phraseFirst: Map<string, Phrase[]> | null = null;

function buildPhrases(): void {
  const byKey = new Map<string, Phrase>();
  const get = (tokens: string[]): Phrase => {
    const key = tokens.join(" ");
    let p = byKey.get(key);
    if (!p) {
      p = { tokens, needles: [{ tokens, synonym: false }], attrs: [] };
      byKey.set(key, p);
    }
    return p;
  };
  const addNeedle = (p: Phrase, tokens: string[], label?: string, rel?: Needle["rel"]) => {
    const key = tokens.join(" ");
    if (p.needles.some((n) => n.tokens.join(" ") === key)) return;
    p.needles.push({ tokens, synonym: true, label, rel });
  };
  for (const group of EQUIVALENT_NAMES) {
    const members = group.map((m) => canonWords(m)).filter((m) => m.length > 0);
    for (const m of members) {
      const p = get(m);
      for (const other of members) if (other !== m) addNeedle(p, other, m.join(" "));
    }
  }
  for (const mt of MUSCLE_TERMS) {
    const tokens = canonWords(mt.phrase);
    const p = get(tokens);
    for (const a of mt.attrs) if (!p.attrs.includes(a)) p.attrs.push(a);
    for (const n of mt.names ?? []) addNeedle(p, canonWords(n), tokens.join(" "), "muscle");
  }
  for (const [name, others] of RELATED_NAMES) {
    const p = get(canonWords(name));
    for (const o of others) addNeedle(p, canonWords(o), name, "alternative");
  }
  phraseTable = Array.from(byKey.values());
  phraseFirst = new Map();
  for (const p of phraseTable) {
    const list = phraseFirst.get(p.tokens[0]) ?? [];
    list.push(p);
    list.sort((a, b) => b.tokens.length - a.tokens.length);
    phraseFirst.set(p.tokens[0], list);
  }
}

function phrasesStartingWith(token: string): Phrase[] {
  if (!phraseFirst) buildPhrases();
  return phraseFirst!.get(token) ?? [];
}

function applyDescriptionRules(text: string): { text: string; added: string[] } {
  let out = ` ${text} `;
  const added: string[] = [];
  for (const rule of DESCRIPTION_RULES) {
    if (rule.when && !rule.when.test(out)) continue;
    if (rule.unless && rule.unless.test(text)) continue;
    if (!rule.match.test(out)) continue;
    out = out.replace(rule.match, " ");
    added.push(rule.add);
  }
  return { text: out.replace(/\s+/g, " ").trim(), added };
}

function cleanDescriptionWords(norm: string): string {
  const toks = norm.split(" ");
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // "one" is filler, "one arm" / "one leg" isn't
    if (t === "one" && /^(arm|leg|hand|side|foot)/.test(toks[i + 1] ?? "")) {
      out.push(t);
      continue;
    }
    if (FILLER.has(t) || NOISE.has(t)) continue;
    out.push(t);
  }
  return out.join(" ");
}

function termsFrom(words: CanonWord[], injected: boolean, lastIsTyping: boolean): InternalTerm[] {
  const terms: InternalTerm[] = [];
  for (let i = 0; i < words.length; ) {
    const w = words[i];
    let phrase: Phrase | null = null;
    for (const p of phrasesStartingWith(w.word)) {
      if (p.tokens.every((t, k) => words[i + k]?.word === t)) {
        phrase = p;
        break;
      }
    }
    if (phrase) {
      const span = words.slice(i, i + phrase.tokens.length);
      const canon = phrase.tokens.join(" ");
      const eqAttrs =
        phrase.tokens.length === 1 ? (EQUIPMENT_TERMS[canon] ?? PATTERN_TERMS[canon] ?? []) : [];
      terms.push({
        token: span.map((s) => s.raw).join(" "),
        raw: span.map((s) => s.raw).join(" "),
        canon,
        needles: phrase.needles.map((n) => n.tokens.join(" ")),
        parsedNeedles: phrase.needles,
        attrs: Array.from(new Set([...phrase.attrs, ...eqAttrs])),
        soft: false,
        injected,
        last: false,
      });
      i += phrase.tokens.length;
      continue;
    }
    const canon = w.word;
    const soft = canon in SOFT_TERMS;
    const attrs = soft ? SOFT_TERMS[canon] : (EQUIPMENT_TERMS[canon] ?? PATTERN_TERMS[canon] ?? []);
    terms.push({
      token: w.raw,
      raw: w.raw,
      canon,
      needles: [canon],
      parsedNeedles: [{ tokens: [canon], synonym: false }],
      attrs,
      soft,
      injected,
      last: false,
    });
    i += 1;
  }
  if (lastIsTyping && terms.length) terms[terms.length - 1].last = true;
  // the same word twice counts once
  const seen = new Set<string>();
  return terms.filter((t) => (seen.has(t.canon) ? false : (seen.add(t.canon), true)));
}

/** Postures in a description refine, they don't name the exercise. */
const POSTURES = new Set(["seated", "standing", "kneeling", "lying", "supine", "prone"]);
/** Things a description mentions that every other exercise has too. */
const GENERIC_NOUNS = new Set(["bar", "handle", "weight", "pad", "seat"]);
/** Verbs a description's cue already covers. */
const DESCRIPTION_SOFT = new Set([
  ...POSTURES,
  "push",
  "pull",
  "press",
  "raise",
  "lift",
  "hold",
  "move",
]);

/** A movement a description named that isn't one known phrase ("glute bridge"): one term, all its words. */
function injectedPhrase(text: string): InternalTerm {
  const words = canonWordsWithRaw(text);
  const tokens = words.map((w) => w.word);
  return {
    token: text,
    raw: text,
    canon: tokens.join(" "),
    needles: [tokens.join(" ")],
    parsedNeedles: [{ tokens, synonym: false }],
    attrs: [],
    soft: false,
    injected: true,
    last: false,
  };
}

const parseCache = new Map<string, { parsed: ParsedQuery; terms: InternalTerm[] }>();

function parseInternal(raw: string): { parsed: ParsedQuery; terms: InternalTerm[] } {
  const hit = parseCache.get(raw);
  if (hit) return hit;
  const normalized = normalizeText(raw);
  const descriptive = isDescriptiveQuery(raw);
  let text = normalized;
  let added: string[] = [];
  if (descriptive) {
    const r = applyDescriptionRules(normalized);
    added = r.added;
    text = cleanDescriptionWords(r.text);
  }
  const typing = !/\s$/.test(raw);
  const all = canonWordsWithRaw(text);
  // "exercise", "lift" and "gym" never name an exercise (unless that's all that was typed)
  const words = descriptive ? all : all.filter((w) => !GYM_NOISE.has(w.word) || all.length === 1);
  const terms = termsFrom(words, false, typing && !descriptive);
  if (added.length) {
    const have = new Set(terms.map((t) => t.canon));
    for (const add of added) {
      // "a|b": one movement that goes by either name (pull-up or chin-up)
      const [first, ...rest] = add.split("|");
      const found = termsFrom(canonWordsWithRaw(first), true, false);
      const t = found.length === 1 ? found[0] : injectedPhrase(first);
      if (have.has(t.canon)) continue;
      have.add(t.canon);
      if (rest.length) {
        t.parsedNeedles = [
          ...t.parsedNeedles,
          ...rest.map((r) => ({ tokens: canonWords(r), synonym: true })),
        ];
        t.needles = t.parsedNeedles.map((n) => n.tokens.join(" "));
      }
      terms.push(t);
    }
    // the cue already said how it moves: "push" / "pull" only refine it
    for (const t of terms)
      if (!t.injected && DESCRIPTION_SOFT.has(t.canon)) t.soft = t.optional = true;
  }
  if (descriptive) {
    for (const t of terms) {
      if (POSTURES.has(t.canon) || GENERIC_NOUNS.has(t.canon)) t.soft = t.optional = true;
      // "that back exercise…": the muscle it works refines it; it's not a word in its name
      // ("Straight Back Seated High Row" is no answer for a row to the waist)
      const muscle = !t.injected && t.attrs.length > 0 && t.attrs.every((a) => a.startsWith("mu:"));
      if (muscle && terms.some((o) => o.injected)) t.soft = t.optional = true;
    }
  }
  // a row is a pull to the body; an upright row is a shoulder raise (unless that's what was typed)
  if (!terms.some((t) => t.canon.split(" ").includes("upright"))) {
    for (const t of terms) if (t.canon === "row") t.notWith = ["upright"];
  }
  const parsed: ParsedQuery = {
    raw,
    normalized,
    descriptive,
    terms: terms.map(({ token, needles, attrs, soft, injected }) => ({
      token,
      needles,
      attrs,
      soft,
      injected,
    })),
  };
  const out = { parsed, terms };
  if (parseCache.size > 200) parseCache.clear();
  parseCache.set(raw, out);
  return out;
}

export function parseQuery(raw: string): ParsedQuery {
  return parseInternal(raw).parsed;
}

/** Public read-only view of the gym shorthand understood (tests, "why it matched"). */
export const EXERCISE_TOKEN_ALIASES: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries([
    ...Object.entries(WORD_CANON).map(([k, v]) => [k, [v]] as const),
    ...EQUIVALENT_NAMES.flatMap((g) =>
      g.filter((m) => ABBREVIATIONS.has(m)).map((m) => [m, g.filter((x) => x !== m)] as const),
    ),
  ]);

/* ------------------------------------------------------------------ */
/* Fuzzy matching                                                      */
/* ------------------------------------------------------------------ */

/**
 * Bounded edit distance (optimal string alignment: a swapped pair of letters,
 * "bulgarain", is one slip, not two). Returns `max + 1` as soon as it's
 * clearly worse.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = new Array(b.length + 1);
  let cur: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[b.length] > max ? max + 1 : prev[b.length];
}

/** Typo tolerance scales with word length: 4-6 chars → 1 edit, 7+ → 2. */
function fuzzyBudget(token: string): number {
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Exercise index                                                      */
/* ------------------------------------------------------------------ */

type NameVariant = {
  /** The text this variant reads (name or alias). */
  label: string;
  isAlias: boolean;
  norm: string;
  words: string[];
  raws: string[];
  set: Set<string>;
  /** Word indices that say which side / camera angle (not identity). */
  view: Set<number>;
  hasDirection: boolean;
};

type Indexed = {
  version: number;
  variants: NameVariant[];
  attrs: Set<Attr>;
  viewWords: boolean;
  /** A stretch, mobility drill or yoga pose: not what a strength search is after unless asked. */
  mobility: boolean;
};

const indexCache = new WeakMap<object, Indexed>();

function makeVariant(label: string, isAlias: boolean): NameVariant {
  const cw = canonWordsWithRaw(label);
  const words = cw.map((w) => w.word);
  const view = new Set<number>();
  words.forEach((w, i) => {
    if (VIEW_WORDS.has(w)) view.add(i);
    if (/^\d+$/.test(w) && i > 0 && (words[i - 1] === "version" || words[i - 1] === "v"))
      view.add(i);
  });
  const norm = normalizeText(label);
  return {
    label,
    isAlias,
    norm,
    words,
    raws: cw.map((w) => w.raw),
    set: new Set(words),
    view,
    hasDirection: /(^| )to( |$)/.test(norm),
  };
}

const MUSCLE_TEXT: Array<[string, Attr[]]> = [
  ["side delt", ["mu:side_delts"]],
  ["rear delt", ["mu:rear_delts"]],
  ["front delt", ["mu:front_delts"]],
  ["upper back", ["mu:upper_back"]],
  ["lower back", ["mu:lower_back"]],
  ["lat", ["mu:lats"]],
  ["quad", ["mu:quads"]],
  ["hamstring", ["mu:hamstrings"]],
  ["glute", ["mu:glutes"]],
  ["calf", ["mu:calves"]],
  ["adductor", ["mu:adductors"]],
  ["abductor", ["mu:abductors"]],
  ["tricep", ["mu:triceps"]],
  ["bicep", ["mu:biceps"]],
  ["forearm", ["mu:forearms"]],
  ["trap", ["mu:traps"]],
  ["chest", ["mu:chest"]],
  ["ab", ["mu:core"]],
  ["core", ["mu:core"]],
  ["oblique", ["mu:core"]],
  ["shoulder", DELTS],
  ["back", ["mu:lats", "mu:upper_back"]],
  ["leg", ["mu:quads", "mu:hamstrings", "mu:glutes"]],
  ["arm", ARMS],
  ["abdominal", ["mu:core"]],
  ["neck", ["mu:neck"]],
];

const FAMILY_ATTRS: Record<string, Attr[]> = {
  "lateral raise": ["mu:side_delts"],
  "rear delt": ["mu:rear_delts"],
  "front raise": ["mu:front_delts"],
  "leg curl": ["mu:hamstrings", "pt:hamstring_curl"],
  "leg extension": ["mu:quads", "pt:knee_extension"],
  "calf raise": ["mu:calves"],
  "hip adduction": ["mu:adductors"],
  "glute isolation": ["mu:glutes"],
  row: ["pt:horizontal_pull"],
  "pulldown pullup": ["pt:vertical_pull"],
  deadlift: ["pt:hip_hinge"],
  "hip hinge": ["pt:hip_hinge"],
  squat: ["pt:squat"],
  "chest fly": ["mu:chest"],
  "chest press": ["mu:chest", "pt:horizontal_push"],
  "bench press": ["mu:chest", "pt:horizontal_push"],
  "overhead press": ["pt:vertical_push"],
  "triceps extension": ["mu:triceps"],
  curl: ["mu:biceps"],
  "shrug carry": ["mu:traps"],
  "upright row": ["mu:side_delts"],
  "back extension": ["mu:lower_back", "pt:hip_hinge"],
  "hip thrust": ["mu:glutes"],
  "lunge split squat": ["pt:squat"],
  pushup: ["mu:chest", "pt:horizontal_push"],
};

/** Tags read from the exercise's equipment, muscles, movement and its own name. */
function exerciseAttrs(ex: SearchableExercise, name: NameVariant): Set<Attr> {
  const attrs = new Set<Attr>();
  const addMuscleText = (text: string | null | undefined) => {
    if (!text) return;
    const parts = String(text).split(/[,/&]+/);
    for (const part of parts) {
      const words = canonWords(part).join(" ");
      if (!words) continue;
      for (const [key, as] of MUSCLE_TEXT) {
        if (` ${words} `.includes(` ${key} `)) {
          as.forEach((a) => attrs.add(a));
          if (key.includes(" ")) break;
        }
      }
    }
  };
  for (const m of ex.muscle_groups ?? []) if (m && m !== "other") attrs.add(`mu:${m}`);
  for (const m of ex.secondary_muscle_groups ?? []) if (m && m !== "other") attrs.add(`mu2:${m}`);
  addMuscleText(ex.muscle_group);
  addMuscleText(ex.primary_muscle_group);
  for (const t of ex.tags ?? []) addMuscleText(t);
  const cat = normalizeText(ex.category);
  if (cat) {
    if (cat.includes("back")) BACK.slice(0, 2).forEach((a) => attrs.add(a));
    if (cat.includes("chest")) attrs.add("mu:chest");
    if (cat.includes("shoulder")) DELTS.forEach((a) => attrs.add(a));
    if (cat.includes("bicep")) attrs.add("mu:biceps");
    if (cat.includes("tricep")) attrs.add("mu:triceps");
    if (cat.includes("abdominal") || cat === "core") attrs.add("mu:core");
    if (cat.includes("forearm")) attrs.add("mu:forearms");
    if (cat.includes("glute")) attrs.add("mu:glutes");
  }
  const fam = canonWords(ex.exercise_family).join(" ");
  if (fam && FAMILY_ATTRS[fam]) FAMILY_ATTRS[fam].forEach((a) => attrs.add(a));
  const pattern = normalizeText(ex.primary_movement_pattern).replace(/ /g, "_");
  if (pattern && pattern !== "other") attrs.add(`pt:${pattern}`);
  // equipment: the library's field, then what the name says
  for (const part of String(ex.equipment ?? "").split(",")) {
    for (const w of canonWords(part)) {
      if (EQUIPMENT_TERMS[w]) EQUIPMENT_TERMS[w].forEach((a) => attrs.add(a));
      if (w === "smith") attrs.add("eq:machine");
    }
  }
  const s = name.set;
  for (const w of name.words)
    if (EQUIPMENT_TERMS[w] && w !== "bench") EQUIPMENT_TERMS[w].forEach((a) => attrs.add(a));
  if (
    s.has("smith") ||
    (s.has("leg") && (s.has("press") || s.has("curl") || s.has("extension"))) ||
    (s.has("pec") && s.has("deck")) ||
    s.has("pendulum") ||
    (s.has("hack") && s.has("squat"))
  )
    attrs.add("eq:machine");
  if (s.has("row") && !s.has("upright")) attrs.add("pt:horizontal_pull");
  if (s.has("pulldown") || s.has("pullup") || s.has("chinup")) attrs.add("pt:vertical_pull");
  if (
    s.has("deadlift") ||
    s.has("rdl") ||
    (s.has("good") && s.has("morning")) ||
    s.has("pullthrough")
  )
    attrs.add("pt:hip_hinge");
  if ((s.has("squat") || s.has("lunge")) && !s.has("jump")) attrs.add("pt:squat");
  if ((s.has("lateral") && s.has("raise")) || (s.has("upright") && s.has("row")))
    attrs.add("mu:side_delts");
  if (s.has("rear") && (s.has("delt") || s.has("fly"))) attrs.add("mu:rear_delts");
  if (s.has("face") && s.has("pull")) attrs.add("mu:rear_delts");
  if (s.has("shrug")) attrs.add("mu:traps");
  if (s.has("pushdown") || s.has("skullcrusher") || s.has("kickback")) attrs.add("mu:triceps");
  return attrs;
}

function indexOf(ex: SearchableExercise): Indexed {
  const cached = indexCache.get(ex);
  if (cached && cached.version === aliasVersion) return cached;
  const main = makeVariant(ex.name ?? "", false);
  const variants = [main];
  for (const alias of aliasesFor(ex)) {
    const v = makeVariant(alias, true);
    if (v.words.length) variants.push(v);
  }
  const mobility = /\b(?:stretch|stretching|mobility|yoga|pose|warm up|warmup|foam roll)/.test(
    `${main.norm} ${normalizeText(ex.category)} ${normalizeText(ex.muscle_group)} ${normalizeText(ex.exercise_family)}`,
  );
  const idx: Indexed = {
    version: aliasVersion,
    variants,
    attrs: exerciseAttrs(ex, main),
    viewWords: main.view.size > 0,
    mobility,
  };
  indexCache.set(ex, idx);
  return idx;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export type TermMatchKind =
  | "exact-word"
  | "synonym"
  | "prefix"
  | "glued"
  | "fuzzy"
  | "equipment"
  | "muscle"
  | "pattern"
  | "none";

const KIND_WEIGHT: Record<TermMatchKind, number> = {
  "exact-word": 100,
  synonym: 90,
  glued: 90,
  prefix: 76,
  fuzzy: 62,
  equipment: 52,
  muscle: 46,
  pattern: 42,
  none: 0,
};

const NAME_KINDS = new Set<TermMatchKind>(["exact-word", "synonym", "prefix", "glued", "fuzzy"]);

/**
 * Deterministic ranking tiers. Tier ALWAYS beats score, so no
 * recommendation / muscle / equipment similarity signal can outrank an
 * explicit text match while the user is actively typing.
 */
export const SEARCH_TIER = {
  exactName: 0,
  tokenEquivalent: 1,
  namePrefix: 2,
  orderedTokens: 3,
  allTokensInName: 4,
  nameSubstring: 5,
  metadataComplete: 6,
  partial: 7,
} as const;
export type SearchTier = (typeof SEARCH_TIER)[keyof typeof SEARCH_TIER];

export type ScoredExercise<T extends SearchableExercise = SearchableExercise> = {
  exercise: T;
  score: number;
  /** Deterministic rank bucket — lower is stronger. */
  tier: SearchTier;
  /** True when every (required) query term matched something. */
  complete: boolean;
  /** Literal strings to highlight inside the name. */
  highlights: string[];
  /** e.g. "RDL = romanian deadlift" — only set when an alias/synonym/tag carried the match. */
  reason?: string;
  /** Share of the query's weight this exercise met (0-1). */
  share: number;
  /** A different exercise offered because the one asked for isn't in the list. */
  alternative?: boolean;
};

type TermMatch = {
  kind: TermMatchKind;
  weight: number;
  idx: number[];
  reason?: string;
  loose?: boolean;
  alternative?: boolean;
};

const NO_MATCH: TermMatch = { kind: "none", weight: 0, idx: [] };

/** Per query term, the pool's name words it's a prefix of / a slip away from (worked out once per search). */
type TermLookup = { prefix: Map<string, number>; fuzzy: Map<string, number> };

function matchTerm(
  term: InternalTerm,
  v: NameVariant,
  attrs: Set<Attr>,
  look?: TermLookup,
): TermMatch {
  let best: TermMatch = NO_MATCH;
  if (term.notWith?.some((w) => v.set.has(w))) return NO_MATCH;
  // 1. the words, or an equivalent name, in the name
  for (let k = 0; k < term.parsedNeedles.length; k++) {
    const n = term.parsedNeedles[k];
    if (!n.tokens.every((t) => v.set.has(t))) continue;
    const idx = n.tokens.map((t) => v.words.indexOf(t));
    const together = idx.every((p, j) => j === 0 || p === idx[j - 1] + 1);
    // another name for it must read as one phrase ("side raise", never "Side Plank … Raise")
    if (n.synonym && n.tokens.length > 1 && !together) continue;
    const kind: TermMatchKind = n.synonym ? "synonym" : "exact-word";
    // the usual meaning first ("OHP" is an overhead press before a military press)
    let weight = KIND_WEIGHT[kind] - (n.synonym ? Math.min(6, (k - 1) * 2) : 0);
    if (n.rel === "muscle") weight = 84;
    if (n.rel === "alternative") weight = 70;
    if (n.tokens.length > 1 && together) weight += 4;
    if (weight > best.weight) {
      best = {
        kind,
        weight,
        idx,
        loose: !!n.rel,
        alternative: n.rel === "alternative",
        reason:
          n.rel === "alternative"
            ? `Similar to ${n.label ?? term.raw}`
            : n.synonym && ABBREVIATIONS.has(term.canon)
              ? `${term.raw.toUpperCase()} = ${n.tokens.join(" ")}`
              : undefined,
      };
    }
  }
  if (best.kind === "exact-word") return best;
  // 2. a half-typed word ("pulld", "lateral ra")
  const minPrefix = term.last ? 2 : 3;
  if (best.kind === "none" && term.parsedNeedles[0].tokens.length === 1) {
    const t = term.canon;
    const r = term.raw;
    if (t.length >= minPrefix || r.length >= minPrefix) {
      for (let i = 0; i < v.words.length; i++) {
        const w = v.words[i];
        const raw = v.raws[i];
        if (look) {
          const extra = look.prefix.get(w);
          // the closest completion first ("pres" is press before preacher)
          const weight = extra === undefined ? 0 : KIND_WEIGHT.prefix - Math.min(10, extra * 2);
          if (weight > best.weight) best = { kind: "prefix", weight, idx: [i] };
          continue;
        }
        const typedAsCanon = r.replace(/ /g, "") === t;
        if (
          (typedAsCanon && t.length >= minPrefix && w.startsWith(t) && w !== t) ||
          (r.length >= minPrefix &&
            raw.replace(/ /g, "").startsWith(r.replace(/ /g, "")) &&
            raw !== r)
        ) {
          best = { kind: "prefix", weight: KIND_WEIGHT.prefix, idx: [i] };
          break;
        }
      }
    }
  }
  // 3. two name words typed as one ("hipthrust", "legpress")
  if (best.kind === "none" && term.canon.length >= 6 && !term.canon.includes(" ")) {
    for (let i = 0; i + 1 < v.words.length; i++) {
      if (v.words[i] + v.words[i + 1] === term.canon) {
        best = { kind: "glued", weight: KIND_WEIGHT.glued, idx: [i, i + 1] };
        break;
      }
    }
  }
  // 4. a slip of the keyboard ("latteral", "romainian", "bulgarain")
  if (best.kind === "none") {
    const tokens = term.parsedNeedles[0].tokens;
    if (tokens.length === 1) {
      const t = tokens[0];
      const budget = fuzzyBudget(t);
      if (budget > 0) {
        let bestD = budget + 1;
        let at = -1;
        for (let i = 0; i < v.words.length; i++) {
          const w = v.words[i];
          if (look) {
            const d = look.fuzzy.get(w);
            if (d !== undefined && d < bestD) {
              bestD = d;
              at = i;
            }
            continue;
          }
          if (
            w.length < 3 ||
            Math.abs(w.length - t.length) > budget ||
            (w[0] !== t[0] && budget < 2)
          )
            continue;
          const d = editDistance(w, t, budget);
          if (d < bestD) {
            bestD = d;
            at = i;
          }
        }
        if (at >= 0)
          best = { kind: "fuzzy", weight: KIND_WEIGHT.fuzzy - (bestD - 1) * 8, idx: [at] };
      }
    }
  }
  // 5. the library's tags: equipment, muscle, movement
  if (best.kind === "none" && term.attrs.length) {
    for (const a of term.attrs) {
      if (!attrs.has(a)) continue;
      const kind: TermMatchKind = a.startsWith("eq:")
        ? "equipment"
        : a.startsWith("mu:")
          ? "muscle"
          : "pattern";
      if (KIND_WEIGHT[kind] > best.weight) {
        best = {
          kind,
          weight: KIND_WEIGHT[kind],
          idx: [],
          reason: `${kind === "equipment" ? "Equipment" : kind === "muscle" ? "Muscle" : "Movement"}: ${term.raw}`,
        };
      }
    }
  }
  return best;
}

type QueryInfo = {
  parsed: ParsedQuery;
  terms: InternalTerm[];
  hard: InternalTerm[];
  canonSorted: string;
  canonSeq: string;
  totalWeight: number;
  lookups?: Map<InternalTerm, TermLookup>;
  /** Terms that only refine: grip / attachment words no name in the pool uses. */
  soft: Set<InternalTerm>;
  /** The query asks for a stretch / mobility work. */
  mobility: boolean;
};

/**
 * The prefix and typo candidates for each term, read once from every name
 * word in the pool instead of per exercise (a phone stays well under a frame).
 */
function buildLookups(
  q: QueryInfo,
  list: readonly SearchableExercise[],
): { lookups: Map<InternalTerm, TermLookup>; soft: Set<InternalTerm> } {
  const vocab = new Map<string, string>(); // canonical word → its raw text
  for (const ex of list) {
    for (const v of indexOf(ex).variants) {
      for (let i = 0; i < v.words.length; i++)
        if (!vocab.has(v.words[i])) vocab.set(v.words[i], v.raws[i]);
    }
  }
  const out = new Map<InternalTerm, TermLookup>();
  const soft = new Set<InternalTerm>();
  for (const term of q.terms) {
    // a grip or attachment word a name in the pool says is required, like any other
    if (term.optional || (term.soft && !vocab.has(term.canon))) soft.add(term);
    const look: TermLookup = { prefix: new Map(), fuzzy: new Map() };
    const tokens = term.parsedNeedles[0].tokens;
    const minPrefix = term.last ? 2 : 3;
    const t = term.canon;
    const r = term.raw;
    const budget = tokens.length === 1 ? fuzzyBudget(tokens[0]) : 0;
    for (const [w, raw] of vocab) {
      if (tokens.length === 1) {
        // a half-typed word, as typed ("lats" is the muscle, never the start of "lateral")
        const typedAsCanon = r.replace(/ /g, "") === t;
        if (
          (typedAsCanon && t.length >= minPrefix && w.startsWith(t) && w !== t) ||
          (r.length >= minPrefix &&
            raw.replace(/ /g, "").startsWith(r.replace(/ /g, "")) &&
            raw !== r)
        ) {
          look.prefix.set(w, Math.max(0, w.length - t.length));
        }
      }
      if (
        budget > 0 &&
        w.length >= 3 &&
        Math.abs(w.length - tokens[0].length) <= budget &&
        (w[0] === tokens[0][0] || budget >= 2)
      ) {
        const d = editDistance(w, tokens[0], budget);
        if (d > 0 && d <= budget) look.fuzzy.set(w, d);
      }
    }
    // a word the library spells this way (or starts with) is never read as a slip ("spoto" isn't "spot")
    if (vocab.has(t) || look.prefix.size > 0) look.fuzzy.clear();
    out.set(term, look);
  }
  return { lookups: out, soft };
}

function queryInfo(raw: string): QueryInfo {
  const { parsed, terms } = parseInternal(raw);
  const soft = new Set(terms.filter((t) => t.soft));
  const hard = terms.filter((t) => !t.soft);
  const literal = terms.filter((t) => !t.injected).flatMap((t) => t.parsedNeedles[0].tokens);
  return {
    parsed,
    terms,
    hard,
    canonSeq: literal.join(" "),
    canonSorted: [...literal].sort().join(" "),
    totalWeight: terms.reduce((s, t) => s + (t.soft ? 0.5 : t.injected ? 1.4 : 1) * 100, 0),
    soft,
    mobility: /\b(?:stretch|mobility|yoga|pose|warm|foam|loosen)/.test(parsed.normalized),
  };
}

function scoreVariant<T extends SearchableExercise>(
  exercise: T,
  q: QueryInfo,
  v: NameVariant,
  idx: Indexed,
  boost: number,
): ScoredExercise<T> | null {
  const explained = new Set<number>();
  const literalExplained = new Set<number>();
  const firstPos: number[] = [];
  const highlights: string[] = [];
  let weight = 0;
  let matchedHard = 0;
  let matchedAny = 0;
  let nameAll = true;
  let exactAll = true;
  let alternative = false;
  let reason: string | undefined;
  for (const term of q.terms) {
    const isSoft = q.soft.has(term);
    const m = matchTerm(term, v, idx.attrs, q.lookups?.get(term));
    if (m.kind === "none") {
      if (!isSoft) nameAll = false;
      if (!isSoft) exactAll = false;
      continue;
    }
    matchedAny += 1;
    if (!isSoft) matchedHard += 1;
    weight += m.weight * (isSoft ? 0.5 : term.injected ? 1.4 : 1);
    const isName = NAME_KINDS.has(m.kind);
    if (m.alternative) alternative = true;
    if (!isSoft) {
      if (!isName || m.alternative) nameAll = false;
      if ((m.kind !== "exact-word" && m.kind !== "synonym" && m.kind !== "glued") || m.loose)
        exactAll = false;
    }
    for (const i of m.idx) {
      // a muscle's usual lift or an alternative doesn't make the name what was asked for
      if (!m.loose) explained.add(i);
      if (m.kind === "exact-word" || m.kind === "synonym" || m.kind === "glued")
        literalExplained.add(i);
      if (v.raws[i]) highlights.push(v.raws[i]);
    }
    if (m.idx.length) firstPos.push(Math.min(...m.idx));
    // why it matched, for what was asked (never a description's refining words)
    if (!reason && m.reason && !isSoft) reason = m.reason;
  }
  if (matchedAny === 0) return null;
  const hardCount = q.hard.length;
  const complete = hardCount > 0 ? matchedHard === hardCount : matchedAny > 0;
  const meaningful = v.words.length - v.view.size;
  let covered = 0;
  for (const i of explained) if (!v.view.has(i)) covered += 1;
  let literalCovered = 0;
  for (const i of literalExplained) if (!v.view.has(i)) literalCovered += 1;
  const ordered = firstPos.every((p, k) => k === 0 || p > firstPos[k - 1]);

  // view words ("Left", "Side View") the query didn't ask for
  const askedView = q.terms.some((t) => VIEW_WORDS.has(t.canon) || t.canon === "side");
  const viewPenalty = v.view.size > 0 && !askedView ? 90 : 0;
  const mobilityPenalty = idx.mobility && !q.mobility ? 70 : 0;

  let tier: SearchTier;
  const qn = q.parsed.normalized;
  const literalQuery = q.terms.every((t) => !t.injected);
  if (literalQuery && qn && v.norm === qn) tier = SEARCH_TIER.exactName;
  else if (
    complete &&
    nameAll &&
    exactAll &&
    literalCovered >= meaningful &&
    meaningful > 0 &&
    (!v.hasDirection ||
      v.words.join(" ") === q.canonSeq ||
      [...v.words].sort().join(" ") !== q.canonSorted)
  )
    tier = SEARCH_TIER.tokenEquivalent;
  else if (complete && nameAll && literalQuery && qn.length >= 3 && v.norm.startsWith(qn))
    tier = SEARCH_TIER.namePrefix;
  else if (complete && nameAll)
    tier = ordered ? SEARCH_TIER.orderedTokens : SEARCH_TIER.allTokensInName;
  else if (complete) tier = SEARCH_TIER.metadataComplete;
  else tier = SEARCH_TIER.partial;

  let score = weight;
  if (complete) score += 220;
  // How much of the name the query explains: each word it doesn't say costs
  // ("Cable Lateral Raises" over "Lateral Raise To Shoulder Press … Cable").
  score -= Math.max(0, meaningful - covered) * 55;
  if (ordered && firstPos.length > 1) score += 30;
  if (tier === SEARCH_TIER.exactName) score += 1200;
  else if (tier === SEARCH_TIER.tokenEquivalent) score += 600;
  else if (tier === SEARCH_TIER.namePrefix) score += 40;
  // Prefer concise names when scores tie ("Leg Curl" over "Seated Leg Curl Machine Variation").
  score += Math.max(0, 40 - meaningful * 4);
  score -= viewPenalty + mobilityPenalty;
  if (v.isAlias) score -= 15;
  score += boost * 120;
  if (v.isAlias && !reason) reason = `Also known as “${v.label}”`;

  return {
    exercise,
    score: Math.round(score),
    tier,
    complete,
    highlights: v.isAlias ? [] : highlights,
    reason,
    share: Math.min(1, weight / Math.max(1, q.totalWeight)),
    alternative: alternative || undefined,
  };
}

function betterMatch<T extends SearchableExercise>(
  a: ScoredExercise<T>,
  b: ScoredExercise<T>,
): boolean {
  if (a.tier !== b.tier) return a.tier < b.tier;
  if (a.complete !== b.complete) return a.complete;
  return a.score > b.score;
}

function scoreWith<T extends SearchableExercise>(
  exercise: T,
  q: QueryInfo,
  boost = 0,
): ScoredExercise<T> | null {
  if (q.terms.length === 0) {
    return {
      exercise,
      score: 0,
      tier: SEARCH_TIER.partial,
      complete: true,
      highlights: [],
      share: 0,
    };
  }
  const idx = indexOf(exercise);
  let best: ScoredExercise<T> | null = null;
  for (const v of idx.variants) {
    const cand = scoreVariant(exercise, q, v, idx, boost);
    if (cand && (!best || betterMatch(cand, best))) best = cand;
  }
  return best;
}

export function scoreExercise<T extends SearchableExercise>(
  exercise: T,
  query: ParsedQuery | string,
): ScoredExercise<T> | null {
  return scoreWith(exercise, queryInfo(typeof query === "string" ? query : query.raw));
}

/* ------------------------------------------------------------------ */
/* Public search API                                                   */
/* ------------------------------------------------------------------ */

export type SearchResult<T extends SearchableExercise> = {
  /** Ranked matches, best first. Complete matches always outrank partials. */
  results: ScoredExercise<T>[];
  /** Terms to highlight (the name words each result matched). */
  highlightTerms: string[];
  /** False when nothing matched every term — UI shows "closest results". */
  hasExactMatches: boolean;
  /** True when the best result matched by name (not only tags or a description). */
  confident: boolean;
  parsed: ParsedQuery;
};

export type SearchOptions = {
  limit?: number;
  /**
   * Exercises to lift among equals (0-1): the person's recent ones, the
   * program's own. Only ever breaks ties inside a tier.
   */
  boost?: ReadonlyMap<string, number> | null;
};

/** Sort bucket: 2-5 are one group (all in the name) ranked by score, so how much of a name the query explains beats word order. */
function group(tier: SearchTier): number {
  return tier <= 1 ? tier : tier <= 5 ? 3 : tier;
}

/**
 * Rank `list` against `query`. Pure and synchronous — call it inside a
 * `useMemo` keyed on the query and the list identity.
 */
export function searchExercises<T extends SearchableExercise>(
  list: readonly T[],
  query: string,
  opts: SearchOptions = {},
): SearchResult<T> {
  let q = queryInfo(query);
  const limit = opts.limit ?? 100;
  if (q.terms.length === 0) {
    return {
      results: list.slice(0, limit).map((exercise) => ({
        exercise,
        score: 0,
        tier: SEARCH_TIER.partial,
        complete: true,
        highlights: [],
        share: 0,
      })),
      highlightTerms: [],
      hasExactMatches: true,
      confident: false,
      parsed: q.parsed,
    };
  }

  {
    const { lookups, soft } = buildLookups(q, list);
    const hard = q.terms.filter((t) => !soft.has(t));
    q = {
      ...q,
      lookups,
      soft,
      hard,
      totalWeight: q.terms.reduce(
        (s, t) => s + (soft.has(t) ? 0.5 : t.injected ? 1.4 : 1) * 100,
        0,
      ),
    };
  }
  const scored: ScoredExercise<T>[] = [];
  for (const ex of list) {
    const s = scoreWith(ex, q, opts.boost?.get(ex.id) ?? 0);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => {
    const g = group(a.tier) - group(b.tier);
    if (g !== 0) return g;
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.exercise.name.localeCompare(b.exercise.name);
  });

  const anyComplete = scored.some((s) => s.complete && !s.alternative);
  let kept: ScoredExercise<T>[];
  if (anyComplete) {
    // Something matches every term: loosely related exercises only bury it.
    kept = scored.filter((s) => s.complete && !s.alternative);
  } else if (scored.some((s) => s.complete)) {
    // Not in the list: the closest alternatives, said to be alternatives.
    kept = scored.filter((s) => s.complete);
  } else {
    // Nothing matches it all: the closest, by how much of the query each meets.
    const need = q.parsed.descriptive ? 0.3 : 0.5;
    kept = scored
      .filter((s) => s.share >= need)
      .sort((a, b) => b.share - a.share || b.score - a.score)
      .slice(0, 30);
  }

  const highlightTerms = new Set<string>();
  for (const term of q.terms) if (!term.injected) highlightTerms.add(term.raw);
  for (const s of kept.slice(0, limit)) for (const h of s.highlights) highlightTerms.add(h);
  const top = kept[0];

  return {
    results: kept.slice(0, limit),
    highlightTerms: Array.from(highlightTerms),
    hasExactMatches: anyComplete,
    confident: !!top && top.complete && top.tier <= SEARCH_TIER.nameSubstring,
    parsed: q.parsed,
  };
}

/**
 * Swap-search contract: search the complete eligible pool before applying the
 * result limit. Browsing recommendation/equipment filters are intentionally
 * absent here, so the default "Best Match" state cannot hide a text match.
 */
export function searchEligibleExercises<T extends SearchableExercise>(
  list: readonly T[],
  query: string,
  opts: SearchOptions & { excludeId?: string | null } = {},
): SearchResult<T> {
  const eligible = list.filter(
    (exercise) => exercise.archived !== true && exercise.id !== opts.excludeId,
  );
  return searchExercises(eligible, query, opts);
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
  const escaped = cleaned.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[^a-z0-9]+"),
  );
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

/**
 * Read a pool's names ahead of the first keystroke (each exercise once; the
 * index is kept on the exercise object, so it's free after that). Call it when
 * a picker's list arrives, in idle time.
 */
export function warmExerciseSearchIndex(list: readonly SearchableExercise[]): void {
  for (const ex of list) indexOf(ex);
}
