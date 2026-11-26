/**
 * Every heuristic the strength engine uses, in one place, with why. Where the
 * research gives a direction but no exact threshold, the number here is a
 * documented coaching default, not a finding: change it only with a replay of
 * real logs (scripts/strength-intel/replay.ts) showing it behaves better.
 *
 * Sources for the directions (not the exact numbers):
 *  - RPE/RIR scale for resistance training: Zourdos et al. 2016; Helms et al.
 *    2016. Ratings are most accurate close to failure and on low reps; lifters
 *    under-call what's left the further they are from failure.
 *  - Reps-to-%1RM differs between lifters and lifts (Richens & Cleather 2014;
 *    Nuzzo et al. 2023 meta-analysis), so a 5-rep set says less about a single
 *    than a double does, and an athlete's own rep strength is learned.
 *  - Tapering/peaking raises maximal strength a few percent over training-day
 *    capacity (Pritchard et al. 2015; Travis et al. 2020).
 *  - Maximal strength is largely kept through 3–4 weeks without training and
 *    falls slowly after (Bosquet et al. 2013; McMaster et al. 2013).
 *  - Load–velocity relationships are individual and lift-specific (Helms et
 *    al. 2017; Banyard et al. 2018): never a universal threshold.
 */
export const STRENGTH_RULES = {
  // ---- what a set can say ----------------------------------------------------
  /** Below this effort a set says nothing about a max (a warm-up's territory). */
  MIN_INFORMATIVE_RPE: 5,
  /** Over this many reps a set says nothing about a max. */
  MAX_INFORMATIVE_REPS: 12,
  /** A set that can SHOW a max: this effort or harder, this many reps or fewer. */
  HARD_RPE: 7,
  HARD_MAX_REPS: 10,
  /** Reps in reserve a lighter set is credited, at most (a conservative lower bound). */
  LIGHT_RIR_CREDIT: 2,

  // ---- how much one piece of evidence is worth (0–1) --------------------------
  /** Singles, doubles and triples say the most about a max; the rest less and less. */
  repReliability(reps: number): number {
    if (reps <= 1) return 1;
    if (reps === 2) return 0.97;
    if (reps === 3) return 0.94;
    if (reps <= 5) return 0.88;
    if (reps === 6) return 0.82;
    if (reps <= 8) return 0.74;
    if (reps <= 10) return 0.65;
    return 0.5;
  },
  /** Close to failure the call is most accurate. */
  effortReliability(effort: number): number {
    if (effort >= 9) return 1;
    if (effort >= 8) return 0.95;
    return 0.85;
  },
  /** An unrated set is read as if taken to failure: a lower bound worth less than a rated one. */
  UNRATED_RELIABILITY: 0.5,
  /** A secondary or tertiary exposure of the lift (often done tired, after other work). */
  SECONDARY_FACTOR: 0.92,
  /** The lift done after another competition lift in the same session. */
  AFTER_OTHER_LIFT_FACTOR: 0.93,
  /** A meet where the best lift was the opener and two attempts after it were missed. */
  OPENER_ONLY_MEET_RELIABILITY: 0.6,

  // ---- how the estimate moves ------------------------------------------------
  /** Evidence within this share of the estimate agrees with it (normal day-to-day variation). */
  AGREE_BAND: 0.03,
  /** A lighter set (a lower bound over the estimate) moves it this share of the way: it contributes, it never sets a max alone. */
  LOWER_BOUND_GAIN: 0.5,
  /** A hard set that agrees nudges the estimate this share of the way (smoothing). */
  AGREE_GAIN: 0.25,
  /** A meet under the training estimate moves it this share of the way (one bad day exists). */
  MEET_UNDER_GAIN: 0.75,
  /** Lower hard sessions needed before the estimate falls, when they're comparable (the same rep band as what set it). */
  FALL_SESSIONS: 2,
  /** … and when they aren't (sets of 5 under a single): a sustained month of them. */
  FALL_SESSIONS_OTHER_BAND: 4,
  FALL_SPAN_DAYS_OTHER_BAND: 21,
  /** How long lower sessions count toward one decline. */
  FALL_WINDOW_DAYS: 35,
  /** The most it falls per week while declines are comparable / not. */
  MAX_FALL_PER_WEEK: 0.02,
  MAX_FALL_PER_WEEK_OTHER_BAND: 0.01,
  /** In a fatigue phase (accumulation, after a meet, a cut, illness, injury): one more session needed, half the rate. */
  FATIGUE_EXTRA_SESSIONS: 1,
  FATIGUE_RATE_FACTOR: 0.5,
  /** After a meet the athlete is recovering: lower sessions are fatigue, not lost strength. */
  POST_MEET_RECOVERY_DAYS: 14,
  /** Far off the median of the estimates around it (a unit slip, a mistyped rep count): kept out. */
  OUTLIER_HIGH: 1.35,
  OUTLIER_LOW: 0.65,
  OUTLIER_WINDOW_DAYS: 60,

  // ---- staleness and time off ------------------------------------------------
  /** Without a hard set for this long the estimate is "held", then "stale". */
  STALE_DAYS: 56,
  /** Evidence loses half its weight in the confidence every this many days. */
  CONFIDENCE_HALF_LIFE_DAYS: 42,
  /** No session of the lift at all for longer than this: time off, and strength starts to fade. */
  INTERRUPTION_DAYS: 28,
  /** … at this much per week past it, at most `MAX_TIME_OFF_LOSS` in all. */
  TIME_OFF_LOSS_PER_WEEK: 0.005,
  MAX_TIME_OFF_LOSS: 0.1,
  /** Nothing in the log for this long: the old estimate is history, not today's strength. It starts again from new evidence. */
  FRESH_START_DAYS: 180,
  /** Past STALE_DAYS without a hard set, confidence halves every this many days. */
  STALE_CONFIDENCE_HALF_LIFE_DAYS: 28,
  /** Training on with no hard set for this long: the estimate isn't anchored forever, it eases down … */
  NO_HARD_SET_DRIFT_AFTER_DAYS: 112,
  NO_HARD_SET_DRIFT_PER_WEEK: 0.005,
  /** … never below the best lighter set it has seen since, and never more than this in all. */
  MAX_NO_HARD_SET_DRIFT: 0.08,

  // ---- calibration to the athlete --------------------------------------------
  /** Platform over training-day capacity, before any of the athlete's own meets say otherwise. */
  DEFAULT_PEAK_PREMIUM: 1.025,
  PEAK_PREMIUM_MIN: 0.97,
  PEAK_PREMIUM_MAX: 1.08,
  /** Prior weight (in meets) the default keeps against the athlete's own. */
  PEAK_PREMIUM_PRIOR: 2,
  /** How far before a meet its training line is read (before the taper). */
  PEAK_READ_DAYS_BEFORE: 21,
  /** Rep strength: low-rep vs higher-rep hard sets within this many days of each other. */
  REP_PAIR_DAYS: 21,
  REP_FACTOR_MIN: 0.94,
  REP_FACTOR_MAX: 1.08,
  REP_FACTOR_PRIOR: 3,
  /** RPE consistency: the scatter of hard-set estimates (robust SD, share) past which RPE-read evidence counts less. */
  RPE_SCATTER_OK: 0.05,
  RPE_SCATTER_POOR: 0.09,

  // ---- what a program may plan from -------------------------------------------
  /** A % of e1RM reads the estimate only at this confidence or more (else the RPE leads). */
  PLAN_MIN_CONFIDENCE: 0.3,
  /** … and only with this many sessions or meets behind it (one typed set is never a max). */
  PLAN_MIN_POINTS: 2,
  /** How far back a read goes: long enough to hold through an off-season. */
  READ_DAYS: 365,

  // ---- velocity -----------------------------------------------------------------
  /** A video read counts only at this quality and uncertainty (m/s) or better. */
  VELOCITY_MAX_UNCERTAINTY: 0.06,
  /** Agreement with the athlete's own load–velocity line raises a set's reliability this much (capped at 1). */
  VELOCITY_AGREE_FACTOR: 1.1,
  /** A hard-rated set clearly slower than expected, or a light-rated one clearly faster, counts this much less. */
  VELOCITY_DISAGREE_FACTOR: 0.7,

  // ---- today ------------------------------------------------------------------
  /** Today's best set this far over / under the estimate is said ("moving well", "heavy today"). */
  DAILY_STRONG: 0.03,
  DAILY_HEAVY: -0.04,
} as const;

export const DAY_MS = 86_400_000;
export const LB_PER_KG = 2.2046226218;
export const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);

/** Confidence in words: what the ⓘ says. */
export function confidenceWord(c: number): "high" | "moderate" | "low" {
  return c >= 0.7 ? "high" : c >= 0.4 ? "moderate" : "low";
}
