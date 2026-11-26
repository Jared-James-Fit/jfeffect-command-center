/**
 * Sumo and conventional deadlifts kept apart (pure, tested). The library has
 * one "Competition Deadlift", so the stance comes from what the coach wrote on
 * the row: the exercise's own name or name override ("Competition Deadlift
 * (Sumo)"), its purpose label, then its notes. A note's word counts only when
 * it isn't an alternative or a negation ("Swap if needed: Conventional", "no
 * fixed conventional load"), and only when it names one stance.
 *
 * A session takes the stance any of its rows names; a session that names none
 * takes the last stance before it (and the first one named, before any is);
 * an athlete who never names one has a single series.
 */
export type DeadliftStyle = "sumo" | "conventional";
export const STYLE_WORD: Record<DeadliftStyle, string> = { sumo: "sumo", conventional: "conventional" };

const STYLE_RE: Array<[RegExp, DeadliftStyle]> = [
  [/\bsumo\b/i, "sumo"],
  [/\bconv(?:entional|\.)?\b/i, "conventional"],
];
const NEGATED = /\b(no|not|never|without|instead(?:\s+of)?|swap(?:\s+(?:to|for|if needed))?|or|vs\.?|versus|than|alt(?:ernative)?|option)\b[^.;]{0,24}$/i;

/** The stance one piece of text names, or null. */
export function styleInText(text: string | null | undefined, opts: { strict?: boolean } = {}): DeadliftStyle | null {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  const found = new Set<DeadliftStyle>();
  for (const [re, style] of STYLE_RE) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 40), m.index);
      if (!opts.strict && NEGATED.test(before)) continue;
      found.add(style);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/** A row's stance: its names first (strict), then its label, then its notes. */
export function rowStyle(row: {
  exerciseName?: string | null;
  nameOverride?: string | null;
  role?: string | null;
  notes?: string | null;
}): DeadliftStyle | null {
  return (
    styleInText(row.nameOverride, { strict: true }) ??
    styleInText(row.exerciseName, { strict: true }) ??
    styleInText(row.role) ??
    styleInText(row.notes)
  );
}

/** Each day's stance from the rows that name one, carried forward (and back before the first). */
export function stylesByDay(rows: Array<{ day: string; style: DeadliftStyle | null }>): Map<string, DeadliftStyle | null> {
  const named = new Map<string, Set<DeadliftStyle>>();
  const days = new Set<string>();
  for (const r of rows) {
    days.add(r.day);
    if (r.style) named.set(r.day, new Set([...(named.get(r.day) ?? []), r.style]));
  }
  const sorted = [...days].sort();
  const out = new Map<string, DeadliftStyle | null>();
  let last: DeadliftStyle | null = null;
  for (const d of sorted) {
    const n = named.get(d);
    if (n && n.size === 1) last = [...n][0];
    out.set(d, last);
  }
  const first = sorted.map((d) => out.get(d)).find((s) => s != null) ?? null;
  if (first) for (const d of sorted) if (out.get(d) == null) out.set(d, first);
  return out;
}
