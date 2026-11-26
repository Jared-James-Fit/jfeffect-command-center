/**
 * Block types (pure, tested): what a training block is for, as structured
 * metadata the builder colours by and Cleo plans from.
 *
 * A block's type is a key: one of the built-in types below, or a coach's own
 * (`program_block_types`, a uuid). Its colour is only a way to see it: every
 * reader (Cleo, Program Check, the generator's brief) reads the metadata
 * (purpose, emphasis, progression, intensity, volume), never the name or the
 * colour, so a coach who renames "Strength" to "Strength block A" or makes a
 * custom "Strength-Speed" type built on Intensification gets the same
 * reasoning. Periodization is the coach's: types are a vocabulary, never a
 * required sequence.
 *
 * A block with no type yet reads its type from its own words (name, phase,
 * training focus: `inferBlockType`), shown as inferred until the coach picks.
 */

export const BLOCK_COLORS = ["slate", "stone", "sky", "blue", "violet", "cyan", "teal", "emerald", "lime", "yellow", "amber", "orange", "rose", "pink"] as const;
export type BlockColor = (typeof BLOCK_COLORS)[number];

export type Level = "low" | "moderate" | "high" | "very_high";

export type BlockTypeDef = {
  key: string;
  name: string;
  color: BlockColor;
  purpose: string;
  emphasis: string;
  progression: string;
  /** Typical working intensity (relative to max). */
  intensity: Level;
  /** Typical working volume (hard sets). */
  volume: Level;
  builtIn: boolean;
  /** A custom type built on a built-in one inherits how Program Check reads it. */
  basedOn?: string | null;
  archived?: boolean;
  sortOrder: number;
};

export const BUILT_IN_BLOCK_TYPES: readonly BlockTypeDef[] = [
  { key: "general_prep", name: "General Preparation", color: "slate", purpose: "Build work capacity, movement quality and a base for the blocks that follow.", emphasis: "Broad exercise selection, moderate loads, technique practice.", progression: "Add reps or sets week to week at RPE 6–8.", intensity: "moderate", volume: "moderate", builtIn: true, sortOrder: 0 },
  { key: "hypertrophy", name: "Hypertrophy", color: "sky", purpose: "Grow muscle where it supports the athlete's goals.", emphasis: "Hard sets per muscle in the 6–20 rep range, close to failure, stable exercises.", progression: "Double progression: reps to the top of the range, then load.", intensity: "moderate", volume: "high", builtIn: true, sortOrder: 1 },
  { key: "accumulation", name: "Accumulation", color: "blue", purpose: "Accumulate specific volume on the main lifts and their variations.", emphasis: "Higher volume at moderate intensity on the competition lifts.", progression: "Volume or load rises weekly; RPE 7–8.", intensity: "moderate", volume: "high", builtIn: true, sortOrder: 2 },
  { key: "strength", name: "Strength", color: "violet", purpose: "Turn built capacity into strength on the main lifts.", emphasis: "Heavier top sets (1–6 reps) with back-offs; fewer accessories.", progression: "Top sets rise by RPE or % while back-off volume holds.", intensity: "high", volume: "moderate", builtIn: true, sortOrder: 3 },
  { key: "intensification", name: "Intensification", color: "amber", purpose: "Raise intensity toward competition loads.", emphasis: "Low reps at high intensity, specificity, heavier singles and doubles.", progression: "Intensity up, volume down across the block.", intensity: "very_high", volume: "moderate", builtIn: true, sortOrder: 4 },
  { key: "peaking", name: "Peaking", color: "rose", purpose: "Express maximal strength on a set date.", emphasis: "Competition lifts, heavy singles, attempt practice, minimal accessories.", progression: "Intensity peaks, volume drops sharply into the taper.", intensity: "very_high", volume: "low", builtIn: true, sortOrder: 5 },
  { key: "taper", name: "Taper", color: "pink", purpose: "Shed fatigue while keeping strength for the meet or test.", emphasis: "Few, sharp sets; openers; rest.", progression: "Volume falls 40–60%; intensity is kept, then eased in the last days.", intensity: "high", volume: "low", builtIn: true, sortOrder: 6 },
  { key: "deload", name: "Deload", color: "teal", purpose: "Recover and let adaptation show.", emphasis: "Same movements, less work.", progression: "Cut volume about half and/or intensity; RPE ≤ 6.", intensity: "low", volume: "low", builtIn: true, sortOrder: 7 },
  { key: "rehab", name: "Rehabilitation", color: "cyan", purpose: "Train around or back from an injury or pain.", emphasis: "Pain-free ranges, controlled tempo, tolerance-building loads.", progression: "Load or range rises only while symptoms stay settled.", intensity: "low", volume: "moderate", builtIn: true, sortOrder: 8 },
  { key: "custom", name: "Custom", color: "stone", purpose: "The coach's own approach.", emphasis: "As written in this block.", progression: "As written in this block.", intensity: "moderate", volume: "moderate", builtIn: true, sortOrder: 9 },
];

const BUILT_IN = new Map(BUILT_IN_BLOCK_TYPES.map((t) => [t.key, t]));

/** A stored custom type or a coach's override of a built-in one (program_block_types). */
export type BlockTypeRow = {
  id: string;
  builtin_key?: string | null;
  name: string;
  color: string | null;
  purpose?: string | null;
  emphasis?: string | null;
  progression?: string | null;
  intensity?: string | null;
  volume?: string | null;
  based_on?: string | null;
  archived?: boolean | null;
  sort_order?: number | null;
};

const LEVELS: Level[] = ["low", "moderate", "high", "very_high"];
const asLevel = (v: string | null | undefined, fallback: Level): Level => (LEVELS.includes(v as Level) ? (v as Level) : fallback);
export const asColor = (v: string | null | undefined, fallback: BlockColor = "stone"): BlockColor => (BLOCK_COLORS.includes(v as BlockColor) ? (v as BlockColor) : fallback);

/** The library: built-ins (with the coach's renames / colours applied), then custom types, in their order. */
export function blockTypeLibrary(rows: BlockTypeRow[] = []): BlockTypeDef[] {
  const overrides = new Map(rows.filter((r) => r.builtin_key && BUILT_IN.has(r.builtin_key)).map((r) => [r.builtin_key as string, r]));
  const builtIns = BUILT_IN_BLOCK_TYPES.map((t) => {
    const o = overrides.get(t.key);
    if (!o) return { ...t };
    return {
      ...t,
      name: o.name?.trim() || t.name,
      color: asColor(o.color, t.color),
      purpose: o.purpose?.trim() || t.purpose,
      emphasis: o.emphasis?.trim() || t.emphasis,
      progression: o.progression?.trim() || t.progression,
      archived: !!o.archived,
      sortOrder: o.sort_order ?? t.sortOrder,
    };
  });
  const custom = rows
    .filter((r) => !r.builtin_key)
    .map((r, i) => {
      const base = r.based_on ? BUILT_IN.get(r.based_on) : undefined;
      return {
        key: r.id,
        name: r.name.trim() || "Custom",
        color: asColor(r.color, base?.color ?? "stone"),
        purpose: r.purpose?.trim() || base?.purpose || "",
        emphasis: r.emphasis?.trim() || base?.emphasis || "",
        progression: r.progression?.trim() || base?.progression || "",
        intensity: asLevel(r.intensity, base?.intensity ?? "moderate"),
        volume: asLevel(r.volume, base?.volume ?? "moderate"),
        builtIn: false,
        basedOn: base ? base.key : null,
        archived: !!r.archived,
        sortOrder: r.sort_order ?? 100 + i,
      } satisfies BlockTypeDef;
    });
  return [...builtIns, ...custom].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function findBlockType(key: string | null | undefined, library: BlockTypeDef[] = [...BUILT_IN_BLOCK_TYPES]): BlockTypeDef | null {
  if (!key) return null;
  return library.find((t) => t.key === key) ?? BUILT_IN.get(key) ?? null;
}

/** How Program Check and the AI read a type: its own key when built in, else the built-in it was based on. */
export function blockTypeFamily(t: BlockTypeDef | null): string | null {
  if (!t) return null;
  return t.builtIn ? t.key : t.basedOn ?? null;
}

/**
 * Words that name a block's type. Each is a whole word (a focus of
 * "competition lifts + hypertrophy" is not a peak; "Powerbuilding" names no
 * single type), read from the block's phase, then its name, then its focus.
 */
const WORDS: Array<[RegExp, string]> = [
  [/\b(deload|recovery week|unload(ing)?)\b/i, "deload"],
  [/\btaper(ing)?\b/i, "taper"],
  [/\b(peak|peaking|meet prep|comp prep|competition prep|attempts?)\b/i, "peaking"],
  [/\b(intensif\w*|realization|realisation)\b/i, "intensification"],
  [/\b(accumulat\w*|volume)\b/i, "accumulation"],
  [/\b(hypertroph\w*|muscle|bodybuilding|physique)\b/i, "hypertrophy"],
  [/\b(strength|power)\b/i, "strength"],
  [/\b(rehab\w*|return to|injur\w*|prehab\w*)\b/i, "rehab"],
  [/\b(gpp|general prep\w*|foundation|base|intro|off[- ]?season)\b/i, "general_prep"],
];

/**
 * What a block's own sets say about it (Nov 24 2026): how its working sets are
 * spread over rep ranges, how hard they're written, and what its main lifts
 * do. Worked out over the whole block, never one workout, and only when
 * there's enough of it to read (`enough`).
 */
export type BlockEvidence = {
  /** working sets read (timed, warm-up and conditioning rows left out) */
  sets: number;
  /** share of working sets at 8+ reps */
  highReps: number;
  /** share of the main lifts' sets at 1–3 reps */
  mainLow: number;
  /** share of the main lifts' sets at 3–6 reps */
  mainMid: number;
  /** share of the main lifts' sets at 8+ reps */
  mainHigh: number;
  /** the main lifts' share of all working sets */
  mainShare: number;
  /** average written effort on the main lifts, null when none */
  mainRpe: number | null;
  /** average written effort (RPE; RIR read as 10 − RIR), null when none */
  rpe: number | null;
  /** average % of a max on % rows, null when none */
  pct: number | null;
  weeks: number;
  enough: boolean;
};

type RowLike = {
  sets?: number | string | null;
  reps_text?: string | null;
  reps?: string | number | null;
  rpe?: string | number | null;
  rir?: string | number | null;
  percentage?: string | number | null;
  percentage_basis?: string | null;
  measurement_type?: string | null;
  time_profile?: string | null;
  purpose_label?: string | null;
  exercises?: { competition_lift_type?: string | null; is_competition_lift?: boolean | null } | null;
  is_competition_lift?: boolean | null;
};

const firstNumber = (v: unknown): number | null => {
  const m = String(v ?? "").match(/\d+(?:\.\d+)?/g);
  if (!m) return null;
  const nums = m.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  // a range ("8-12", "7-8") reads as its middle
  return nums.length >= 2 && /[-–to]/.test(String(v)) ? (nums[0] + nums[1]) / 2 : nums[0];
};

const MAIN_LABEL = /\b(primary|secondary|top set|back-?off|competition|comp)\b/i;

/** A block's evidence from its rows (a client block's tree rows, or a template's weeks of days of rows). */
export function blockEvidence(rows: RowLike[], weeks = 1): BlockEvidence {
  let sets = 0;
  let high = 0;
  let mainSets = 0;
  let mainLow = 0;
  let mainMid = 0;
  let mainHigh = 0;
  let mainRpeSum = 0;
  let mainRpeN = 0;
  let rpeSum = 0;
  let rpeN = 0;
  let pctSum = 0;
  let pctN = 0;
  for (const r of rows ?? []) {
    if (!r) continue;
    if (r.measurement_type === "time") continue;
    if (r.time_profile === "warmup_mobility" || r.time_profile === "conditioning") continue;
    const n = Math.max(0, Math.min(20, Number(r.sets) || 0));
    const reps = firstNumber(r.reps_text ?? r.reps);
    if (!n || reps == null || reps <= 0 || reps > 50) continue;
    sets += n;
    if (reps >= 8) high += n;
    const main =
      r.time_profile === "main_lift" ||
      r.time_profile === "secondary_lift" ||
      !!r.is_competition_lift ||
      !!r.exercises?.is_competition_lift ||
      !!r.exercises?.competition_lift_type ||
      MAIN_LABEL.test(String(r.purpose_label ?? ""));
    const rpe = firstNumber(r.rpe);
    const rir = firstNumber(r.rir);
    const effort = rpe != null && rpe >= 4 && rpe <= 10 ? rpe : rir != null && rir >= 0 && rir <= 6 ? 10 - rir : null;
    if (effort != null) {
      rpeSum += effort * n;
      rpeN += n;
    }
    if (main) {
      mainSets += n;
      if (reps <= 3) mainLow += n;
      else if (reps <= 6) mainMid += n;
      else if (reps >= 8) mainHigh += n;
      if (effort != null) {
        mainRpeSum += effort * n;
        mainRpeN += n;
      }
    }
    const basis = String(r.percentage_basis ?? "");
    const pct = firstNumber(r.percentage);
    if (pct != null && pct >= 30 && pct <= 110 && ["1rm", "training_max", "est_1rm", "comp_pr", "var_e1rm"].includes(basis)) {
      pctSum += pct * n;
      pctN += n;
    }
  }
  return {
    sets,
    highReps: sets ? high / sets : 0,
    mainLow: mainSets ? mainLow / mainSets : 0,
    mainMid: mainSets ? mainMid / mainSets : 0,
    mainHigh: mainSets ? mainHigh / mainSets : 0,
    mainShare: sets ? mainSets / sets : 0,
    mainRpe: mainRpeN ? mainRpeSum / mainRpeN : null,
    rpe: rpeN ? rpeSum / rpeN : null,
    pct: pctN ? pctSum / pctN : null,
    weeks: Math.max(1, weeks),
    // a block is read from its sets only once there are enough of them: a few
    // rows (one workout written so far) say nothing about the block
    enough: sets >= 12,
  };
}

/** A template block's evidence: its weeks of days of rows. */
export function weeksEvidence(weeks: unknown): BlockEvidence | null {
  if (!Array.isArray(weeks)) return null;
  const rows: RowLike[] = [];
  for (const w of weeks as any[]) for (const d of w?.days ?? []) for (const r of d?.rows ?? []) rows.push(r);
  return rows.length ? blockEvidence(rows, weeks.length) : null;
}

/**
 * What the sets say a block is, or null when they don't say clearly. When
 * the block's main lifts (top sets, back-offs, the competition lifts, rows
 * labelled primary / secondary) are a real share of its work, they decide:
 * mostly singles to triples written heavy is intensification (peaking only
 * with a meet close), mostly 1–6 reps is strength, mostly 8+ is hypertrophy.
 * Otherwise the whole block's reps do: mostly 8+ is hypertrophy. A light,
 * easy single week is a deload. Accessories at 8–12 never turn a strength
 * block into a hypertrophy one.
 */
export function typeFromEvidence(e: BlockEvidence | null | undefined, opts: { meetWithinWeeks?: number | null } = {}): string | null {
  if (!e || !e.enough) return null;
  if (e.weeks <= 1 && e.rpe != null && e.rpe <= 6 && e.highReps < 0.5) return "deload";
  if (e.mainShare >= 0.25) {
    const heavy = (e.pct != null && e.pct >= 85) || (e.mainRpe != null && e.mainRpe >= 8.5);
    // singles to triples are heavy work by what they are, whatever the deload week does to the average
    if (e.mainLow >= 0.6 && (heavy || e.mainLow >= 0.8)) return opts.meetWithinWeeks != null && opts.meetWithinWeeks <= 6 ? "peaking" : "intensification";
    if (e.mainLow + e.mainMid >= 0.6) return "strength";
    if (e.mainHigh >= 0.6) return e.highReps >= 0.5 ? "hypertrophy" : "accumulation";
  }
  if (e.highReps >= 0.5) return "hypertrophy";
  if (e.highReps >= 0.3) return "accumulation";
  return null;
}

/** Which types a block's words may name when its sets say another. */
const AGREES: Record<string, string[]> = {
  hypertrophy: ["hypertrophy", "accumulation", "general_prep"],
  accumulation: ["accumulation", "hypertrophy", "strength", "general_prep"],
  strength: ["strength", "accumulation", "intensification"],
  intensification: ["intensification", "strength", "peaking"],
  peaking: ["peaking", "intensification", "taper", "strength"],
  taper: ["taper", "peaking", "intensification", "deload"],
  deload: ["deload", "taper", "general_prep", "hypertrophy", "accumulation", "strength"],
  general_prep: ["general_prep", "hypertrophy", "accumulation", "strength"],
  rehab: ["rehab", "general_prep", "hypertrophy", "accumulation", "strength", "deload"],
};

function typeFromWords(b: { phase?: string | null; training_focus?: string | null; name?: string | null }): string | null {
  for (const text of [b.phase, b.name, b.training_focus]) {
    const t = (text ?? "").trim();
    if (!t) continue;
    for (const [re, key] of WORDS) if (re.test(t)) return key;
  }
  return null;
}

/**
 * A block's type read from what it is (Nov 24 2026): its words (phase, name,
 * focus) and, when there are enough of them, its sets. A word the sets agree
 * with wins; a word they contradict (a "Peak" focus on a block of 8–12 rep
 * sets) gives way to the sets; no word at all takes the sets' read. Null when
 * neither says clearly: the builder then shows no suggestion rather than a
 * wrong one.
 */
export function inferBlockType(b: {
  phase?: string | null;
  training_focus?: string | null;
  name?: string | null;
  weeks?: unknown;
  evidence?: BlockEvidence | null;
  meetWithinWeeks?: number | null;
}): string | null {
  const words = typeFromWords(b);
  const evidence = b.evidence ?? weeksEvidence(b.weeks);
  const sets = typeFromEvidence(evidence, { meetWithinWeeks: b.meetWithinWeeks });
  if (words && sets) return AGREES[words]?.includes(sets) ? words : sets;
  return words ?? sets;
}

/** What a block carries: its type and the coach's words for this block (each falls back to the type's). */
export type BlockMeta = {
  purpose?: string | null;
  emphasis?: string | null;
  progression?: string | null;
};

export type ResolvedBlockType = {
  type: BlockTypeDef | null;
  /** true when read from the block's words, not picked by the coach. */
  inferred: boolean;
  purpose: string | null;
  emphasis: string | null;
  progression: string | null;
};

export function resolveBlockType(
  b: {
    block_type?: string | null;
    block_meta?: BlockMeta | null;
    phase?: string | null;
    training_focus?: string | null;
    name?: string | null;
    weeks?: unknown;
    evidence?: BlockEvidence | null;
    meetWithinWeeks?: number | null;
  },
  library: BlockTypeDef[] = [...BUILT_IN_BLOCK_TYPES],
): ResolvedBlockType {
  const picked = findBlockType(b.block_type ?? null, library);
  const inferredKey = picked ? null : inferBlockType(b);
  const type = picked ?? findBlockType(inferredKey, library);
  const m = b.block_meta ?? {};
  return {
    type,
    inferred: !picked && !!type,
    purpose: m.purpose?.trim() || type?.purpose || null,
    emphasis: m.emphasis?.trim() || type?.emphasis || null,
    progression: m.progression?.trim() || type?.progression || null,
  };
}

const LEVEL_WORD: Record<Level, string> = { low: "low", moderate: "moderate", high: "high", very_high: "very high" };

/** One line an AI reads about a block: its type by metadata, never just a name or a colour. */
export function blockTypeLine(r: ResolvedBlockType, dates?: { start?: string | null; end?: string | null }): string | null {
  if (!r.type) return null;
  const family = blockTypeFamily(r.type);
  const named = r.type.builtIn ? r.type.name : `${r.type.name} (coach's own type${family ? `, built on ${findBlockType(family)?.name ?? family}` : ""})`;
  const parts = [
    `Block type: ${named}${r.inferred ? " (read from its name; not confirmed by the coach)" : ""}`,
    r.purpose ? `purpose: ${r.purpose}` : null,
    r.emphasis ? `emphasis: ${r.emphasis}` : null,
    r.progression ? `progression: ${r.progression}` : null,
    `typical intensity ${LEVEL_WORD[r.type.intensity]}, volume ${LEVEL_WORD[r.type.volume]}`,
    dates?.start || dates?.end ? `dates ${dates?.start ?? "?"} → ${dates?.end ?? "?"}` : null,
  ];
  return parts.filter(Boolean).join("; ");
}

/**
 * Colour classes per swatch, written out whole so Tailwind keeps them: a soft
 * chip, a solid bar / dot, and a hairline ring. Every swatch is readable on
 * both themes; the type's name always sits beside its colour (never colour alone).
 */
export const BLOCK_COLOR_CLASS: Record<BlockColor, { chip: string; bar: string; dot: string; ring: string; text: string }> = {
  slate: { chip: "bg-slate-500/12 text-slate-700 dark:text-slate-300", bar: "bg-slate-400 dark:bg-slate-500", dot: "bg-slate-500", ring: "ring-slate-500/40", text: "text-slate-700 dark:text-slate-300" },
  stone: { chip: "bg-stone-500/12 text-stone-700 dark:text-stone-300", bar: "bg-stone-400 dark:bg-stone-500", dot: "bg-stone-500", ring: "ring-stone-500/40", text: "text-stone-700 dark:text-stone-300" },
  sky: { chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", bar: "bg-sky-500/75 dark:bg-sky-400/70", dot: "bg-sky-500", ring: "ring-sky-500/40", text: "text-sky-700 dark:text-sky-300" },
  blue: { chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300", bar: "bg-blue-500/75 dark:bg-blue-400/70", dot: "bg-blue-500", ring: "ring-blue-500/40", text: "text-blue-700 dark:text-blue-300" },
  violet: { chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", bar: "bg-violet-500/75 dark:bg-violet-400/70", dot: "bg-violet-500", ring: "ring-violet-500/40", text: "text-violet-700 dark:text-violet-300" },
  cyan: { chip: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300", bar: "bg-cyan-500/75 dark:bg-cyan-400/70", dot: "bg-cyan-500", ring: "ring-cyan-500/40", text: "text-cyan-700 dark:text-cyan-300" },
  teal: { chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300", bar: "bg-teal-500/75 dark:bg-teal-400/70", dot: "bg-teal-500", ring: "ring-teal-500/40", text: "text-teal-700 dark:text-teal-300" },
  emerald: { chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500/75 dark:bg-emerald-400/70", dot: "bg-emerald-500", ring: "ring-emerald-500/40", text: "text-emerald-700 dark:text-emerald-300" },
  lime: { chip: "bg-lime-500/15 text-lime-800 dark:text-lime-300", bar: "bg-lime-500/75 dark:bg-lime-400/70", dot: "bg-lime-500", ring: "ring-lime-500/40", text: "text-lime-800 dark:text-lime-300" },
  yellow: { chip: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", bar: "bg-yellow-400", dot: "bg-yellow-400", ring: "ring-yellow-500/40", text: "text-yellow-800 dark:text-yellow-300" },
  amber: { chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", bar: "bg-amber-500/75 dark:bg-amber-400/70", dot: "bg-amber-500", ring: "ring-amber-500/40", text: "text-amber-800 dark:text-amber-300" },
  orange: { chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300", bar: "bg-orange-500/75 dark:bg-orange-400/70", dot: "bg-orange-500", ring: "ring-orange-500/40", text: "text-orange-700 dark:text-orange-300" },
  rose: { chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", bar: "bg-rose-500/75 dark:bg-rose-400/70", dot: "bg-rose-500", ring: "ring-rose-500/40", text: "text-rose-700 dark:text-rose-300" },
  pink: { chip: "bg-pink-500/12 text-pink-700 dark:text-pink-300", bar: "bg-pink-500/75 dark:bg-pink-400/70", dot: "bg-pink-500", ring: "ring-pink-500/40", text: "text-pink-700 dark:text-pink-300" },
};

export function colorClass(t: BlockTypeDef | null | undefined) {
  return BLOCK_COLOR_CLASS[t?.color ?? "stone"];
}
