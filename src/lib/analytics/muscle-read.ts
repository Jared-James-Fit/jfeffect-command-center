/**
 * Where training goes by muscle, three ways (pure, tested in
 * analytics-redesign.test.ts). The 3D body, its 2D fallback and the ranked
 * list all draw this; nothing is worked out on screen.
 *
 *  A · Distribution: credited sets a week (training-load.ts: a full set from
 *      exercises aimed at the muscle, half from ones that help), direct and
 *      indirect apart, days a week, the exercises behind it and its recent
 *      change.
 *  B · Goal fit: each muscle's role for THIS athlete (their goal, what they
 *      train, muscles they named in their goals) and their exposure against
 *      their OWN typical volume for a prime mover, never a universal target:
 *      supported, worth a look, a meaningful gap, or possibly more than the
 *      rest of their training (said apart, never as a fault). Under two full
 *      weeks of data it says so (grey).
 *  C · Development: only where two kinds of evidence agree. A lift that
 *      relies on the muscle has stalled or dropped (lift-strength.ts' line,
 *      or the exercise's own) AND the muscle's direct work is low or fell.
 *      Or the muscle's lifts are climbing with steady work (a strength). One
 *      signal alone says nothing. Fewer sets are never "weak", and nothing
 *      here measures growth, activation, imbalance or injury risk.
 *
 * How a supporting muscle counts is the athlete's (`supportCredit`: half a
 * set by default, the same as training-load's MUSCLE_CREDIT; a full set or
 * not at all from the map's settings), and every number here follows it:
 * the period's totals and colours (`period`, `level`), the weekly numbers,
 * goal fit and development alike.
 */
import {
  FINE_MUSCLES,
  MUSCLE_CREDIT,
  muscleCredits,
  patternOf,
  type FineMuscle,
  type LoadSet,
  type MuscleLoad,
} from "@/lib/analytics/training-load";
import type { AnalyticsProfile } from "@/lib/analytics/analytics-profile";
import {
  envelopeTrend,
  sessionEstimates,
  strengthEnvelope,
  type EnvelopeTrend,
} from "@/lib/analytics/strength-estimate";
import type { CompLift } from "@/lib/analytics/competition-strength";

export type MuscleRole = "prime" | "support" | "optional";

const PL_PRIME: FineMuscle[] = [
  "Quads",
  "Glutes",
  "Adductors",
  "Erectors",
  "Hamstrings",
  "Chest",
  "Triceps",
  "Front delts",
  "Upper back",
  "Lats",
];
const PHYSIQUE_SUPPORT: FineMuscle[] = ["Forearms", "Abs", "Erectors", "Adductors"];
const GENERAL_PRIME: FineMuscle[] = [
  "Quads",
  "Glutes",
  "Hamstrings",
  "Chest",
  "Lats",
  "Upper back",
];

/** Muscles a goal's own words name ("bigger glutes", "arms") become prime movers for that athlete. */
export function musclesNamed(text: string | null | undefined): FineMuscle[] {
  const s = String(text ?? "").toLowerCase();
  if (!s) return [];
  const out = new Set<FineMuscle>();
  const pairs: Array<[RegExp, FineMuscle[]]> = [
    [/\bglute|\bbooty|\bbutt\b|\bhips?\b/, ["Glutes"]],
    [/\bquad|\bthigh/, ["Quads"]],
    [/\bhamstring/, ["Hamstrings"]],
    [/\bcalf|\bcalves/, ["Calves"]],
    [/\bchest|\bpec/, ["Chest"]],
    [/\bback\b|\blats?\b|\bv[- ]?taper/, ["Lats", "Upper back"]],
    [/\bshoulder|\bdelt/, ["Side delts", "Rear delts", "Front delts"]],
    [/\barms?\b|\bbicep|\btricep/, ["Biceps", "Triceps"]],
    [/\babs\b|\bcore\b|\bstomach/, ["Abs"]],
    [/\blegs?\b|\blower body/, ["Quads", "Hamstrings", "Glutes"]],
  ];
  for (const [re, ms] of pairs) if (re.test(s)) ms.forEach((m) => out.add(m));
  return [...out];
}

export function muscleRoles(
  profile: AnalyticsProfile,
  named: FineMuscle[] = [],
): Record<FineMuscle, MuscleRole> {
  const out = {} as Record<FineMuscle, MuscleRole>;
  for (const m of FINE_MUSCLES) {
    if (profile === "powerlifting")
      out[m] = PL_PRIME.includes(m)
        ? "prime"
        : m === "Calves" || m === "Forearms"
          ? "optional"
          : "support";
    else if (profile === "physique") out[m] = PHYSIQUE_SUPPORT.includes(m) ? "support" : "prime";
    else out[m] = GENERAL_PRIME.includes(m) ? "prime" : m === "Forearms" ? "optional" : "support";
  }
  for (const m of named) out[m] = "prime";
  return out;
}

/** The competition lifts that rely on a muscle (what its development is read against for a powerlifter). */
export const LIFTS_FOR_MUSCLE: Partial<Record<FineMuscle, CompLift[]>> = {
  Quads: ["squat"],
  Glutes: ["squat", "deadlift"],
  Adductors: ["squat", "deadlift"],
  Hamstrings: ["deadlift"],
  Erectors: ["deadlift", "squat"],
  "Upper back": ["deadlift"],
  Lats: ["deadlift", "bench"],
  Chest: ["bench"],
  Triceps: ["bench"],
  "Front delts": ["bench"],
};

/** How a set counts for a muscle the exercise only helps (supporting / secondary). */
export type SupportCredit = 0 | 0.5 | 1;
export const DEFAULT_SUPPORT_CREDIT: SupportCredit = 0.5;
export const SUPPORT_CREDITS: Array<{ value: SupportCredit; label: string }> = [
  { value: 0.5, label: "Half a set" },
  { value: 1, label: "A full set" },
  { value: 0, label: "Don't count them" },
];
export function isSupportCredit(v: unknown): v is SupportCredit {
  return v === 0 || v === 0.5 || v === 1;
}

/** Relative training, never size, strength or growth: 0 not trained … 4 the most trained. */
export type MuscleLevel = 0 | 1 | 2 | 3 | 4;
export const MUSCLE_LEVELS: Array<{ level: MuscleLevel; label: string }> = [
  { level: 0, label: "Not trained" },
  { level: 1, label: "Lightly trained" },
  { level: 2, label: "Moderately trained" },
  { level: 3, label: "Heavily trained" },
  { level: 4, label: "Most trained" },
];
/** A muscle's level from its share of the most-trained muscle's sets (0–1). */
export function muscleLevel(share: number): MuscleLevel {
  if (!(share > 0)) return 0;
  if (share >= 0.9) return 4;
  if (share >= 0.6) return 3;
  if (share >= 0.3) return 2;
  return 1;
}

export type MusclePeriod = {
  /** sets counted for it this period (aimed at it, plus supporting sets at the chosen credit) */
  total: number;
  /** sets from exercises aimed at it */
  direct: number;
  /** sets where it helped (each counted at the chosen credit) */
  supporting: number;
  /** days it got a counted set */
  days: number;
  /** different exercises that trained it */
  exerciseCount: number;
  /** the same number of days just before this period, counted the same way; null with no training on file before it */
  before: { total: number; start: string; end: string } | null;
  /** % change against `before` (null when there's nothing to compare) */
  changePct: number | null;
};

export type FitStatus = "supported" | "look" | "gap" | "more" | "unknown";
export type DevStatus = "strength" | "opportunity" | "steady" | "unknown";

export type MuscleReadRow = {
  muscle: FineMuscle;
  role: MuscleRole;
  /** credited sets a week (direct + supporting at the chosen credit) */
  perWeek: number;
  directPerWeek: number;
  indirectPerWeek: number;
  frequency: number;
  changePct: number | null;
  exercises: Array<{ name: string; sets: number; direct: boolean }>;
  averageRpe?: number | null;
  targetSets?: number | null;
  /** 0–1 against the most-trained muscle's sets this period (the map's colour) */
  share: number;
  level: MuscleLevel;
  period: MusclePeriod;
  fit: { status: FitStatus; words: string; floor: number | null };
  dev: {
    status: DevStatus;
    title: string | null;
    why: string | null;
    evidence: string[];
    consider: string | null;
  };
};

export type MuscleRead = {
  rows: MuscleReadRow[];
  /** the athlete's typical credited sets a week for a prime mover: what "low" and "high" are read against */
  reference: number;
  enoughData: boolean;
  weeks: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const absPct = (t: EnvelopeTrend) =>
  t.kind === "up" || t.kind === "down" || t.kind === "steady" ? `${Math.abs(t.pct)}%` : "";

export function buildMuscleRead(input: {
  muscles: MuscleLoad[];
  /** the period's working sets (for the exercises behind each muscle and their trends) */
  sets: LoadSet[];
  /** every set on file (exercise trends read history before the period) */
  history?: LoadSet[];
  weeks: number;
  partial: boolean;
  profile: AnalyticsProfile;
  named?: FineMuscle[];
  /** the competition lifts' trend across the period */
  liftTrends?: Partial<Record<CompLift, EnvelopeTrend>>;
  start: string;
  end: string;
  /** the athlete has a coach (advice goes through them) */
  coached: boolean;
  /** how a supporting muscle's set counts (half by default) */
  supportCredit?: SupportCredit;
  plan?: import("@/lib/analytics/training-load").PlanRow[];
  /** yyyy-mm-dd: a period that runs past today is compared up to today */
  today?: string;
}): MuscleRead {
  const credit = input.supportCredit ?? DEFAULT_SUPPORT_CREDIT;
  const roles = muscleRoles(input.profile, input.named ?? []);
  // training-load's weekly numbers credit a supporting set half; rescale them to the chosen credit
  const loads = new Map(
    input.muscles.map((m) => {
      const support = Math.max(0, m.perWeek - m.directPerWeek) / MUSCLE_CREDIT.secondary;
      return [m.muscle, credit === MUSCLE_CREDIT.secondary ? m : { ...m, perWeek: m.directPerWeek + credit * support }];
    }),
  );
  const weeks = Math.max(1, input.weeks);
  const enoughData = !input.partial && input.weeks >= 2 && input.sets.length >= 20;
  const counted = (ss: LoadSet[]) => ss.filter((s) => s.day && s.reps > 0 && patternOf(s) !== null);
  const periodSets = counted(input.sets).filter(s=>s.day <= (input.today ?? input.end));
  const planned = new Map<FineMuscle,number>();
  const effort = new Map<FineMuscle,{sum:number;n:number}>();
  for(const p of input.plan??[]){if(!p.day||p.day<input.start||p.day>input.end||p.day>(input.today??input.end)||!(Number(p.sets)>0)||patternOf(p)===null)continue;for(const [m,w] of muscleCredits(p))planned.set(m,(planned.get(m)??0)+Number(p.sets)*(w>=1?1:credit));}
  // the exercises behind each muscle, and the period's own counts
  const byMuscle = new Map<FineMuscle, Map<string, { sets: number; direct: boolean }>>();
  const tally = new Map<FineMuscle, { direct: number; supporting: number; days: Set<string> }>();
  for (const s of periodSets) {
    const credits = muscleCredits(s);
    for (const [m, w] of credits) {
      const direct = w >= MUSCLE_CREDIT.primary;
      const rating=s.rpe??(s.rir==null?null:10-s.rir);if((direct||credit>0)&&rating!=null&&rating>=1&&rating<=10){const e=effort.get(m)??{sum:0,n:0};e.sum+=rating;e.n++;effort.set(m,e);}
      const ex = byMuscle.get(m) ?? new Map();
      const cur = ex.get(s.exercise) ?? { sets: 0, direct: false };
      cur.sets += 1;
      cur.direct = cur.direct || direct;
      ex.set(s.exercise, cur);
      byMuscle.set(m, ex);
      const t = tally.get(m) ?? { direct: 0, supporting: 0, days: new Set<string>() };
      if (direct) t.direct++;
      else t.supporting++;
      if (direct || credit > 0) t.days.add(s.dayId ?? s.day);
      tally.set(m, t);
    }
  }
  // the same number of days just before the period, counted the same way
  const endDay = input.today && input.today < input.end ? input.today : input.end;
  const span = isoDay(input.start) && isoDay(endDay) ? dayNum(endDay) - dayNum(input.start) + 1 : 0;
  const hist = counted(input.history ?? input.sets);
  const before =
    span > 0 && hist.some((s) => s.day >= dayStr(dayNum(input.start) - span) && s.day < input.start)
      ? { start: dayStr(dayNum(input.start) - span), end: dayStr(dayNum(input.start) - 1) }
      : null;
  const beforeTotals = new Map<FineMuscle, number>();
  if (before)
    for (const s of hist) {
      if (s.day < before.start || s.day > before.end) continue;
      for (const [m, w] of muscleCredits(s))
        beforeTotals.set(m, (beforeTotals.get(m) ?? 0) + (w >= MUSCLE_CREDIT.primary ? 1 : credit));
    }
  const periodTotal = (m: FineMuscle) => {
    const t = tally.get(m);
    return t ? t.direct + credit * t.supporting : 0;
  };
  const maxTotal = Math.max(0, ...FINE_MUSCLES.map(periodTotal));
  // the athlete's own typical prime-mover volume
  const primeVols = FINE_MUSCLES.filter((m) => roles[m] === "prime")
    .map((m) => loads.get(m)?.perWeek ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const reference = primeVols.length ? primeVols[Math.floor(primeVols.length / 2)] : 0;
  const primeFloor = Math.max(3, round1(reference * 0.5));
  const supportFloor = Math.max(1.5, round1(reference * 0.25));
  const highLine = Math.max(22, reference * 2);

  // exercise trends (estimated strength across the period), by the muscles they aim at
  const exTrend = new Map<string, { trend: EnvelopeTrend; muscles: FineMuscle[] }>();
  const byEx = new Map<string, LoadSet[]>();
  for (const s of hist)
    if (s.loadKg > 0) (byEx.get(s.exercise) ?? byEx.set(s.exercise, []).get(s.exercise)!).push(s);
  for (const [name, ss] of byEx) {
    const sess = sessionEstimates(
      ss.map((s) => ({ day: s.day, load: s.loadKg, reps: s.reps, rpe: s.rpe, rir: s.rir })),
    );
    const env = strengthEnvelope(sess);
    const trend = envelopeTrend(env, input.start, input.end);
    const primary = [...muscleCredits(ss[0])].filter(([, w]) => w >= 1).map(([m]) => m);
    exTrend.set(name, { trend, muscles: primary });
  }

  const rows: MuscleReadRow[] = FINE_MUSCLES.map((muscle) => {
    const l = loads.get(muscle);
    const perWeek = round1(l?.perWeek ?? 0);
    const direct = round1(l?.directPerWeek ?? 0);
    const allExercises = [...(byMuscle.get(muscle) ?? new Map()).entries()]
      .map(([name, v]) => ({ name, sets: v.sets, direct: v.direct }))
      .sort((a, b) => Number(b.direct) - Number(a.direct) || b.sets - a.sets);
    const exercises = allExercises.slice(0, 6);
    const t = tally.get(muscle);
    const total = round1(periodTotal(muscle));
    const was = before ? round1(beforeTotals.get(muscle) ?? 0) : null;
    const period: MusclePeriod = {
      total,
      direct: t?.direct ?? 0,
      supporting: t?.supporting ?? 0,
      days: t?.days.size ?? 0,
      exerciseCount: allExercises.filter((e) => e.direct || credit > 0).length,
      before: before && was != null ? { total: was, ...before } : null,
      changePct: was != null && was > 0 ? Math.round(((total - was) / was) * 100) : null,
    };
    const role = roles[muscle];
    // B · goal fit
    let fit: MuscleReadRow["fit"];
    if (!enoughData)
      fit = {
        status: "unknown",
        words: "Not enough weeks of training in this period to tell yet.",
        floor: null,
      };
    else if (perWeek >= highLine) {
      fit = {
        status: "more",
        words: `About ${perWeek} sets a week, much more than your other main muscles get (about ${round1(reference)}). Fine if that's the plan; just keep an eye on recovery.`,
        floor: null,
      };
    } else if (role === "prime" && perWeek < 1) {
      fit = {
        status: "gap",
        words: `Almost no sets for it yet, and it's a main muscle for your goal. That says nothing about how strong it is.`,
        floor: primeFloor,
      };
    } else if (role === "prime" && perWeek < primeFloor) {
      fit = {
        status: "look",
        words: `About ${perWeek} sets a week, under half of what your other main muscles get (about ${round1(reference)}). Worth a look if you want it to keep up.`,
        floor: primeFloor,
      };
    } else if (role === "prime" && (l?.changePct ?? 0) <= -40 && perWeek < primeFloor * 1.5) {
      fit = {
        status: "look",
        words: `Down ${Math.abs(l!.changePct!)}% over the last two weeks compared with the two before, to about ${perWeek} sets a week.`,
        floor: primeFloor,
      };
    } else if (role === "support" && perWeek > 0 && perWeek < supportFloor) {
      fit = {
        status: "supported",
        words: `About ${perWeek} sets a week. It plays a supporting role for your goal, so that's plenty.`,
        floor: supportFloor,
      };
    } else {
      fit = {
        status: "supported",
        words:
          perWeek > 0
            ? `About ${perWeek} sets a week${l?.frequency ? `, on about ${round1(l.frequency)} days a week` : ""}.`
            : role === "optional"
              ? "No sets aimed at it, and it's optional for your goal."
              : "No sets aimed at it right now.",
        floor: role === "prime" ? primeFloor : null,
      };
    }
    // C · development: two kinds of evidence must agree
    let dev: MuscleReadRow["dev"] = {
      status: "unknown",
      title: null,
      why: null,
      evidence: [],
      consider: null,
    };
    if (enoughData) {
      const liftTrends = (LIFTS_FOR_MUSCLE[muscle] ?? [])
        .map((lift) => ({ name: lift === "bench" ? "bench" : lift, t: input.liftTrends?.[lift] }))
        .filter((x): x is { name: string; t: EnvelopeTrend } => !!x.t && x.t.kind !== "unclear");
      const exTrends = [...exTrend.entries()]
        .filter(([, v]) => v.muscles.includes(muscle) && v.trend.kind !== "unclear")
        .map(([name, v]) => ({ name, t: v.trend }));
      const signals = input.profile === "powerlifting" && liftTrends.length ? liftTrends : exTrends;
      const ups = signals.filter((x) => x.t.kind === "up");
      const flats = signals.filter((x) => x.t.kind === "steady" || x.t.kind === "down");
      const lowWork = direct < primeFloor * 0.6 || (l?.changePct ?? 0) <= -30;
      if (ups.length && !flats.length) {
        dev = {
          status: "strength",
          title: "Its lifts are improving",
          why: `Your ${ups[0].name}${ups.length > 1 ? ` and ${ups.length - 1} more` : ""} ${ups.length > 1 ? "are" : "is"} getting stronger, with steady work for this muscle.`,
          evidence: ups.map(
            (u) => `${cap(u.name)}: estimated max up ${absPct(u.t)} this period`,
          ),
          consider: null,
        };
      } else if (flats.length && role === "prime" && lowWork) {
        const f = flats[0];
        const evidence = [
          `${cap(f.name)}: estimated max ${f.t.kind === "down" ? `down ${absPct(f.t)}` : "about the same"} this period`,
          `${muscle}: ${direct} sets a week aimed at it${l?.changePct != null && l.changePct < 0 ? `, down ${Math.abs(l.changePct)}% lately` : ""}`,
        ];
        dev = {
          status: "opportunity",
          title: "Worth a look",
          why: `Your ${f.name} has ${f.t.kind === "down" ? "dipped" : "levelled off"}, and the sets aimed at your ${muscle.toLowerCase()} are ${l?.changePct != null && l.changePct <= -30 ? "dropping" : "on the light side"}. Two signs that line up, not a verdict.`,
          evidence,
          consider: input.coached
            ? `Asking your coach about your ${muscle.toLowerCase()} work.`
            : `Whether a few more sets for your ${muscle.toLowerCase()} fit your goals and recovery.`,
        };
      } else if (signals.length) {
        dev = {
          status: "steady",
          title: null,
          why: null,
          evidence: signals
            .slice(0, 2)
            .map(
              (s) =>
                `${cap(s.name)}: estimated max ${s.t.kind === "up" ? `up ${absPct(s.t)}` : s.t.kind === "down" ? `down ${absPct(s.t)}` : "about the same"}`,
            ),
          consider: null,
        };
      }
    }
    const targetSets=planned.size?round1(planned.get(muscle)??0):null;
    if(targetSets!=null){fit=targetSets===0?{status:total>0?"more":"supported",words:total>0?"Training outside the elapsed plan.":"No work planned in elapsed period.",floor:0}:{status:total<targetSets*.8?"gap":total>targetSets*1.2?"more":"supported",words:`${fmtSets(total)} completed / ${fmtSets(targetSets)} planned credited sets in elapsed period.`,floor:targetSets};}
    const ratings=effort.get(muscle);
    return {
      muscle,
      averageRpe:ratings?round1(ratings.sum/ratings.n):null,
      targetSets,
      role,
      perWeek,
      directPerWeek: direct,
      indirectPerWeek: round1(Math.max(0, perWeek - direct)),
      frequency: round1(l?.frequency ?? 0),
      changePct: l?.changePct ?? null,
      exercises,
      share: maxTotal > 0 ? total / maxTotal : 0,
      level: muscleLevel(maxTotal > 0 ? total / maxTotal : 0),
      period,
      fit,
      dev,
    };
  });
  return { rows, reference: round1(reference), enoughData, weeks: input.weeks };
}

/**
 * Each muscle's sets in a window against the same number of days just before
 * it, counted the same way as the map (direct sets, plus supporting ones at
 * the chosen credit). Cleo reads the last six weeks with it.
 */
export function muscleWindowChanges(input: {
  sets: LoadSet[];
  start: string;
  end: string;
  profile: AnalyticsProfile;
  named?: FineMuscle[];
  supportCredit?: SupportCredit;
}): Array<{ muscle: FineMuscle; role: MuscleRole; total: number; before: number; changePct: number }> {
  const credit = input.supportCredit ?? DEFAULT_SUPPORT_CREDIT;
  if (!isoDay(input.start) || !isoDay(input.end)) return [];
  const span = dayNum(input.end) - dayNum(input.start) + 1;
  const bStart = dayStr(dayNum(input.start) - span);
  const roles = muscleRoles(input.profile, input.named ?? []);
  const now = new Map<FineMuscle, number>();
  const was = new Map<FineMuscle, number>();
  for (const s of input.sets) {
    if (!s.day || !(s.reps > 0) || patternOf(s) === null) continue;
    const bucket = s.day >= input.start && s.day <= input.end ? now : s.day >= bStart && s.day < input.start ? was : null;
    if (!bucket) continue;
    for (const [m, w] of muscleCredits(s))
      bucket.set(m, (bucket.get(m) ?? 0) + (w >= MUSCLE_CREDIT.primary ? 1 : credit));
  }
  return FINE_MUSCLES.filter((m) => (was.get(m) ?? 0) > 0).map((m) => {
    const total = round1(now.get(m) ?? 0);
    const before = round1(was.get(m) ?? 0);
    return { muscle: m, role: roles[m], total, before, changePct: Math.round(((total - before) / before) * 100) };
  });
}

/** The period's change in words ("Up 25% from Sep 27 – Oct 25 (16 → 20 sets)."), or null with nothing to compare. */
export function periodChangeWords(p: MusclePeriod, beforeLabel = "the period before"): string | null {
  if (!p.before) return null;
  if (p.before.total <= 0 && p.total <= 0) return null;
  if (p.before.total <= 0) return `New: no sets for it in ${beforeLabel}.`;
  const pct = p.changePct ?? 0;
  const nums = `${fmtSets(p.before.total)} → ${fmtSets(p.total)} sets`;
  if (Math.abs(pct) < 5) return `About the same as ${beforeLabel} (${nums}).`;
  return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% from ${beforeLabel} (${nums}).`;
}

/** Sets as people say them: whole, else one decimal (a supporting set can count half). */
export function fmtSets(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}

const isoDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const dayStr = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Compare equal elapsed windows, with the same muscle attribution on both sides. */
export function compareMuscleWindows(read: MuscleRead, history: LoadSet[], a: {start:string;end:string}, b:{start:string;end:string}, credit:SupportCredit): MuscleRead {
  if (![a.start,a.end,b.start,b.end].every(isoDay)) return read;
  const span=Math.min(dayNum(a.end)-dayNum(a.start)+1,dayNum(b.end)-dayNum(b.start)+1);
  if(span<=0)return read;
  const aEnd=dayStr(dayNum(a.start)+span-1),bEnd=dayStr(dayNum(b.start)+span-1);
  const count=(start:string,end:string)=>{
    const ss=history.filter(s=>s.day>=start&&s.day<=end&&s.reps>0&&patternOf(s)!==null);
    const map=new Map<FineMuscle,{direct:number;supporting:number;days:Set<string>;ex:Map<string,{sets:number;direct:boolean}>}>();
    for(const s of ss)for(const [m,w] of muscleCredits(s)){
      const t=map.get(m)??{direct:0,supporting:0,days:new Set<string>(),ex:new Map<string,{sets:number;direct:boolean}>()};
      const direct=w>=1;if(direct)t.direct++;else t.supporting++;
      if(direct||credit>0){t.days.add(s.day);const e=t.ex.get(s.exercise)??{sets:0,direct:false};e.sets++;e.direct||=direct;t.ex.set(s.exercise,e);}
      map.set(m,t);
    }
    return {map,hasData:ss.length>0};
  };
  const now=count(a.start,aEnd),prev=count(b.start,bEnd);
  const rows=read.rows.map(r=>{
    const n=now.map.get(r.muscle),p=prev.map.get(r.muscle),total=round1((n?.direct??0)+credit*(n?.supporting??0)),before=round1((p?.direct??0)+credit*(p?.supporting??0));
    const exercises=[...(n?.ex??new Map<string,{sets:number;direct:boolean}>())].map(([name,v])=>({name,...v})).sort((x,y)=>y.sets-x.sets).slice(0,6);
    return {...r,perWeek:round1(total*7/span),averageRpe:null,targetSets:null,exercises,period:{total,direct:n?.direct??0,supporting:n?.supporting??0,days:n?.days.size??0,exerciseCount:n?.ex.size??0,before:now.hasData&&prev.hasData?{total:before,start:b.start,end:bEnd}:null,changePct:now.hasData&&prev.hasData&&before>0?Math.round((total-before)/before*100):null}};
  });
  return {...read,rows,weeks:span/7,enoughData:now.hasData&&prev.hasData};
}
