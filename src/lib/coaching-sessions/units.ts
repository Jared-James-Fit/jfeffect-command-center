/**
 * Loads said in a meeting, checked for their unit (pure, tested in
 * meeting-intelligence.test.ts). "Open at 180" means 180 kg to one lifter and
 * 180 lb to another, and a competition attempt or a training load set in the
 * wrong one is a disaster, so before Cleo's read is used for programming or
 * attempts, every load the words give without a unit (or in the unit the
 * client doesn't train in) is named for the coach to confirm.
 */

const LIFT_WORDS =
  /\b(squat|bench|dead ?lift|pull|press|open(er|ing)?|attempt|second|third|1st|2nd|3rd|single|double|triple|top set|backoff|back-off|work(ing)? set|max|pr|total|load|weight|bar|plates?|warm-?up|hit|went|go(ing)? for|jump)\b/i;
const UNIT_AFTER = /^\s*(kg|kgs|kilo|kilos|kilograms?|lb|lbs|pounds?|#)\b/i;
const UNIT_BEFORE = /\b(kg|kgs|kilos?|lbs?|pounds?)\s*$/i;

export type UnitCheck = {
  /** the number as said */
  value: number;
  /** the words around it */
  context: string;
  /** "none": said with no unit; "other": in the unit they don't train in */
  issue: "none" | "other";
  said: "kg" | "lb" | null;
};

const unitOf = (w: string): "kg" | "lb" | null =>
  /^(kg|kgs|kilo|kilos|kilograms?)$/i.test(w)
    ? "kg"
    : /^(lb|lbs|pounds?|#)$/i.test(w)
      ? "lb"
      : null;

const MEET_WORDS =
  /\b(open(er|ing)?|attempts?|second|third|1st|2nd|3rd|meet|platform|total|weigh-?in|class)\b/i;

/**
 * Loads in a text that need their unit confirmed. A number counts as a load
 * when lifting words are within a few words of it and it's a plausible load
 * (20 to 500 when said with no unit: a rep count, a percentage, a date or a
 * bodyweight-class name is never one). Said in the client's own unit is fine.
 */
export function ambiguousLoads(
  text: string,
  clientUnit: "kg" | "lb" | null,
  opts: { meetOnly?: boolean } = {},
): UnitCheck[] {
  const out: UnitCheck[] = [];
  const t = String(text ?? "");
  const re = /(\d{2,3}(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const value = Number(m[1]);
    const before = t.slice(Math.max(0, m.index - 48), m.index);
    const after = t.slice(m.index + m[1]!.length, m.index + m[1]!.length + 32);
    // a percentage, a time, a rep scheme ("5x5", "3 reps"), a date, a class ("66 kg class" is a class, still a unit)
    if (
      /^\s*(%|percent|x\b|×|reps?\b|sets?\b|minutes?|mins?\b|seconds?|secs?\b|days?\b|weeks?\b|:|\/)/i.test(
        after,
      )
    )
      continue;
    if (/(x|×)\s*$/i.test(before)) continue;
    if (/\b(rpe|rir|@)\s*$/i.test(before)) continue;
    if (/\b(19|20)\d{2}\b/.test(m[1]!)) continue;
    const context = `${before}${m[1]}${after}`.replace(/\s+/g, " ").trim();
    if (!LIFT_WORDS.test(context)) continue;
    if (opts.meetOnly && !MEET_WORDS.test(context)) continue;
    const aUnit = after.match(UNIT_AFTER);
    const bUnit = before.match(UNIT_BEFORE);
    const said = aUnit ? unitOf(aUnit[1]!) : bUnit ? unitOf(bUnit[1]!) : null;
    if (/\bclass\b/i.test(after.slice(0, 14))) continue;
    if (said) {
      if (clientUnit && said !== clientUnit) out.push({ value, context, issue: "other", said });
      continue;
    }
    if (value < 20 || value > 500) continue;
    out.push({ value, context, issue: "none", said: null });
  }
  // one per value said the same way
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.value}:${c.issue}:${c.said}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One line for the coach about a load to confirm. */
export function unitCheckLine(c: UnitCheck, clientUnit: "kg" | "lb" | null): string {
  if (c.issue === "other")
    return `${c.value} ${c.said} was said, but they train in ${clientUnit}: confirm before it's used for loads or attempts (“${c.context}”).`;
  return `${c.value} was said with no unit: kg or lb? Confirm before it's used for loads or attempts (“${c.context}”).`;
}
