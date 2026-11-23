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
 */
import {
  FINE_MUSCLES,
  muscleCredits,
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

export type FitStatus = "supported" | "look" | "gap" | "more" | "unknown";
export type DevStatus = "strength" | "opportunity" | "steady" | "unknown";

export type MuscleReadRow = {
  muscle: FineMuscle;
  role: MuscleRole;
  /** credited sets a week (direct + half the indirect) */
  perWeek: number;
  directPerWeek: number;
  indirectPerWeek: number;
  frequency: number;
  changePct: number | null;
  exercises: Array<{ name: string; sets: number; direct: boolean }>;
  /** 0–1 against the most-trained muscle (Distribution's colour) */
  share: number;
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
const pctWord = (t: EnvelopeTrend) =>
  t.kind === "up" || t.kind === "down" || t.kind === "steady"
    ? `${t.pct > 0 ? "+" : ""}${t.pct}%`
    : "";

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
}): MuscleRead {
  const roles = muscleRoles(input.profile, input.named ?? []);
  const loads = new Map(input.muscles.map((m) => [m.muscle, m]));
  const weeks = Math.max(1, input.weeks);
  const enoughData = !input.partial && input.weeks >= 2 && input.sets.length >= 20;
  // the exercises behind each muscle
  const byMuscle = new Map<FineMuscle, Map<string, { sets: number; direct: boolean }>>();
  for (const s of input.sets) {
    const credits = muscleCredits(s);
    for (const [m, w] of credits) {
      const ex = byMuscle.get(m) ?? new Map();
      const cur = ex.get(s.exercise) ?? { sets: 0, direct: false };
      cur.sets += 1;
      cur.direct = cur.direct || w >= 1;
      ex.set(s.exercise, cur);
      byMuscle.set(m, ex);
    }
  }
  // the athlete's own typical prime-mover volume
  const primeVols = FINE_MUSCLES.filter((m) => roles[m] === "prime")
    .map((m) => loads.get(m)?.perWeek ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const reference = primeVols.length ? primeVols[Math.floor(primeVols.length / 2)] : 0;
  const primeFloor = Math.max(3, round1(reference * 0.5));
  const supportFloor = Math.max(1.5, round1(reference * 0.25));
  const highLine = Math.max(22, reference * 2);
  const max = Math.max(1, ...input.muscles.map((m) => m.perWeek));

  // exercise trends (estimated strength across the period), by the muscles they aim at
  const exTrend = new Map<string, { trend: EnvelopeTrend; muscles: FineMuscle[] }>();
  const hist = input.history ?? input.sets;
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
    const exercises = [...(byMuscle.get(muscle) ?? new Map()).entries()]
      .map(([name, v]) => ({ name, sets: v.sets, direct: v.direct }))
      .sort((a, b) => Number(b.direct) - Number(a.direct) || b.sets - a.sets)
      .slice(0, 4);
    const role = roles[muscle];
    // B · goal fit
    let fit: MuscleReadRow["fit"];
    if (!enoughData)
      fit = {
        status: "unknown",
        words: "Not enough weeks of training here to read yet.",
        floor: null,
      };
    else if (perWeek >= highLine) {
      fit = {
        status: "more",
        words: `About ${perWeek} sets a week, well above what your other main muscles get (${round1(reference)}). Fine if it's on purpose; worth checking it isn't costing recovery.`,
        floor: null,
      };
    } else if (role === "prime" && perWeek < 1) {
      fit = {
        status: "gap",
        words: `Almost no work for it, and it matters for your goal.`,
        floor: primeFloor,
      };
    } else if (role === "prime" && perWeek < primeFloor) {
      fit = {
        status: "look",
        words: `About ${perWeek} sets a week, under half of what your other main muscles get (${round1(reference)}).`,
        floor: primeFloor,
      };
    } else if (role === "prime" && (l?.changePct ?? 0) <= -40 && perWeek < primeFloor * 1.5) {
      fit = {
        status: "look",
        words: `Down ${Math.abs(l!.changePct!)}% over the last two weeks, to about ${perWeek} sets a week.`,
        floor: primeFloor,
      };
    } else if (role === "support" && perWeek > 0 && perWeek < supportFloor) {
      fit = {
        status: "supported",
        words: `About ${perWeek} sets a week; a supporting muscle for your goal.`,
        floor: supportFloor,
      };
    } else {
      fit = {
        status: "supported",
        words:
          perWeek > 0
            ? `About ${perWeek} sets a week${l?.frequency ? `, ${round1(l.frequency)} days a week` : ""}.`
            : role === "optional"
              ? "Not trained directly; optional for your goal."
              : "Not trained directly right now.",
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
          title: "Progressing",
          why: `${cap(ups[0].name)} ${ups.length > 1 ? `and ${ups.length - 1} more` : ""} trending up with steady work for it.`.replace(
            /\s+/g,
            " ",
          ),
          evidence: ups.map(
            (u) => `${cap(u.name)}: estimated strength ${pctWord(u.t)} across the period`,
          ),
          consider: null,
        };
      } else if (flats.length && role === "prime" && lowWork) {
        const f = flats[0];
        const evidence = [
          `${cap(f.name)}: estimated strength ${f.t.kind === "down" ? `down ${pctWord(f.t)}` : "about the same"} across the period`,
          `${muscle}: ${direct} direct sets a week${l?.changePct != null && l.changePct < 0 ? `, down ${Math.abs(l.changePct)}% recently` : ""}`,
        ];
        dev = {
          status: "opportunity",
          title: "Development opportunity",
          why: `${cap(f.name)} has ${f.t.kind === "down" ? "dipped" : "levelled off"} while direct ${muscle.toLowerCase()} work is ${l?.changePct != null && l.changePct <= -30 ? "dropping" : "light"}.`,
          evidence,
          consider: input.coached
            ? `Reviewing ${muscle.toLowerCase()} accessory work with your coach.`
            : `Whether a little more direct ${muscle.toLowerCase()} work fits your goals and recovery.`,
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
                `${cap(s.name)}: ${s.t.kind === "up" ? `up ${pctWord(s.t)}` : s.t.kind === "down" ? `down ${pctWord(s.t)}` : "about the same"}`,
            ),
          consider: null,
        };
      }
    }
    return {
      muscle,
      role,
      perWeek,
      directPerWeek: direct,
      indirectPerWeek: round1(Math.max(0, perWeek - direct)),
      frequency: round1(l?.frequency ?? 0),
      changePct: l?.changePct ?? null,
      exercises,
      share: perWeek / max,
      fit,
      dev,
    };
  });
  return { rows, reference: round1(reference), enoughData, weeks: input.weeks };
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
