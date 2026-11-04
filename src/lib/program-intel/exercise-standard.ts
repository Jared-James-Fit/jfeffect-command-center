/**
 * The exercise standard every program the app writes is held to (Generate
 * Next Program, Cleo's build / add / swap): stable, loadable exercises that
 * progress in small steps and work for a beginner and an advanced lifter
 * alike. A few library exercises fail that on their face: an isolation move
 * on an implement whose lightest load is already too heavy (a landmine
 * lateral raise starts at the bar's weight, ~45 lb), circus combos that are
 * limited by the weakest link, twists and side bends, wall sits, unstable
 * surfaces and unloaded raises. Those are kept out of the catalog the model
 * picks from, named in its rules, and failed by the audit, so a draft never
 * reaches the coach with one. A coach's own pick (a required exercise) is
 * always theirs to make.
 */

type Rule = { test: (name: string) => boolean; reason: string };

const has = (re: RegExp) => (name: string) => re.test(name);
const ISOLATION = /(lateral raise|front raise|rear delt|reverse fly|\bfly\b|\bflye?s?\b|\bcurl|tricep|triceps|skull ?crusher|kick ?back|calf raise|shrug)/i;

const RULES: Rule[] = [
  {
    test: (n) => /landmine/i.test(n) && ISOLATION.test(n),
    reason: "an isolation exercise on a landmine: the bar alone is too heavy to start with and it can't go up in small steps; use the dumbbell, cable or machine version",
  },
  {
    test: (n) => /(plate|kettlebell|barbell)\b.*lateral raise|lateral raise.*\b(plate|kettlebell|barbell)\b/i.test(n),
    reason: "a lateral raise with a plate, kettlebell or barbell loads the side delts badly and jumps in big steps; use dumbbells, a cable or a machine",
  },
  {
    test: has(/\b(lunge|squat|deadlift|lift|curl|step ?up|clean)\b.*\b(to|and)\b.*\b(press|twist|row|curl|raise|chop)\b/i),
    reason: "a combo exercise: the weakest part sets the load, so neither part gets enough; program the two exercises separately",
  },
  { test: has(/russian twist|oblique twist|kneeling twist|side bend|\btwist\b/i), reason: "twists and side bends are low value for the trunk; use a cable crunch, reverse crunch, leg raise or Pallof press" },
  { test: has(/\bwall sit\b/i), reason: "a wall sit can't be loaded or progressed; use a squat, leg press or leg extension" },
  { test: has(/\bbosu\b|half ball/i), reason: "an unstable surface takes load off the muscle; use the stable version" },
  {
    test: (n) => /(lateral raise|front raise|\bfly\b|\bflyes?\b)/i.test(n) && /\bbodyweight\b|^(lying|laying) lateral raises?$|arms lateral raise/i.test(n),
    reason: "a raise with no load is a warm-up, not a working set; use dumbbells, a cable or a band",
  },
];

/** Why an exercise doesn't meet the standard, or null when it does. */
export function lowValueReason(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  for (const r of RULES) if (r.test(n)) return r.reason;
  return null;
}

export const isLowValueExercise = (name: string | null | undefined) => lowValueReason(name) != null;

/** The catalog without exercises below the standard, keeping any the coach asked for by id or name. */
export function meetsStandard<T extends { id?: string | null; name: string }>(list: T[], keep: Array<{ id?: string | null; name: string }> = []): T[] {
  const ids = new Set(keep.map((k) => k.id).filter(Boolean));
  const names = new Set(keep.map((k) => k.name.trim().toLowerCase()));
  return list.filter((e) => (e.id && ids.has(e.id)) || names.has(e.name.trim().toLowerCase()) || !isLowValueExercise(e.name));
}

/** A built block's substitutions without exercises below the standard (they're printed as "Swap if needed"). */
export function withStandardSubstitutions<B extends { days: Array<{ exercises: Array<{ substitutions?: Array<{ exercise_name: string }> }> }> }>(block: B): B {
  let changed = false;
  const days = block.days.map((d) => ({
    ...d,
    exercises: d.exercises.map((e) => {
      const subs = e.substitutions ?? [];
      const keep = subs.filter((s) => !isLowValueExercise(s.exercise_name));
      if (keep.length === subs.length) return e;
      changed = true;
      return { ...e, substitutions: keep };
    }),
  }));
  return changed ? { ...block, days } : block;
}

/** The rule in the model's words (strategy, build and repair prompts). */
export const EXERCISE_STANDARD = `Exercise standard (every level, beginner to advanced):
- Pick proven, stable, loadable bodybuilding and strength exercises that progress in small steps: barbell, dumbbell, cable and machine versions of squats, presses, rows, pulldowns, hinges, lunges / split squats, curls, extensions, raises and flyes.
- Isolation work uses dumbbells, cables, machines or bands, never a landmine, barbell, plate or kettlebell where the lightest load is already too heavy (e.g. a landmine lateral raise starts at ~45 lb; almost nobody can do that well). A landmine is fine for compound work (rows, presses, belt squats, RDLs).
- Never: combo / circus moves (lunge to press, squat and press, curl to press), Russian twists, side bends and other twists, wall sits, Bosu / unstable-surface versions, or raises with no load. For the trunk use cable crunches, reverse crunches, leg raises, ab wheel or Pallof presses.
- When unsure between a novel exercise and a standard one, pick the standard one.`;
