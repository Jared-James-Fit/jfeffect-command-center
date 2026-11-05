/**
 * The exercise standard every program the app writes is held to (Generate
 * Next Program, Cleo's build / add / swap): stable, loadable exercises that
 * progress in small steps and work for a beginner and an advanced lifter
 * alike. A few library exercises fail that on their face: an isolation move
 * on an implement that loads in big jumps or starts too heavy (a landmine
 * lateral raise starts at the bar's ~45 lb; plates and kettlebells jump
 * 10-25 lb / 4 kg at a time), combos that are limited by their weakest part,
 * twists and side bends, wall sits, supermans, loaded work on a ball or
 * balance board, and raises with no load. Those are kept out of the catalog
 * the model picks from, named in its rules, retried and cleaned out of its
 * strategy, failed by the audit, and flagged on Cleo's cards. A coach's own
 * pick (a required exercise) is always theirs to make. Stretches and other
 * mobility work are never judged: they aren't working sets.
 */

type Rule = { test: (name: string) => boolean; reason: string };

const has = (re: RegExp) => (name: string) => re.test(name);
/** Isolation work, where small load steps matter (shrugs and calf raises load heavy and are left out). */
const ISOLATION = /(lateral raise|front raise|\bfly\b|\bflyes?\b|\bcurl|tricep|skull ?crusher|(overhead|wrist|shoulder) extension|kick ?back|\bhalo\b|car driver|wood ?chop)/i;
/** Not a working set: never judged. */
const MOBILITY = /\bstretch|\bpose\b|mobility|warm[- ]?up|\bfoam roll/i;
const MOVE = "(squat|squats|lunge|deadlift|lift|curl|press|raise|row|pullover|bridge|plank|step ?up|clean|lateral|fly)";
const SECOND = "(press|twist|row|curl|raise|chop|extension|fly|pullover|high pull)";

const RULES: Rule[] = [
  {
    test: (n) => /landmine/i.test(n) && ISOLATION.test(n),
    reason: "an isolation exercise on a landmine: the bar alone is too heavy to start with and it can't go up in small steps; use the dumbbell, cable or machine version",
  },
  {
    test: (n) => /\b(plate|kettlebells?)\b/i.test(n) && ISOLATION.test(n),
    reason: "isolation work with a plate or kettlebell jumps 10-25 lb (or 4 kg) at a time; use dumbbells, a cable, a machine or a band",
  },
  {
    test: has(/\bbarbell\b.*lateral raise|lateral raise.*\bbarbell\b/i),
    reason: "a lateral raise with a barbell loads the side delts badly and starts too heavy; use dumbbells, a cable or a machine",
  },
  {
    test: (n) => new RegExp(`\\b${MOVE}\\b.*\\b(to|and|with)\\b.*\\b${SECOND}\\b`, "i").test(n) || (/\bthrusters?\b/i.test(n) && !/\bhip thrusters?\b/i.test(n)),
    reason: "a combo exercise: the weakest part sets the load, so neither part gets enough; program the two exercises separately",
  },
  { test: has(/russian twist|oblique twist|kneeling twist|side bend|\btwist\b/i), reason: "twists and side bends are low value for the trunk; use a cable crunch, reverse crunch, leg raise or Pallof press" },
  { test: has(/\bwall (sit|squat)/i), reason: "a wall sit can't be loaded or progressed; use a squat, leg press or leg extension" },
  { test: has(/\bsuperman/i), reason: "a superman can't be loaded or progressed; use a 45° back extension or reverse hyper" },
  {
    test: has(/\bbosu\b|half ball|balance board|\b(dumbbells?|barbell|kettlebells?|plate)\b.*\b(on|over)\b.*\b(exercise|stability|swiss) ball/i),
    reason: "loaded work on an unstable surface takes load off the muscle; use the stable version (a bench, the floor, a machine)",
  },
  {
    test: (n) => /(lateral raise|front raise|\bfly\b|\bflyes?\b)/i.test(n) && /\bbodyweight\b|^(lying|laying) lateral raises?$|arms lateral raise/i.test(n),
    reason: "a raise with no load is a warm-up, not a working set; use dumbbells, a cable or a band",
  },
];

/** Why an exercise doesn't meet the standard, or null when it does. */
export function lowValueReason(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n || MOBILITY.test(n)) return null;
  for (const r of RULES) if (r.test(n)) return r.reason;
  return null;
}

export const isLowValueExercise = (name: string | null | undefined) => lowValueReason(name) != null;

type Ref = { id?: string | null; name: string };
const isKept = (keep: Ref[]) => {
  const ids = new Set(keep.map((k) => k.id).filter(Boolean));
  const names = new Set(keep.map((k) => k.name.trim().toLowerCase()));
  return (e: { id?: string | null; exercise_id?: string | null; name: string }) => !!((e.id ?? e.exercise_id) && ids.has((e.id ?? e.exercise_id) as string)) || names.has(e.name.trim().toLowerCase());
};

/** The catalog without exercises below the standard, keeping any the coach asked for by id or name. */
export function meetsStandard<T extends { id?: string | null; name: string }>(list: T[], keep: Ref[] = []): T[] {
  const kept = isKept(keep);
  return list.filter((e) => kept(e) || !isLowValueExercise(e.name));
}

/**
 * A strategy without exercises below the standard: taken out of what it keeps
 * or adds, and a replacement that's below it is left for the build to choose
 * (the catalog it builds from only holds exercises that meet it). The coach's
 * required exercises stay. Returns the names taken out.
 */
export function withStandardStrategy<
  S extends {
    exercise_plan: {
      retain: Array<{ exercise_id: string | null; name: string }>;
      add: Array<{ name: string }>;
      replace: Array<{ with: string | null }>;
    };
  },
>(s: S, keep: Ref[] = []): { strategy: S; removed: string[] } {
  const kept = isKept(keep);
  const removed: string[] = [];
  const ok = (e: { exercise_id?: string | null; name: string }) => {
    if (kept(e) || !isLowValueExercise(e.name)) return true;
    removed.push(e.name);
    return false;
  };
  const retain = s.exercise_plan.retain.filter(ok);
  const add = s.exercise_plan.add.filter(ok);
  const replace = s.exercise_plan.replace.map((r) => (r.with && !kept({ name: r.with }) && isLowValueExercise(r.with) ? (removed.push(r.with), { ...r, with: null }) : r));
  if (!removed.length) return { strategy: s, removed };
  return { strategy: { ...s, exercise_plan: { ...s.exercise_plan, retain, add, replace } }, removed: [...new Set(removed)] };
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
- Isolation work uses dumbbells, cables, machines or bands, never a landmine, plate, kettlebell or barbell where the lightest load is already too heavy or the jumps are too big (e.g. a landmine lateral raise starts at ~45 lb; almost nobody can do that well). A landmine is fine for compound work (rows, presses, belt squats, RDLs).
- Never: combo moves (lunge to press, squat and press, curl to press, thrusters), Russian twists, side bends and other twists, wall sits, supermans, loaded work on a ball, Bosu or balance board, or raises with no load. For the trunk use cable crunches, reverse crunches, leg raises, ab wheel or Pallof presses; for the lower back, 45° back extensions.
- When unsure between a novel exercise and a standard one, pick the standard one.`;
