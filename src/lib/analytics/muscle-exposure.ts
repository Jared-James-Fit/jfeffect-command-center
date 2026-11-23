/**
 * Muscle exposure: how much training each muscle gets (pure, tested), for
 * the muscle map and its ranked list.
 *
 * It's exposure, not growth: working sets credited to a muscle, never a
 * measurement of the muscle. The counting rule is said on screen and the
 * athlete can change how secondary muscles count:
 *  - a set credits every muscle the exercise lists: its primary muscles a
 *    full set, its secondary ones `secondary` of a set (½ by default, the
 *    same as the volume numbers elsewhere; 0 or 1 when picked), one credit
 *    per muscle per set (a muscle listed twice counts once, the higher);
 *  - working sets only (warm-ups live elsewhere), never conditioning,
 *    mobility or a set the library marks as not counting toward volume
 *    (training-load's `patternOf`);
 *  - "a week" divides by the weeks the period's training-load read averages
 *    over (`perWeekBasis.keys`: the weeks that are over, else this week so
 *    far), so with the default rule every number matches the Volume read;
 *  - frequency is days a week with a set aimed at it (primary);
 *  - emphasis is a muscle's share of every credited set in the period, and
 *    the map's heat is relative to the most-trained muscle (never a target).
 */
import {
  FINE_MUSCLES,
  fineMuscle,
  patternOf,
  weekOf,
  type FineMuscle,
  type LoadSet,
} from "@/lib/analytics/training-load";

export type SecondaryRule = 0 | 0.5 | 1;
export const SECONDARY_RULES: Array<[SecondaryRule, string]> = [
  [0.5, "½ set"],
  [1, "Full set"],
  [0, "Don't count"],
];

export type MuscleExposure = {
  muscle: FineMuscle;
  /** credited sets a week */
  perWeek: number;
  /** of that, from exercises that list it as a primary muscle */
  directPerWeek: number;
  /** days a week with a set aimed at it (primary), averaged over the weeks */
  frequency: number;
  /** its share of every credited set in the period (0–1) */
  share: number;
  /** relative to the most-trained muscle: 0 none, 1–4 */
  level: 0 | 1 | 2 | 3 | 4;
  /** the exercises behind it in the period, most credited first */
  exercises: Array<{ name: string; direct: number; indirect: number; credited: number }>;
  /** credited sets each week, the 12 weeks up to the period's end (oldest first) */
  weekly: Array<{ week: string; sets: number }>;
  /** the last 4 weeks that are over against the 4 before (both with training), % */
  change: { pct: number; now: number; before: number } | null;
};

export type ExposureRead = {
  muscles: MuscleExposure[];
  /** every credited set in the period (the shares' whole) */
  totalCredited: number;
  basis: { weeks: number; partial: boolean };
  rule: SecondaryRule;
  /** working sets in the period that credit no muscle (the library doesn't say) */
  untagged: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY = 86_400_000;
const addWeeks = (monday: string, n: number) =>
  new Date(Date.parse(`${monday}T12:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10);

/** Every muscle a set credits, with the rule for secondary muscles. */
export function creditsFor(
  set: Pick<LoadSet, "primary" | "secondary" | "fallbackMuscle">,
  secondary: SecondaryRule,
): Map<FineMuscle, { w: number; primary: boolean }> {
  const out = new Map<FineMuscle, { w: number; primary: boolean }>();
  const add = (tag: string | null | undefined, w: number, primary: boolean) => {
    const m = fineMuscle(tag);
    if (!m || w <= 0) return;
    const cur = out.get(m);
    if (!cur || w > cur.w) out.set(m, { w, primary: primary || !!cur?.primary });
  };
  const primary = (set.primary ?? []).filter(Boolean);
  if (primary.length) {
    for (const t of primary) add(t, 1, true);
    for (const t of set.secondary ?? []) add(t, secondary, false);
  } else {
    add(set.fallbackMuscle ?? null, 1, true);
  }
  return out;
}

/**
 * The read. `periodSets` are the period's sets, `allSets` every set on file
 * (for the 12-week history and the change), `basisKeys` the weeks the
 * period's averages divide by (training-load's `perWeekBasis.keys`).
 */
export function buildMuscleExposure(input: {
  periodSets: LoadSet[];
  allSets: LoadSet[];
  basisKeys: string[];
  partial: boolean;
  /** the period's last day (yyyy-mm-dd), for the 12-week history */
  end: string;
  today: string;
  secondary?: SecondaryRule;
}): ExposureRead {
  const rule = input.secondary ?? 0.5;
  const counted = (s: LoadSet) => s.reps > 0 && patternOf(s) !== null;
  const basis = new Set(input.basisKeys);
  const n = Math.max(1, input.basisKeys.length);
  const per = new Map<
    FineMuscle,
    { credited: number; direct: number; days: Map<string, Set<string>> }
  >();
  const exercises = new Map<
    FineMuscle,
    Map<string, { name: string; direct: number; indirect: number }>
  >();
  let total = 0;
  let untagged = 0;
  for (const s of input.periodSets) {
    if (!counted(s)) continue;
    const credits = creditsFor(s, rule);
    if (!credits.size) {
      untagged++;
      continue;
    }
    const wk = weekOf(s.day);
    for (const [m, c] of credits) {
      total += c.w;
      const ex = exercises.get(m) ?? new Map();
      const name = s.exercise || "Exercise";
      const e = ex.get(name) ?? { name, direct: 0, indirect: 0 };
      if (c.primary) e.direct += 1;
      else e.indirect += c.w;
      ex.set(name, e);
      exercises.set(m, ex);
      if (!basis.has(wk)) continue;
      const p = per.get(m) ?? { credited: 0, direct: 0, days: new Map() };
      p.credited += c.w;
      if (c.primary) {
        p.direct += 1;
        const days = p.days.get(wk) ?? new Set<string>();
        days.add(s.dayId ?? s.day);
        p.days.set(wk, days);
      }
      per.set(m, p);
    }
  }

  // 12 weeks of history (every set on file) and the 4-against-4 change
  const lastWeek = weekOf(input.end < input.today ? input.end : input.today);
  const weeks = Array.from({ length: 12 }, (_, i) => addWeeks(lastWeek, i - 11));
  const byWeek = new Map<string, Map<FineMuscle, number>>();
  for (const s of input.allSets) {
    if (!counted(s)) continue;
    const wk = weekOf(s.day);
    const map = byWeek.get(wk) ?? new Map<FineMuscle, number>();
    for (const [m, c] of creditsFor(s, rule)) map.set(m, (map.get(m) ?? 0) + c.w);
    byWeek.set(wk, map);
  }
  const thisWeek = weekOf(input.today);
  const over = (k: string) => k < thisWeek;
  const recentOver: string[] = [];
  for (let k = addWeeks(thisWeek, -1), i = 0; i < 8; k = addWeeks(k, -1), i++)
    recentOver.unshift(k);
  const sumOf = (m: FineMuscle, ks: string[]) =>
    ks.reduce((a, k) => a + (byWeek.get(k)?.get(m) ?? 0), 0);
  const trainedIn = (ks: string[]) => ks.some((k) => (byWeek.get(k)?.size ?? 0) > 0);

  const rows: MuscleExposure[] = [];
  for (const m of FINE_MUSCLES) {
    const p = per.get(m);
    const ex = exercises.get(m);
    if (!p && !ex) continue;
    const credited = ex ? [...ex.values()].reduce((a, e) => a + e.direct + e.indirect, 0) : 0;
    if (credited <= 0) continue;
    const freqWeeks = input.basisKeys.map((k) => p?.days.get(k)?.size ?? 0);
    const nowK = recentOver.slice(-4);
    const beforeK = recentOver.slice(0, 4);
    const now = sumOf(m, nowK);
    const before = sumOf(m, beforeK);
    rows.push({
      muscle: m,
      perWeek: round1((p?.credited ?? 0) / n),
      directPerWeek: round1((p?.direct ?? 0) / n),
      frequency: round1(freqWeeks.reduce((a, b) => a + b, 0) / Math.max(1, freqWeeks.length)),
      share: total > 0 ? credited / total : 0,
      level: 0,
      exercises: [...(ex?.values() ?? [])]
        .map((e) => ({
          ...e,
          indirect: round1(e.indirect),
          credited: round1(e.direct + e.indirect),
        }))
        .sort((a, b) => b.credited - a.credited),
      weekly: weeks.map((week) => ({ week, sets: round1(byWeek.get(week)?.get(m) ?? 0) })),
      change:
        nowK.every(over) && trainedIn(nowK) && trainedIn(beforeK) && before > 0
          ? {
              pct: Math.round(((now - before) / before) * 100),
              now: round1(now / 4),
              before: round1(before / 4),
            }
          : null,
    });
  }
  // heat: relative to the most-trained muscle in the period
  const top = Math.max(0, ...rows.map((r) => r.share));
  for (const r of rows) {
    const rel = top > 0 ? r.share / top : 0;
    r.level = rel >= 0.75 ? 4 : rel >= 0.5 ? 3 : rel >= 0.25 ? 2 : rel > 0 ? 1 : 0;
  }
  rows.sort((a, b) => b.share - a.share);
  return {
    muscles: rows,
    totalCredited: round1(total),
    basis: { weeks: input.basisKeys.length, partial: input.partial },
    rule,
    untagged,
  };
}

/**
 * Where each muscle is drawn on the anatomy (the pain map's own drawing,
 * src/lib/pain/anatomy): the sites that are that muscle, on the front and
 * the back. Anything not listed (neck, shins, serratus, hip flexors) is
 * drawn without heat.
 */
export const MUSCLE_SITES: Record<FineMuscle, { front: string[]; back: string[] }> = {
  Quads: { front: ["rectus_femoris", "vastus_lateralis", "vmo"], back: [] },
  Hamstrings: { front: [], back: ["hamstring_outer", "hamstring_inner"] },
  Glutes: { front: ["tfl"], back: ["glute_max", "glute_med"] },
  Adductors: { front: ["adductors", "groin"], back: ["adductors"] },
  Calves: { front: ["calf_inner", "soleus"], back: ["calf_outer", "calf_inner", "soleus"] },
  Chest: { front: ["upper_chest", "chest"], back: [] },
  Lats: { front: ["lats"], back: ["lats", "teres_major"] },
  "Upper back": {
    front: ["upper_trap"],
    back: ["upper_trap", "mid_trap", "lower_trap", "infraspinatus", "teres_minor"],
  },
  Erectors: { front: [], back: ["erectors_mid", "erectors_low"] },
  "Front delts": { front: ["front_delt"], back: [] },
  "Side delts": { front: ["side_delt"], back: ["side_delt"] },
  "Rear delts": { front: [], back: ["rear_delt"] },
  Biceps: { front: ["biceps", "brachialis"], back: [] },
  Triceps: { front: ["triceps"], back: ["triceps"] },
  Forearms: {
    front: ["brachioradialis", "forearm_flexors"],
    back: ["brachioradialis", "forearm_flexors", "forearm_extensors"],
  },
  Abs: { front: ["abs", "obliques"], back: ["obliques"] },
};

/** site → muscle, for one view */
export function siteMuscles(view: "front" | "back"): Map<string, FineMuscle> {
  const out = new Map<string, FineMuscle>();
  for (const m of FINE_MUSCLES) for (const s of MUSCLE_SITES[m][view]) out.set(s, m);
  return out;
}
