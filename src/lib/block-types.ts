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

export const BLOCK_COLORS = ["slate", "stone", "sky", "blue", "cyan", "teal", "emerald", "lime", "yellow", "orange", "rose", "pink"] as const;
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
  { key: "general_prep", name: "General Preparation", color: "teal", purpose: "Build work capacity, movement quality and a base for the blocks that follow.", emphasis: "Broad exercise selection, moderate loads, technique practice.", progression: "Add reps or sets week to week at RPE 6–8.", intensity: "moderate", volume: "moderate", builtIn: true, sortOrder: 0 },
  { key: "hypertrophy", name: "Hypertrophy", color: "sky", purpose: "Grow muscle where it supports the athlete's goals.", emphasis: "Hard sets per muscle in the 6–20 rep range, close to failure, stable exercises.", progression: "Double progression: reps to the top of the range, then load.", intensity: "moderate", volume: "high", builtIn: true, sortOrder: 1 },
  { key: "accumulation", name: "Accumulation", color: "blue", purpose: "Accumulate specific volume on the main lifts and their variations.", emphasis: "Higher volume at moderate intensity on the competition lifts.", progression: "Volume or load rises weekly; RPE 7–8.", intensity: "moderate", volume: "high", builtIn: true, sortOrder: 2 },
  { key: "strength", name: "Strength", color: "orange", purpose: "Turn built capacity into strength on the main lifts.", emphasis: "Heavier top sets (1–6 reps) with back-offs; fewer accessories.", progression: "Top sets rise by RPE or % while back-off volume holds.", intensity: "high", volume: "moderate", builtIn: true, sortOrder: 3 },
  { key: "intensification", name: "Intensification", color: "rose", purpose: "Raise intensity toward competition loads.", emphasis: "Low reps at high intensity, specificity, heavier singles and doubles.", progression: "Intensity up, volume down across the block.", intensity: "very_high", volume: "moderate", builtIn: true, sortOrder: 4 },
  { key: "peaking", name: "Peaking", color: "pink", purpose: "Express maximal strength on a set date.", emphasis: "Competition lifts, heavy singles, attempt practice, minimal accessories.", progression: "Intensity peaks, volume drops sharply into the taper.", intensity: "very_high", volume: "low", builtIn: true, sortOrder: 5 },
  { key: "taper", name: "Taper", color: "lime", purpose: "Shed fatigue while keeping strength for the meet or test.", emphasis: "Few, sharp sets; openers; rest.", progression: "Volume falls 40–60%; intensity is kept, then eased in the last days.", intensity: "high", volume: "low", builtIn: true, sortOrder: 6 },
  { key: "deload", name: "Deload", color: "slate", purpose: "Recover and let adaptation show.", emphasis: "Same movements, less work.", progression: "Cut volume about half and/or intensity; RPE ≤ 6.", intensity: "low", volume: "low", builtIn: true, sortOrder: 7 },
  { key: "rehab", name: "Rehabilitation", color: "emerald", purpose: "Train around or back from an injury or pain.", emphasis: "Pain-free ranges, controlled tempo, tolerance-building loads.", progression: "Load or range rises only while symptoms stay settled.", intensity: "low", volume: "moderate", builtIn: true, sortOrder: 8 },
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

const WORDS: Array<[RegExp, string]> = [
  [/\bdeload|recovery week|unload\b/i, "deload"],
  [/\btaper\b/i, "taper"],
  [/\bpeak|meet prep|competition|comp prep|attempt/i, "peaking"],
  [/\bintensif|realization|realisation\b/i, "intensification"],
  [/\baccumulat|volume\b/i, "accumulation"],
  [/\bhypertroph|muscle|bodybuilding|physique|build\b/i, "hypertrophy"],
  [/\bstrength|power\b/i, "strength"],
  [/\brehab|return to|injur|prehab\b/i, "rehab"],
  [/\bgpp|general prep|foundation|base|intro|off[- ]?season\b/i, "general_prep"],
];

/** A block's type read from its own words (phase first, then focus, then name), or null. */
export function inferBlockType(b: { phase?: string | null; training_focus?: string | null; name?: string | null }): string | null {
  for (const text of [b.phase, b.training_focus, b.name]) {
    const t = (text ?? "").trim();
    if (!t) continue;
    for (const [re, key] of WORDS) if (re.test(t)) return key;
  }
  return null;
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
  b: { block_type?: string | null; block_meta?: BlockMeta | null; phase?: string | null; training_focus?: string | null; name?: string | null },
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
  sky: { chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", bar: "bg-sky-500", dot: "bg-sky-500", ring: "ring-sky-500/40", text: "text-sky-700 dark:text-sky-300" },
  blue: { chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300", bar: "bg-blue-500", dot: "bg-blue-500", ring: "ring-blue-500/40", text: "text-blue-700 dark:text-blue-300" },
  cyan: { chip: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300", bar: "bg-cyan-500", dot: "bg-cyan-500", ring: "ring-cyan-500/40", text: "text-cyan-700 dark:text-cyan-300" },
  teal: { chip: "bg-teal-500/12 text-teal-700 dark:text-teal-300", bar: "bg-teal-500", dot: "bg-teal-500", ring: "ring-teal-500/40", text: "text-teal-700 dark:text-teal-300" },
  emerald: { chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500", dot: "bg-emerald-500", ring: "ring-emerald-500/40", text: "text-emerald-700 dark:text-emerald-300" },
  lime: { chip: "bg-lime-500/15 text-lime-800 dark:text-lime-300", bar: "bg-lime-500", dot: "bg-lime-500", ring: "ring-lime-500/40", text: "text-lime-800 dark:text-lime-300" },
  yellow: { chip: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300", bar: "bg-yellow-400", dot: "bg-yellow-400", ring: "ring-yellow-500/40", text: "text-yellow-800 dark:text-yellow-300" },
  orange: { chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300", bar: "bg-orange-500", dot: "bg-orange-500", ring: "ring-orange-500/40", text: "text-orange-700 dark:text-orange-300" },
  rose: { chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", bar: "bg-rose-500", dot: "bg-rose-500", ring: "ring-rose-500/40", text: "text-rose-700 dark:text-rose-300" },
  pink: { chip: "bg-pink-500/12 text-pink-700 dark:text-pink-300", bar: "bg-pink-500", dot: "bg-pink-500", ring: "ring-pink-500/40", text: "text-pink-700 dark:text-pink-300" },
};

export function colorClass(t: BlockTypeDef | null | undefined) {
  return BLOCK_COLOR_CLASS[t?.color ?? "stone"];
}
