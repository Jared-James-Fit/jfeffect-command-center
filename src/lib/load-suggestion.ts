import { logLoadInUnit } from "@/lib/workout-pr";
import { parseRepTarget } from "@/lib/set-input-cascade";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

// ───────────────────────────────────────────────────────────────────────────
// RPE-based load suggestions ("what should I put on the bar for this set?").
//
// Model, in powerlifting terms:
//   1. Every logged working set is converted with the RTS RPE chart (%1RM as
//      a function of reps + reps in reserve) into "the load you'd use for the
//      target reps @ target RPE".
//   2. Athletes rate RPE on their own scale (±1 is normal, pre-filled values
//      often go unchanged), so the chart correction is only partly trusted and
//      sets at similar reps/RPE count most. The athlete's own sets anchor the
//      number; the chart bridges the gap.
//   3. Recent sessions dominate, so a program's heavy/light weeks and real
//      progress show up quickly. How history is read depends on the lift
//      (HISTORY_PROFILES): the competition lifts trust the chart more and match
//      history tightly on reps and RPE (heavy / light days and waves, rated
//      with care); everything else stays near the load actually used, mostly
//      the last session (accessories repeat and progress from last time).
//   4. History needs at least 2 sessions spanning a week for a full cold
//      suggestion. One recent session with an RPE (within 4 weeks) gives an
//      "early estimate" with a wider range; with less, the card says what
//      unlocks one.
//   5. Once a set is logged TODAY, today's sets dominate (75%): the top set
//      calibrates the back-offs, like RPE-based autoregulation. This works even
//      for a brand-new exercise after its first set.
//   6. Predicted readiness (last review: session RPE, pain, sleep, recovery,
//      faded by time) and a layoff (>3 weeks) can only trim a cold suggestion.
//   7. The range is target RPE ±0.5 widened to the error measured on real
//      client logs, so most sets genuinely land inside it.
//   8. SBD lifts can take an optional FINAL WARM-UP (load × reps, optional RPE)
//      before the first working set. It is submaximal by design and a rating far
//      from failure is a poor guess (Nov 20 2026, 6,149 rated sets: a set's chart
//      max spreads ~3.5% per rep in reserve, and at RPE 5 or easier it reads ~16%
//      LIGHT, ±25%), so it is deliberately weak and read for what it can say: it
//      only nudges a history-based suggestion (+1.5% / −3% at most, so a heavy
//      warm-up backs you off more readily than an easy one pushes you up); a
//      read LIGHTER than history pulls down only as far as its rating can be
//      believed (warmupReliability: all of it at RPE 7+, none at 5 or easier, a
//      smooth ramp between), while a read HEAVIER is a lower bound however easy
//      (an easy rating reads light), so it keeps its small up; every warm-up
//      near the heaviest is read together, the same in any order (readWarmups);
//      with no history at all it gives a conservative first suggestion (−4%, a
//      range as wide as the rating is believable), and none from a warm-up at
//      RPE 5 or easier: the card says the RPE was too low for a reliable
//      estimate and the first set sets it. A HARD final warm-up is different: a single @ RPE 8 is a
//      top set in all but name and the best read of today there is, so from a
//      logged RPE 7 up to 8 its own chart estimate takes over, until it alone
//      sets the weight (210 kg × 1 @ 8 → 5 @ 4.5 = 165 kg, not 185 because
//      recent sessions were heavier). It is monotonic in effort: the same
//      warm-up rated harder never suggests more than it would rated a normal 7.
//      Once a working set is logged today, that set takes over.
//   9. LIVE ACROSS CARDS: a back-off of the same exercise on its own card
//      (top set on one card, back-offs on the next) is worked out from today's
//      sets of that exercise, exactly as if they were on its own card (note 5),
//      less BACKOFF_FATIGUE for the fatigue the top set leaves: 495 lb × 4 @ 10
//      → 4 @ 6 ≈ 420. History keeps its 25% only to bring the number DOWN,
//      never up (backing off is the safe side, and a back-off after a grind
//      must never come out at the top set's weight). A variation
//      of the family (paused, tempo) starts from its own history and moves by
//      how today's sets of the lift compared with what history predicted
//      ("today ran +3%"), trusted 50% and capped at ±8%; it replaces the
//      predicted readiness from the last review (real sets beat a forecast).
//      Was history × a capped day factor for the same exercise too, which never
//      saw a hard top set when recent sets were rated easy (Nov 13 2026: a
//      deadlift top set of 495 × 4 rated 7, 8, 9 or 10 all gave 2 × 4 @ 6 at
//      485, because 495 × 3 @ 5 the week before read as "495 for 4 at anything
//      heavy").
//  10. EFFORT IS MONOTONIC: the same weight × reps rated easier never lowers a
//      suggestion and rated harder never raises it. Every rated set counts;
//      a set claims at most MAX_EASIER_CREDIT RPE "easier than the target",
//      and today's sets are weighed by order and reps, never by their rating.
//  11. A COLD SUGGESTION READS PAST BACK-OFFS AS THE TOP SET THEY IMPLY. For a
//      card's first set of the day (nothing logged today, not a back-off read
//      from today's top set) a past set on a back-off card (a card the program
//      calls one, or a later card of the same exercise that day) counts at
//      ÷ (1 − BACKOFF_FATIGUE), the inverse of note 9. Back-offs are done tired,
//      so read as logged they pulled a fresh top set down: 425 lb × 4 @ 6 then
//      2 × 405 × 4 @ 6 suggested 410–430 for the same 4 @ 6 the next week (now
//      about 430). Once a set is logged today, and for the day read across cards
//      (todayVsUsual), history is read as logged, as before. So is a BACK-OFF
//      card's own (a later card of the exercise today, backoffCards): until its
//      top set carries (note 9) its number is a back-off's, not a fresh top set's.
//      Backtested Nov 15 2026 on 147 back-off cards with nothing carried (10
//      athletes): read as top sets they came out +2.6% heavy, 39.5% over 5% too
//      heavy; read as logged −1.5%, 27.2%, within 5% 34.0% → 36.7%, fewer
//      too-heavy suggestions in both halves of the time range and for 6 athletes
//      with 5+ cards (none got more); top-set cards keep note 11 (6.25% off
//      read as top sets vs 7.70% as logged on the same days).
//  12. ACCESSORIES ON A REP RANGE ARE COACHED BY DOUBLE PROGRESSION, not an
//      estimated max (repProgression): last session's working weight goes up
//      the smallest step the athlete loads once every set at it reached the top
//      of the range at the target effort, stays while they build reps, and
//      comes down a step only when every set fell short of the range. Read at
//      the range's middle through the chart (alpha 0.3) the old estimate kept a
//      lifter who hit 12 of 8–12 on the same weight. Weights round to the steps
//      the athlete loads on that exercise (loadIncrement: their own gaps, a
//      dumbbell rack's 5 lb) and land on a weight they've used (snapLoad); the
//      competition lifts keep plate steps. A warm-up far under today's working
//      weight (a bar, a 50% ramp set) is read as nothing (warmupRelevance).
//      Backtested Nov 20 2026 on 1,754 real rep-range accessory sessions:
//      median error 6.25% → 5.56%; "hold" suggestions on a weight they actually
//      use 77.7% → 98.9% (error 5.41% → 2.22%); other accessory cards 65.3% →
//      91.1% (6.25% → 3.77%); after a top-of-range session the old engine kept
//      66% on the same weight, and when athletes went up 97.5% still reached the
//      range (holding instead hit the top again 92% of the time, 972 pairs).
// Back-off history (note 11), backtested Nov 15 2026 on 674 real first sets of
// a squat / bench / deadlift-family session (19 athletes, Jun–Nov 2026),
// predicted from history alone at the reps and RPE logged: competition lifts
// 7.57% → 7.02% median off, median bias −2.3% → −0.6% (trimmed of outliers
// −2.9% → −1.6%, still on the light side), within 5% 36.6% → 42.9%, better in
// both halves of the time range, 107 predictions better and 57 worse, 4 of 12
// athletes better and none worse; deadlifts 9.05% → 7.50%; variations and
// accessories unchanged. Tested and rejected on the same sets: projecting each
// lift's estimated-max trend forward (Theil–Sen over 8 weeks, damped, capped,
// gated on a clear trend) was no better in any form and made more predictions
// worse than better, because a lift that's moving already rates the same load
// easier, and a falling stretch is usually a light week athletes bounce back
// from (the engine was already −3.6% light after one); dropping back-off sets
// (more predictions worse); reading each session's first set only (accessories
// worse).
// Back-offs (note 9), backtested Nov 13 2026 on 214 real first back-off sets
// after a top set on an earlier card (12 athletes, mostly SBD): the chart alone
// read a median 8.3% off, +5.9% heavy, 54% more than 5% too heavy; athletes
// load a back-off about 6% under what the chart says their top set implies,
// even at the same RPE (153 of the 214 were rated as hard as the top set or
// harder). With BACKOFF_FATIGUE: 5.5% off, −0.4%, 27%; every back-off set,
// own sets included, 1.7% off and 14% too heavy. A per-athlete drop learned
// from past sessions gained little more and isn't used.
// History profiles (note 3), backtested Nov 14 2026 on 2,807 real first sets
// of a lift's day predicted from history alone (19 athletes, 200 days):
// competition lifts 8.98% → 7.66% median off (within 5%: 29.5% → 36.3%),
// better in both halves of the time range and for 6 of 7 athletes with
// enough sets, none worse; everything else 5.3% → 4.4% (accessories: 12 of 17 athletes
// better, 1 worse). Next-set predictions with history in the blend improved too
// (competition 1.50% → 1.39%, accessories 0.99% → 0.71%), and the shown
// range holds the load used more often at the same width.
// Backtested on ~2,800 real sets (scratch script, not shipped): median error
// 8% cold, 4.4% once today's first set is in. Monotonic effort (Oct 2026, 7,000
// real sets): "rated easier → lower" 621 → 0 of 4,200 next-set cases; next-set
// median error 1.56% → 1.47%, within ±5% 68.4% → 69.6%; cold unchanged.
// Pure: no I/O, fully unit tested.
// ───────────────────────────────────────────────────────────────────────────

/** RTS chart: %1RM at RPE 10 for 1..12 reps. */
const PCT_AT_RPE10 = [1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68];
/**
 * Effective reps (reps + RIR) the chart still answers for. Past 12 it is an
 * Epley-shaped tail: rough as an absolute %1RM, but the model only uses it to
 * move between nearby rep counts (shrunk by ALPHA), which is what a 10–20 rep
 * calf raise or a 25-rep pump set needs.
 */
const MAX_EFFECTIVE_REPS = 30;
/**
 * Highest rep count a set (or a plan) is read at. Was 15, which threw out every
 * 16–30 rep accessory set — 470 real sets in 8 weeks — so a 10–20 @ 9–10 calf
 * raise logged at 20 reps never got a suggestion (Oct 2026).
 */
export const MAX_SET_REPS = 30;
const HISTORY_WINDOW_DAYS = 56;
const MAX_SESSIONS = 8;
export const MIN_HISTORY_SESSIONS = 2;
export const MIN_HISTORY_SPAN_DAYS = 6;
/** Early estimate (thin history): the last session within 4 weeks, range at least ±8%. */
export const EARLY_MAX_DAYS = 28;
export const EARLY_SPREAD = 0.08;
const DAY_MS = 86_400_000;

/**
 * Lowest RPE a target is planned at and a set is read at (a set rated 1–2 reads
 * as 3). Light prescriptions — RPE 3–5 primers, tempo/technique waves, pivot
 * weeks — are planned at their real effort.
 */
export const MIN_RPE = 3;

/**
 * Effort is monotonic: the same weight × reps rated EASIER never lowers a
 * suggestion, rated harder never raises it. Easier-than-target sets used to
 * fall off cliffs instead (below RPE 4 "a warm-up", below 6 "too light for a
 * heavy target", 9+ reps below 7 "untrusted") and the card fell back to older
 * history — on real logs, rating the day's sets one RPE easier LOWERED the next
 * suggestion 15% of the time (3-0-0 tempo sumo 3×7 @ 5, Oct 2026: 235 @ 4 →
 * next time 240, the same 235 rated 3 → 235).
 *
 * Every rated working set now counts, but a set can claim at most this many
 * RPE "easier than the target": RIR far from failure is a loose guess and a
 * light set is often an opener, so an easier rating keeps nudging the number
 * up without flinging it.
 */
export const MAX_EASIER_CREDIT = 2;
/**
 * A set rated more than this below the target is "clearly easier" and reads as
 * a lower bound (see estimateFor). Within it a rating is close enough to the
 * plan to count both ways — 65 × 5 @ 8 against a target of 9 says today is
 * heavy. Backtest: 1.5 keeps the easy-set-before-heavier-target error at 5.1%
 * (was 8.2%) with no bias (median 0%).
 */
export const EASIER_BAND = 1.5;

/**
 * Bodyweight: strength scales with bodyweight^~0.67 (allometric scaling), so a
 * past set is adjusted by (bodyweight now / bodyweight then)^0.67. Uses the
 * smoothed (7-day) bodyweight to ignore daily water swings, and ignores ratios
 * outside ±12% (a unit slip, not a real change). Backtest: SBD in-range 43% → 45%
 * cold, error 3.0% → 2.9% once a set is in; nothing got worse. Tested and
 * rejected (no gain): projecting the block's e1RM trend forward, and a flat
 * calibration bump for SBD.
 */
export const BODYWEIGHT_EXPONENT = 0.67;
const BODYWEIGHT_MAX_RATIO_SHIFT = 0.12;

export function bodyweightScale(nowKg: number | null | undefined, thenKg: number | null | undefined): number {
  if (!(nowKg && nowKg > 0) || !(thenKg && thenKg > 0)) return 1;
  const r = nowKg / thenKg;
  if (Math.abs(r - 1) > BODYWEIGHT_MAX_RATIO_SHIFT) return 1;
  return Math.pow(r, BODYWEIGHT_EXPONENT);
}

/** Fraction of 1RM for `reps` performed with `rir` reps left in the tank. */
export function percentOf1RM(reps: number, rir: number): number | null {
  const e = reps + Math.max(0, rir);
  if (!Number.isFinite(e) || e < 1 || e > MAX_EFFECTIVE_REPS) return null;
  if (e <= PCT_AT_RPE10.length) {
    const lo = Math.floor(e);
    const hi = Math.ceil(e);
    const a = PCT_AT_RPE10[lo - 1];
    const b = PCT_AT_RPE10[hi - 1];
    return a + (b - a) * (e - lo);
  }
  // Past 12 reps, continue from the chart with an Epley-shaped tail.
  const n = PCT_AT_RPE10.length;
  return PCT_AT_RPE10[n - 1] * ((1 + n / 30) / (1 + e / 30));
}

export function parseRpe(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

/** Optional final warm-up before the first working set (SBD lifts). */
export interface WarmupSet {
  load: number; // in the model's unit
  reps: number;
  /** How hard it felt. Optional — a typical final warm-up is assumed when missing. */
  rpe?: number | string | null;
}
/** Assumed effort when the athlete doesn't say: a normal final warm-up. */
export const WARMUP_DEFAULT_RPE = 7;
export const WARMUP_MAX_REPS = 8;
/**
 * How much a warm-up's RPE can be believed (header note 8, Nov 20 2026). A
 * rating is a guess at reps in reserve, and the guess gets worse the further
 * the set was from failure. Measured on 6,149 rated working sets (240 days, 13+
 * athletes, reps ≤ 10), each set's chart max against the athlete's hard sets
 * (RPE 8+, ≤ 6 reps) of the same exercise within 10 days:
 *   RPE ≤ 5:  median 0.84 of the real max, middle half 0.73–0.98 (100 sets)
 *   RPE 5.5–6: 1.03, 0.93–1.11 (200)    RPE 6.5–7: 1.00, 0.93–1.08 (303)
 *   RPE 7.5:  0.98, 0.94–1.05 (108)     RPE 8–8.5: 1.00, 0.97–1.05 (687)
 * So a warm-up's own estimate spreads about 3.5% per rep in reserve
 * (`warmupSpread`), and at RPE 5 or easier it reads ~16% light with a ±25%
 * spread: no evidence at all that today is weaker, only (being light) a lower
 * bound. Only 38 warm-ups had been logged, too few to fit on their own; the
 * rating error is the same thing.
 */
export const WARMUP_SPREAD_PER_RIR = 0.035;
/** At or under this RPE a warm-up says nothing about today being weaker (read light, ±25%). */
export const WARMUP_UNREADABLE_RPE = 5;
/** A warm-up's rating as a number, a missing one read as a typical last warm-up. */
function warmupRpe(rpe: number | string | null | undefined): number {
  return parseRpe(rpe ?? null) ?? WARMUP_DEFAULT_RPE;
}
/** The spread of a warm-up's own estimate of today's max, from how hard it was (WARMUP_SPREAD_PER_RIR). */
export function warmupSpread(rpe: number | string | null | undefined): number {
  return WARMUP_SPREAD_PER_RIR * Math.max(1, 10 - warmupRpe(rpe));
}
/**
 * How much a warm-up that reads LIGHTER than history may pull today's weight
 * down, 0..1: its precision against a normal last warm-up's (RPE 7), faded to
 * nothing at WARMUP_UNREADABLE_RPE. RPE 7 and harder 1, RPE 6.5 0.59, 6 0.32,
 * 5 and easier 0. A smooth ramp, so changing the rating never jumps the weight.
 * A warm-up that reads HEAVIER than history is a lower bound however easy it
 * was (an easy rating reads light), so that side keeps its full say.
 */
export function warmupReliability(rpe: number | string | null | undefined): number {
  const at = (r: number) => (warmupSpread(WARMUP_DEFAULT_RPE) / warmupSpread(r)) ** 2;
  const floor = at(WARMUP_UNREADABLE_RPE);
  return Math.min(1, Math.max(0, (at(warmupRpe(rpe)) - floor) / (1 - floor)));
}
/** Other warm-ups within this much of the heaviest are read with it (a single and a double at the top of the ramp). */
export const WARMUP_COMPANION_GAP = 0.075;
/** With history: the warm-up moves the suggestion by half its disagreement, clamped to −6% / +3% of it → −3% / +1.5%. */
export const WARMUP_NUDGE_DOWN = -0.06;
export const WARMUP_NUDGE_UP = 0.03;
export const WARMUP_NUDGE_WEIGHT = 0.5;
/**
 * How much a warm-up's own chart estimate is trusted, from its logged RPE:
 * none at RPE ≤ 7 (a normal final warm-up) or when no RPE was given (it only
 * nudges), fully at RPE 8+
 * (a hard single/double is as good a read of today as a top set).
 */
export const WARMUP_TRUST_FROM_RPE = 7;
export const WARMUP_TRUST_FULL_RPE = 8;
export const WARMUP_HARD_MAX_UP = 0.075;
export function warmupTrust(rpe: number | string | null | undefined): number {
  const r = parseRpe(rpe ?? null);
  if (r == null) return 0;
  return Math.min(1, Math.max(0, (r - WARMUP_TRUST_FROM_RPE) / (WARMUP_TRUST_FULL_RPE - WARMUP_TRUST_FROM_RPE)));
}
/**
 * A warm-up only says something about today when it's near the working weight
 * (header note 8): a final warm-up sits ~85–90% of the top set, while a bar or a
 * 50% ramp set rated "7" is a number typed past, not a read of the day (it reads
 * ~half of history's max and would pull every suggestion down). Relevance ramps
 * from 0 at WARMUP_RELEVANT_FROM of history's working load for today's target to
 * full at WARMUP_RELEVANT_FULL, so moving the weight never jumps the number. Of
 * the 38 warm-ups logged to Nov 20 2026, the heaviest of each card ran 77–100%
 * of that day's first working set, so none of them changes.
 */
export const WARMUP_RELEVANT_FROM = 0.6;
export const WARMUP_RELEVANT_FULL = 0.75;
export function warmupRelevance(warmupLoad: number, workingLoad: number): number {
  if (!(warmupLoad > 0) || !(workingLoad > 0)) return 0;
  const r = warmupLoad / workingLoad;
  return Math.min(1, Math.max(0, (r - WARMUP_RELEVANT_FROM) / (WARMUP_RELEVANT_FULL - WARMUP_RELEVANT_FROM)));
}
/** No history at all: trim the warm-up's own estimate, widen the range, never suggest > 1.25× the warm-up load. */
export const WARMUP_COLD_START_FACTOR = 0.96;
export const WARMUP_COLD_START_SPREAD = 0.08;
export const WARMUP_COLD_START_MAX_RATIO = 1.25;

/**
 * Estimated 1RM implied by a final warm-up at its own rating, or null when it
 * isn't a warm-up the chart can read. An easy rating is read as given: it reads
 * light, never heavy (see WARMUP_SPREAD_PER_RIR), and how much it may count is
 * warmupReliability's call, not a floor on the rating.
 */
export function warmupE1rm(w: WarmupSet): number | null {
  if (!(w.load > 0) || !(w.reps >= 1) || w.reps > WARMUP_MAX_REPS) return null;
  const rpe = Math.min(10, warmupRpe(w.rpe));
  const pct = percentOf1RM(w.reps, 10 - rpe);
  return pct ? w.load / pct : null;
}

/** The warm-ups as the model reads them (readWarmups). */
export interface ModelWarmup {
  /** Today's max they imply, combined (in the model's unit). */
  e1rm: number;
  /** The same, every rating read as no harder than a normal 7: the monotone ceiling for a hard warm-up. */
  normalE1rm: number;
  /** The heaviest warm-up's load and reps. */
  load: number;
  reps: number;
  /** The hardest rating among those read (a missing one counts as 7). */
  rpe: number;
  /** How far a hard warm-up is read like a set (warmupTrust of `rpe`). */
  trust: number;
  /** The combined read's spread (warmupSpread of the most precise one). */
  spread: number;
  /** How much a lighter read may pull the weight down (warmupReliability of `rpe`). */
  reliability: number;
  /** Warm-ups read (the heaviest and any within WARMUP_COMPANION_GAP of it). */
  count: number;
}

/**
 * Today's warm-ups as one read, the same whatever order they were logged in:
 * the heaviest (ties: the harder-rated, then more reps), with any others within
 * WARMUP_COMPANION_GAP of its load, each weighed by its precision (1 /
 * warmupSpread²) on the log scale. Lighter ramp sets are left out: a bar or a
 * 60% set rated at its default says nothing about today's top set. The
 * combined spread is the most precise one's, not narrower: the ratings come
 * from one athlete on one day, so their errors move together.
 */
export function readWarmups(list: Array<WarmupSet | null | undefined>): ModelWarmup | null {
  const sets = list
    .filter((w): w is WarmupSet => !!w && w.load > 0 && w.reps >= 1 && w.reps <= WARMUP_MAX_REPS && warmupE1rm(w) != null)
    .map((w) => ({ ...w, r: warmupRpe(w.rpe) }));
  if (!sets.length) return null;
  const top = sets.reduce((a, b) =>
    b.load > a.load || (b.load === a.load && (b.r > a.r || (b.r === a.r && b.reps > a.reps))) ? b : a);
  const near = sets.filter((w) => w.load >= top.load * (1 - WARMUP_COMPANION_GAP));
  const combine = (cap: number | null) => {
    let num = 0;
    let den = 0;
    for (const w of near) {
      const e = warmupE1rm({ load: w.load, reps: w.reps, rpe: cap == null ? w.r : Math.min(w.r, cap) });
      if (!e) continue;
      const p = 1 / warmupSpread(w.r) ** 2;
      num += p * Math.log(e);
      den += p;
    }
    return den > 0 ? Math.exp(num / den) : null;
  };
  const e1rm = combine(null);
  const normalE1rm = combine(WARMUP_TRUST_FROM_RPE);
  if (!e1rm || !normalE1rm) return null;
  const rpe = Math.max(...near.map((w) => w.r));
  return {
    e1rm, normalE1rm, load: top.load, reps: top.reps, rpe,
    trust: warmupTrust(rpe), spread: warmupSpread(rpe), reliability: warmupReliability(rpe), count: near.length,
  };
}

export interface SetSample {
  load: number; // in the model's unit
  reps: number;
  rpe: number | null;
}

/** RPE-adjusted e1RM for one set and how much to trust it (0..1). */
export function setE1rm(s: SetSample): { e1rm: number; trust: number } | null {
  if (!(s.load > 0) || !(s.reps >= 1) || s.reps > MAX_SET_REPS) return null;
  // Light ratings count (a planned RPE 3–5 set is real work), read at no
  // easier than MIN_RPE; their RIR guess is weak, so they're trusted less
  // (below) and their own reps/RPE neighbours dominate through the kernel.
  // Unlogged working sets: assume a typical hard set.
  const rpe = s.rpe == null ? 8.5 : Math.max(MIN_RPE, s.rpe);
  const pct = percentOf1RM(s.reps, 10 - rpe);
  if (!pct) return null;
  let trust = s.rpe != null ? 1 : 0.5;
  if (s.reps > 8) trust *= 0.75; // high-rep e1RMs drift
  if (s.rpe != null && s.rpe < 7) trust *= 0.7; // RIR 3+ is a guess
  return { e1rm: s.load / pct, trust };
}

/**
 * How a lift's history is read (header note 3). `alpha` is how far the RPE
 * chart's correction is trusted between a past set and today's target (1 =
 * fully, 0 = the load used as it was), `halfLifeDays` how fast older sessions
 * fade, and the kernels how tightly past sets are matched on reps and RPE.
 * Measured, see the history-profile backtest above.
 */
export type LiftKind = "competition" | "other";
export const HISTORY_PROFILES: Record<LiftKind, { alpha: number; halfLifeDays: number; repKernel: number; rpeKernel: number }> = {
  competition: { alpha: 0.85, halfLifeDays: 3, repKernel: 0.5, rpeKernel: 0.5 },
  other: { alpha: 0.3, halfLifeDays: 2, repKernel: 1, rpeKernel: 1 },
};
/** The competition squat, bench and deadlift read as "competition"; every other exercise as "other". */
export function liftKindOf(ex: { competition_lift_type?: string | null; is_competition_lift?: boolean | null } | null | undefined): LiftKind {
  return ex?.competition_lift_type || ex?.is_competition_lift ? "competition" : "other";
}

export interface Readiness {
  /** ≤ 1. Applied to cold (history-only) suggestions. */
  multiplier: number;
  reasons: string[];
}

export const NEUTRAL_READINESS: Readiness = { multiplier: 1, reasons: [] };

export interface LastReviewSignal {
  submittedAt: string | null;
  /** Only trusted for v2 reviews (real session RPE, not the legacy mapping). */
  sessionRpe: number | null;
  pain: boolean;
  sleepBucket: string | null;
  recoveryToday: number | null;
}

/**
 * Predict today's readiness from the most recent workout review. Effects fade
 * as time passes: full within 48h, half up to 96h, gone after that.
 * Capped at -5% so one bad night can't wreck the session.
 */
export function predictReadiness(last: LastReviewSignal | null, now: Date = new Date()): Readiness {
  if (!last?.submittedAt) return NEUTRAL_READINESS;
  const hours = (now.getTime() - Date.parse(last.submittedAt)) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return NEUTRAL_READINESS;
  const fade = hours <= 48 ? 1 : hours <= 96 ? 0.5 : 0;
  if (fade === 0) return NEUTRAL_READINESS;
  let pct = 0;
  const reasons: string[] = [];
  if (last.pain) { pct += 3; reasons.push("pain last session"); }
  if (last.sessionRpe != null && last.sessionRpe >= 9.5) { pct += 2; reasons.push("max-effort last session"); }
  else if (last.sessionRpe != null && last.sessionRpe >= 9) { pct += 1; reasons.push("hard last session"); }
  if (last.sleepBucket === "lt5") { pct += 2; reasons.push("short sleep"); }
  else if (last.sleepBucket === "5_6") { pct += 1; reasons.push("short sleep"); }
  if (last.recoveryToday === 1) { pct += 2; reasons.push("low recovery"); }
  else if (last.recoveryToday === 2) { pct += 1; reasons.push("low recovery"); }
  pct = Math.min(5, pct * fade);
  if (pct < 0.5) return NEUTRAL_READINESS;
  return { multiplier: 1 - pct / 100, reasons };
}

export interface ModelSample {
  e1rm: number;
  /** Load lifted, in the model's unit (staleness/readiness applied). */
  load: number;
  reps: number;
  /** The RPE the e1RM was computed with (logged, or the 8.5 default). */
  rpe: number;
  trust: number;
  /** Recency weight (history) or set order (today). */
  weight: number;
}

export interface LoadModel {
  status: "ready" | "calibrating";
  unit: "kg" | "lb";
  /** Where the estimate comes from ("progression": double progression on a rep range, header note 12). */
  source: "history" | "today" | "blend" | "warmup" | "history_warmup" | "progression" | null;
  historySessions: number;
  /** Past sets of this lift (recency-weighted, readiness/staleness applied). */
  history: ModelSample[];
  /** Sets already completed on this row today. */
  today: ModelSample[];
  /** Cold suggestions only: readiness applied. */
  readiness: Readiness;
  /** Days since the last session of this lift, when it's been a while. */
  staleDays: number | null;
  /** Mean bodyweight adjustment applied to history (1 = none), for the "why". */
  bodyweightScale: number;
  /** The athlete's last warm-ups (readWarmups), when given and no working set is logged yet today. */
  warmup: ModelWarmup | null;
  /**
   * No history and the warm-ups are too easy to read (RPE ≤ WARMUP_UNREADABLE_RPE):
   * no number is made up, and the card says why (calibrating).
   */
  warmupTooEasy?: boolean;
  /** Today's read from this lift's other cards, applied to a cold suggestion (1 = as usual). */
  dayFactor: number | null;
  /** True when "today" includes this exercise's earlier sets on another card (a back-off after its top set). */
  carried: boolean;
  /** The latest of those sets as logged (before BACKOFF_FATIGUE), for the "why": the top set it follows. */
  carriedTop: { load: number; reps: number; rpe: number; e1rm: number } | null;
  /** Cold suggestion from thin history (one recent session): wider range, labelled as early. */
  early: boolean;
  /** How this lift's history is read (HISTORY_PROFILES). */
  lift: LiftKind;
  /** Past back-off sets read as the top set they imply for this cold suggestion (note 11). */
  backoffsAsTopSet?: number;
  /** Double progression from the last session (note 12): this card's first set, before anything is logged today. */
  progression?: RepProgression | null;
  /** The same read of TODAY's sets: what next time starts at, once the card is done. */
  progressionNext?: RepProgression | null;
  /**
   * The weights they've loaded on this exercise lately, in this unit as typed
   * (only for lifts that aren't the competition squat, bench or deadlift, which
   * keep plate steps): the target rounds to their own steps (loadIncrement) and
   * lands on a weight they've used (snapLoad).
   */
  ladder?: number[];
  /** What it's loaded on (equipmentKindOf), for the default step. */
  equipment?: EquipmentKind | null;
}

// ── Rep-range progression (header note 12) ────────────────────────────────
/** A prescribed rep range ("8–12"). */
export interface RepRange { lo: number; hi: number }
/** A card's prescribed reps as a range ("8-12" → 8–12, "10" → 10–10), or null (timed, a scheme). */
export function repRangeOf(text: string | null | undefined): RepRange | null {
  const t = parseRepTarget(text);
  if (t.min != null && t.max != null && t.max >= t.min) return { lo: t.min, hi: t.max };
  if (t.exact != null) return { lo: t.exact, hi: t.exact };
  return null;
}
export interface RepProgression {
  /** add the smallest step / stay and build reps / come down a step */
  action: "add" | "hold" | "drop";
  /** Today's weight (model unit). */
  load: number;
  /** The weight the last session was done at (its working load). */
  from: number;
  /** The step used to add or drop (loadIncrement). */
  step: number;
  /** That session's reps at its working load, in set order. */
  reps: number[];
  /** Its hardest rating at that load, when rated. */
  rpe: number | null;
  range: RepRange;
  /** Hit the top, but the next weight would be a jump of over PROGRESSION_MAX_JUMP they've never lifted: stay and add reps. */
  bigJump?: boolean;
}
/** The last session counts for double progression only when this recent (else the history model and its layoff ease decide). */
export const PROGRESSION_MAX_DAYS = 28;
/** A step up over this share of the weight is held unless they've lifted that weight before (a 10 → 15 lb dumbbell is +50%). */
export const PROGRESSION_MAX_JUMP = 0.25;
/** Reps at the top of the range count as earned only up to this much over the target effort. */
export const PROGRESSION_EFFORT_SLACK = 0.5;

/**
 * Double progression (note 12): the way accessories are coached. The last
 * session's working weight (the heaviest it did for reps inside the range)
 * goes up by the smallest step they load once every set at it reached the top
 * of the range at no more than the target effort; it stays while they build
 * reps; it comes down a step when every set at it fell short of the bottom of
 * the range rated at or over the target (or unrated, since short reps are typed
 * by hand). Null when the last session isn't comparable: a different rep range
 * (reps far outside this one), nothing loaded.
 */
export function repProgression(input: {
  sets: Array<{ load: number; reps: number; rpe: number | null }>;
  range: RepRange;
  targetRpe: number;
  step: number;
  ladder?: number[];
  /**
   * The range those sets were prescribed: double progression only compares a
   * range with itself (12 reps at the top of 10–12 isn't short of 15–20). Another
   * range → null, and the RPE model translates across. Unknown (older history):
   * judged on this range, but never a drop.
   */
  lastRange?: RepRange | null;
}): RepProgression | null {
  const { range, step } = input;
  const sets = input.sets.filter((s) => s.load > 0 && s.reps >= 1);
  if (!sets.length || !(step > 0) || !(range.lo >= 1) || !(range.hi >= range.lo)) return null;
  const last = input.lastRange ?? null;
  if (last && (last.lo !== range.lo || last.hi !== range.hi)) return null;
  const maxReps = Math.max(...sets.map((s) => s.reps));
  // Another rep range last time (a 20-rep pump set, a heavy 5): this one's rule doesn't read it.
  if (maxReps > range.hi + 4 || maxReps < range.lo - 3) return null;
  const same = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const inRange = sets.filter((s) => s.reps >= range.lo);
  const from = Math.max(...(inRange.length ? inRange : sets).map((s) => s.load));
  const at = sets.filter((s) => same(s.load, from));
  const rated = at.map((s) => s.rpe).filter((r): r is number => r != null);
  const rpe = rated.length ? Math.max(...rated) : null;
  const ladder = [...new Set((input.ladder ?? []).filter((x) => x > 0).map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  const base = { from, step, reps: at.map((s) => s.reps), rpe, range };
  const hitTop = at.every((s) => s.reps >= range.hi) && (rpe == null || rpe <= input.targetRpe + PROGRESSION_EFFORT_SLACK);
  if (hitTop) {
    const next = snapLoad(from + step, step, ladder);
    const known = ladder.some((x) => same(x, next));
    if (next > from && ((next - from) / from <= PROGRESSION_MAX_JUMP || known)) return { ...base, action: "add", load: next };
    return { ...base, action: "hold", load: from, bigJump: true };
  }
  const allShort = !!last && at.every((s) => s.reps < range.lo) && (rpe == null || rpe >= input.targetRpe);
  if (allShort) {
    const next = snapLoad(from - step, step, ladder);
    if (next > 0 && next < from) return { ...base, action: "drop", load: next };
  }
  return { ...base, action: "hold", load: from };
}

/**
 * The smallest step this athlete loads on an exercise: the smallest gap between
 * the weights they've used on it (typed, in this unit), when it's a believable
 * step for the equipment (half to three times the default: a 2.3 kg cable stack,
 * 5 lb dumbbells, a 10 lb machine stack), else the default. Measured Nov 20 2026
 * on 13,000 accessory sets: lb dumbbells are 96% whole pounds but only 72% on a
 * 5 lb grid, kg cables only 49% on a 2.5 kg grid, so one grid for everyone puts
 * a target on a weight their gym doesn't have.
 */
export function loadIncrement(input: { ladder?: number[]; unit: "kg" | "lb"; load: number; kind?: EquipmentKind | null }): number {
  const base = defaultIncrement(input.unit, input.load, input.kind ?? null);
  const loads = [...new Set((input.ladder ?? []).filter((x) => x > 0).map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < loads.length; i++) gap = Math.min(gap, loads[i] - loads[i - 1]);
  // Finer than the default always counts (microplates, a 1 kg dumbbell rack);
  // coarser only on a stack or a dumbbell rack, never on a bar (plates load in
  // the default step whatever jumps they happened to make).
  const coarse = input.kind === "dumbbell" || input.kind === "machine" || input.kind === "cable";
  if (Number.isFinite(gap) && gap >= base * 0.5 - 1e-9 && gap <= base * (coarse ? 3 : 1) + 1e-9) return Math.round(gap * 100) / 100;
  return base;
}
export type EquipmentKind = "barbell" | "dumbbell" | "machine" | "cable" | "other";
/** The step a gym usually has: plates for a bar, the dumbbell rack (5 lb / 2.5 kg past the light ones) for dumbbells. */
export function defaultIncrement(unit: "kg" | "lb", load: number, kind: EquipmentKind | null): number {
  if (kind === "dumbbell") return unit === "lb" ? (load < 15 ? 2.5 : 5) : load < 10 ? 1 : 2.5;
  return loadStep(unit, load);
}
/** Which kind of equipment an exercise is loaded on, from its name and library equipment (only the dumbbell rack changes the step). */
export function equipmentKindOf(name: string | null | undefined, equipment?: string | null): EquipmentKind {
  const s = `${name ?? ""} ${equipment ?? ""}`;
  if (/\b(dumbbells?|db)\b/i.test(s)) return "dumbbell";
  if (/\bcables?\b/i.test(s)) return "cable";
  if (/\b(machine|smith|leg press|hack squat|pec deck|selectorized)\b/i.test(s)) return "machine";
  if (/\b(barbell|trap bar|hex bar|ez[- ]?bar|safety (squat )?bar|ssb)\b/i.test(s)) return "barbell";
  return "other";
}
/**
 * A target onto a weight that exists: a weight they've used within half a step
 * of it, else the step's grid counted from the nearest weight they've used
 * (a 2.3 kg stack stays on 11.3, 13.6, 15.9), else plain multiples of the step.
 */
export function snapLoad(raw: number, step: number, ladder: number[] = []): number {
  if (!(step > 0)) return raw;
  let anchor: number | null = null;
  for (const x of ladder) if (x > 0 && (anchor == null || Math.abs(x - raw) < Math.abs(anchor - raw))) anchor = x;
  if (anchor == null || Math.abs(anchor - raw) > step * 3) return roundToStep(raw, step);
  if (Math.abs(anchor - raw) <= step / 2 + 1e-9) return anchor;
  return Math.round((anchor + Math.round((raw - anchor) / step) * step) * 100) / 100;
}

function weightedMean(values: Array<{ v: number; w: number }>): number | null {
  const total = values.reduce((s, x) => s + x.w, 0);
  if (!(total > 0)) return null;
  return values.reduce((s, x) => s + x.v * x.w, 0) / total;
}

/**
 * Build the per-exercise model.
 * `history` = this exercise's logs from OTHER sessions (already matched to the
 * exercise). `today` = this row's sets completed in the current session, in
 * set order.
 */
export function buildLoadModel(input: {
  history: PreviousLiftLog[];
  today: SetSample[];
  unit: "kg" | "lb";
  readiness?: Readiness;
  /** Optional final warm-up (SBD). Ignored once a working set is logged today. */
  warmup?: WarmupSet | null;
  /** Every warm-up logged on the card today, in any order (readWarmups reads them as one). */
  warmups?: WarmupSet[] | null;
  /** Today's smoothed bodyweight (kg); history logs carry theirs in `bodyweightKg`. */
  bodyweightKg?: number | null;
  /** How today's other cards of this lift ran vs history (see dayFactorFrom). Cold suggestions only. */
  dayFactor?: number | null;
  /** This exercise's earlier sets today on the cards before this one: a back-off reads them as its own (note 9). */
  carryToday?: SetSample[];
  /** How its history is read (liftKindOf); anything not a competition lift is "other". */
  lift?: LiftKind;
  /**
   * How past back-off sets are read for a cold suggestion (note 11): as the top
   * set they imply (the default), or as logged (the day read across cards,
   * which compares today's sets of every card with history).
   */
  backoffs?: "as_top_set" | "as_logged";
  /**
   * Double progression (note 12): the card's rep range and target effort. Pass it
   * only for a card coached that way: an accessory or variation on a range, not
   * a barbell squat / bench / deadlift (RPE-led), not a back-off card.
   */
  progression?: { range: RepRange; rpe: number } | null;
  /** What it's loaded on, for the default step (equipmentKindOf). Competition lifts keep plate steps. */
  equipment?: EquipmentKind | null;
  now?: Date;
}): LoadModel {
  const { unit } = input;
  const lift: LiftKind = input.lift ?? "other";
  const profile = HISTORY_PROFILES[lift];
  const now = (input.now ?? new Date()).getTime();
  const readiness = input.readiness ?? NEUTRAL_READINESS;

  // ── History: every valid working set, grouped by session ──
  // Each past session's first card of this exercise (lowest place in the
  // workout, else the earliest logged): a set on any later card of it that day
  // is a back-off (note 11), as is a card the program calls one.
  const firstCard = new Map<string, { rowId: string | null; order: number; at: number }>();
  for (const log of input.history) {
    const at = log.occurredAt ? Date.parse(log.occurredAt) : NaN;
    const order = log.rowOrder != null && Number.isFinite(Number(log.rowOrder)) ? Number(log.rowOrder) : Infinity;
    const cur = firstCard.get(log.sessionKey);
    if (!cur || order < cur.order || (order === cur.order && Number.isFinite(at) && at < cur.at)) {
      firstCard.set(log.sessionKey, { rowId: log.rowId ?? null, order, at: Number.isFinite(at) ? at : Infinity });
    }
  }
  const onBackoffCard = (log: PreviousLiftLog) => {
    if (BACKOFF_LABEL.test(log.purposeLabel ?? "")) return true;
    const first = firstCard.get(log.sessionKey)?.rowId;
    return !!log.rowId && !!first && log.rowId !== first;
  };
  const bySession = new Map<string, { at: number; sets: Array<Omit<ModelSample, "weight"> & { backoff: boolean }>; rated: boolean }>();
  const bwScales: number[] = [];
  for (const log of input.history) {
    if ((log.loadType ?? "external") !== "external" || log.isWorkingSet === false) continue;
    const at = log.occurredAt ? Date.parse(log.occurredAt) : NaN;
    if (!Number.isFinite(at) || now - at > HISTORY_WINDOW_DAYS * DAY_MS || at > now + DAY_MS) continue;
    const load = logLoadInUnit(log, unit);
    const reps = Number(log.reps);
    if (load == null || !Number.isFinite(reps)) continue;
    const rpe = parseRpe(log.rpe) ?? (log.rir != null && log.rir !== "" ? parseRpe(10 - Number(log.rir)) : null);
    const est = setE1rm({ load, reps, rpe });
    if (!est) continue;
    const bw = bodyweightScale(input.bodyweightKg, log.bodyweightKg);
    bwScales.push(bw);
    const s = bySession.get(log.sessionKey) ?? { at, sets: [], rated: false };
    s.at = Math.max(s.at, at);
    if (rpe != null) s.rated = true;
    s.sets.push({ e1rm: est.e1rm * bw, load: load * bw, reps, rpe: rpe == null ? 8.5 : Math.max(MIN_RPE, rpe), trust: est.trust, backoff: onBackoffCard(log) });
    bySession.set(log.sessionKey, s);
  }
  // ── The athlete's own weights and the last session as done (note 12) ──
  // Weights as typed in this unit (a kg set converted to lb is no weight their
  // gym has); the last session's sets on its first card of the exercise, as
  // logged (no bodyweight or layoff scaling: it's the weight they'll load).
  const ladderSet = new Set<number>();
  let lastKey: string | null = null;
  let lastAt = -Infinity;
  for (const log of input.history) {
    if ((log.loadType ?? "external") !== "external" || log.isWorkingSet === false) continue;
    const at = log.occurredAt ? Date.parse(log.occurredAt) : NaN;
    if (!Number.isFinite(at) || now - at > HISTORY_WINDOW_DAYS * DAY_MS || at > now + DAY_MS || !(Number(log.reps) >= 1)) continue;
    const typed = log.enteredUnit
      ? (log.enteredUnit === unit && Number(log.enteredValue) > 0 ? Number(log.enteredValue) : null)
      : logLoadInUnit(log, unit);
    if (typed != null && typed > 0) ladderSet.add(Math.round(typed * 100) / 100);
    if (at > lastAt) { lastAt = at; lastKey = log.sessionKey; }
  }
  const ladder = lift === "competition" ? [] : [...ladderSet].sort((a, b) => a - b);
  const lastFirstCard = lastKey ? firstCard.get(lastKey)?.rowId ?? null : null;
  const lastLogs = lastKey && (now - lastAt) / DAY_MS <= PROGRESSION_MAX_DAYS
    ? input.history.filter((log) => log.sessionKey === lastKey && (log.loadType ?? "external") === "external" && log.isWorkingSet !== false &&
        (!lastFirstCard || !log.rowId || log.rowId === lastFirstCard))
    : [];
  const lastRange = repRangeOf(lastLogs.find((log) => log.repsText)?.repsText ?? null);
  const lastSets = lastLogs.length
    ? lastLogs
        .map((log) => ({
          load: (log.enteredUnit === unit && Number(log.enteredValue) > 0 ? Number(log.enteredValue) : logLoadInUnit(log, unit)) ?? 0,
          reps: Number(log.reps),
          rpe: parseRpe(log.rpe) ?? (log.rir != null && log.rir !== "" ? parseRpe(10 - Number(log.rir)) : null),
        }))
        .filter((s) => s.load > 0 && s.reps >= 1)
    : [];

  const sessions = Array.from(bySession.values()).sort((a, b) => b.at - a.at).slice(0, MAX_SESSIONS);
  const spanDays = sessions.length > 1 ? (sessions[0].at - sessions[sessions.length - 1].at) / DAY_MS : 0;
  const historyReady = sessions.length >= MIN_HISTORY_SESSIONS && spanDays >= MIN_HISTORY_SPAN_DAYS;
  // Early estimate: one recent session (or two in the same week) with a
  // logged RPE beats nothing — it is better evidence than a warm-up single.
  // Wider range, labelled "Early estimate" (Larsen Press, Oct 2026: Suggest
  // on, one session logged, and the card stayed blank).
  const historyEarly = !historyReady && sessions.length > 0 && sessions.some((x) => x.rated) &&
    (now - sessions[0].at) / DAY_MS <= EARLY_MAX_DAYS;

  // A back-off of the same exercise on its own card reads today's earlier sets
  // of it (the top set it follows) as its own, ahead of its own sets (header
  // note 9), whatever its history: they're the best read of today there is.
  const carry = (input.carryToday ?? []).filter((s) => s.rpe != null && setE1rm(s) != null);
  const carried = carry.length > 0;
  // Today's real sets of this lift (other cards) replace the forecast from
  // the last review: both describe today, and the sets are evidence. Not on
  // top of carried sets: they're the same evidence.
  const dayFactor = !carried && input.dayFactor && Number.isFinite(input.dayFactor) && input.dayFactor > 0 && input.today.length === 0
    ? input.dayFactor
    : null;
  let staleDays: number | null = null;
  let scale = dayFactor ?? readiness.multiplier;
  if (sessions.length > 0) {
    const daysSince = (now - sessions[0].at) / DAY_MS;
    if (daysSince > 21) {
      // Detraining + rust: back off ~1% per week past three weeks (max 5%).
      scale *= 1 - Math.min(0.05, ((daysSince - 21) / 7) * 0.01);
      staleDays = Math.round(daysSince);
    }
  }
  // A cold suggestion (nothing logged today, not a back-off read from today's
  // top set) is for a fresh first set, so a past back-off counts as the top set
  // it implies (note 11). Once today's sets are in, history is read as logged.
  const cold = !carried && !input.today.some((s) => s.rpe != null && setE1rm(s) != null);
  const asTopSet = cold && input.backoffs !== "as_logged";
  let backoffsAsTopSet = 0;
  const history: ModelSample[] = sessions.flatMap((s) =>
    s.sets.map(({ backoff, ...x }) => {
      const k = asTopSet && backoff ? 1 / (1 - BACKOFF_FATIGUE) : 1;
      if (k !== 1) backoffsAsTopSet++;
      return {
        ...x,
        e1rm: x.e1rm * scale * k,
        load: x.load * scale * k,
        weight: Math.pow(0.5, (now - s.at) / DAY_MS / profile.halfLifeDays),
      };
    }),
  );

  // ── Today: sets already done on this row (need a logged RPE to calibrate) ──
  // A back-off's carried sets come first (done first), then its own: weighed
  // by order, its own sets lead once they're in.
  const today: ModelSample[] = [];
  [...carry, ...input.today].forEach((s, i) => {
    // Every rated set calibrates (trust only weighs it — a cut-off here made an
    // easier rating drop the set and fall back to older history).
    const est = setE1rm(s);
    if (est && s.rpe != null) {
      // A carried top set is read after the fatigue it leaves (BACKOFF_FATIGUE).
      const k = i < carry.length ? 1 - BACKOFF_FATIGUE : 1;
      today.push({ e1rm: est.e1rm * k, load: s.load * k, reps: s.reps, rpe: Math.max(MIN_RPE, s.rpe), trust: est.trust, weight: i + 1 });
    }
  });
  const top = carry.length ? carry[carry.length - 1] : null;
  const topEst = top ? setE1rm(top) : null;
  const carriedTop = top && topEst && top.rpe != null
    ? { load: top.load, reps: top.reps, rpe: top.rpe, e1rm: topEst.e1rm }
    : null;

  const warmup = today.length === 0 ? readWarmups([...(input.warmups ?? []), input.warmup]) : null;
  const bodyweightScaleMean = bwScales.length ? bwScales.reduce((a, b) => a + b, 0) / bwScales.length : 1;
  // Double progression (note 12): a card coached on a rep range starts from the
  // last session's weight and whether it earned the next step, never from a
  // chart estimate that, read at the range's middle, keeps a lifter who hit the
  // top on the same weight. Not once today's sets are in (they lead), not over
  // a warm-up read (a ramped compound), not for a back-off read from a top set.
  const equipment = lift === "competition" ? null : input.equipment ?? null;
  const prog = input.progression ?? null;
  const progressionFrom = (sets: Array<{ load: number; reps: number; rpe: number | null }>, lastRange: RepRange | null) => {
    if (!prog || lift === "competition" || !sets.length) return null;
    const ref = Math.max(...sets.map((s) => s.load));
    return repProgression({ sets, range: prog.range, targetRpe: prog.rpe, step: loadIncrement({ ladder, unit, load: ref, kind: equipment }), ladder, lastRange });
  };
  const progression = !carried && !warmup && input.today.length === 0 ? progressionFrom(lastSets, lastRange) : null;
  // Today's sets as the last session (prescribed this range): where next time starts once the card is done.
  const progressionNext = input.today.length > 0 && !carried ? progressionFrom(input.today, prog?.range ?? null) : null;
  const base = {
    unit, historySessions: sessions.length, staleDays, warmup, bodyweightScale: bodyweightScaleMean,
    early: historyEarly && today.length === 0 && !progression,
    dayFactor: historyReady && today.length === 0 && !progression ? dayFactor : null,
    carried,
    carriedTop,
    lift,
    backoffsAsTopSet,
    progression,
    progressionNext,
    ladder,
    equipment,
  };
  if (progression) {
    return { ...base, status: "ready", source: "progression", history, today: [], readiness: NEUTRAL_READINESS };
  }
  if (today.length > 0) {
    return {
      ...base, status: "ready",
      source: historyReady ? "blend" : "today",
      history: historyReady ? history.map((h) => ({ ...h, e1rm: h.e1rm / readiness.multiplier, load: h.load / readiness.multiplier })) : [],
      today,
      readiness: NEUTRAL_READINESS, // today's sets already reflect readiness
    };
  }
  if (historyReady || historyEarly) {
    return {
      ...base, status: "ready", source: warmup ? "history_warmup" : "history", history, today: [],
      readiness: dayFactor ? NEUTRAL_READINESS : readiness,
    };
  }
  // No usable history: a warm-up is the only same-day signal there is, which is
  // exactly when a brand-new lift needs a first suggestion. One too easy to read
  // (it reads ~16% light, ±25%) would only be a made-up number: the first set
  // sets it instead, and the card says why.
  if (warmup && warmup.rpe > WARMUP_UNREADABLE_RPE) {
    return { ...base, status: "ready", source: "warmup", history: [], today: [], readiness: NEUTRAL_READINESS };
  }
  if (warmup) {
    return { ...base, status: "calibrating", source: null, history: [], today: [], readiness: NEUTRAL_READINESS, warmupTooEasy: true };
  }
  return { ...base, status: "calibrating", source: null, history: [], today: [], readiness: NEUTRAL_READINESS };
}

/**
 * Athletes rate effort on their own scale, so a set is best predicted from
 * their own sets at similar reps and RPE; the chart only bridges the gap.
 */
function kernel(sample: ModelSample, reps: number, rpe: number, lift: LiftKind): number {
  const p = HISTORY_PROFILES[lift];
  return Math.exp(-Math.abs(sample.reps - reps) / p.repKernel) * Math.exp(-Math.abs(sample.rpe - rpe) / p.rpeKernel);
}
/** Today's sets are matched to the target on reps only, by this width. */
const REP_KERNEL = 1;

/**
 * Self-rated RPE is noisy (±1 is normal, and pre-filled values often go
 * unchanged), so the chart's correction is only partly trusted: a past set's
 * load is scaled by (chart ratio)^alpha. alpha < 1 shrinks toward "the load
 * you actually used"; how far depends on the lift (HISTORY_PROFILES). Today's
 * sets are rated in the same state, so they get more trust (TODAY_ALPHA).
 * HISTORY_ALPHA is only the range's ±0.5 RPE window.
 */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const HISTORY_SPREAD = 0.05;
export const TODAY_SPREAD = 0.035;
export const HISTORY_ALPHA = 0.5;
export const TODAY_ALPHA = 0.8;

/** Target-specific equivalent load and its relative spread. */
/**
 * Accumulated fatigue: at the same load, each later set rates ~0.5 RPE harder,
 * so a set predicted from an earlier set today is discounted per set apart.
 */
export const SET_FATIGUE = 0.035;

/**
 * A back-off read from the top set on an earlier card is set this much under
 * the chart: the fatigue a top set leaves (RTS's "fatigue percent"). Measured,
 * not assumed: see the back-off backtest above (5% to 6% fit best; 6% errs
 * light, the safe side for volume after a heavy set).
 */
export const BACKOFF_FATIGUE = 0.06;
/** A card the program calls a back-off ("Primary Squat Backoff", "Back-offs"). */
const BACKOFF_LABEL = /\bback[\s-]?offs?\b/i;

export interface LoadEstimate {
  load: number;
  spread: number;
  /**
   * What the last warm-up did to it (only when one was read): "tuned" it moved
   * the number, "too_easy" it was too easy to read and "light" too far under the
   * working weight to say anything (warmupRelevance): the number is history's.
   */
  warmup?: "tuned" | "too_easy" | "light";
}

export function estimateFor(model: LoadModel, reps: number, rpe: number): LoadEstimate | null {
  if (model.status !== "ready") return null;
  const targetPct = percentOf1RM(reps, 10 - rpe);
  if (!targetPct) return null;
  // A set rated more than MAX_EASIER_CREDIT below the target is read at
  // exactly that far below (see MAX_EASIER_CREDIT).
  const easiest = rpe - MAX_EASIER_CREDIT;
  const samplePct = (s: ModelSample) =>
    (s.rpe < easiest ? percentOf1RM(s.reps, 10 - easiest) : null) ?? s.load / s.e1rm;
  // Today's sets are weighed by order and rep match only — never by how they
  // were rated — so re-rating them can only move the number the honest way.
  const est = (samples: ModelSample[], alpha: number, byEffort = true) => {
    const w = samples.map((s) => ({
      v: s.load * Math.pow(targetPct / samplePct(s), alpha),
      w: byEffort ? s.weight * s.trust * kernel(s, reps, rpe, model.lift) : s.weight * Math.exp(-Math.abs(s.reps - reps) / REP_KERNEL),
    }));
    const mean = weightedMean(w);
    if (mean == null) return null;
    const variance = weightedMean(w.map((x) => ({ v: (x.v / mean - 1) ** 2, w: x.w }))) ?? 0;
    return { load: mean, spread: Math.sqrt(variance) };
  };
  // Today's sets at (or harder than) the target are point evidence. Sets rated
  // EASIER are a lower bound — "I had at least this much in me" (and light sets
  // are rated loosely, often an opener logged on the working row): they can
  // lift the number when they imply more, never drag it down. Either way an
  // easier rating can only move it up.
  const point = model.today.filter((s) => s.rpe >= rpe - EASIER_BAND);
  const easier = model.today.filter((s) => s.rpe < rpe - EASIER_BAND);
  const t = point.length ? est(point, TODAY_ALPHA, false) : null;
  // Each easier set is its own lower bound, so the floor is the highest one
  // (averaging them let one easy set dilute another).
  const floor = easier.reduce<{ load: number; spread: number } | null>((best, s) => {
    const e = est([s], TODAY_ALPHA, false);
    return e && (!best || e.load > best.load) ? e : best;
  }, null);
  const h = model.history.length ? est(model.history, HISTORY_PROFILES[model.lift].alpha) : null;
  // Final warm-up: only before any working set is logged today (model.warmup is
  // null otherwise). It nudges a history estimate, or — with no history — gives
  // a conservative first suggestion. See header note 8.
  if (model.warmup && !t) {
    const wu = model.warmup;
    // A warm-up far under today's working weight (a bar, a 50% ramp set) says
    // nothing about the day, however it was rated: history's number stands, and
    // the card says why. Near the working weight it counts in full (warmupRelevance).
    const relevance = h ? warmupRelevance(wu.load, h.load) : 1;
    if (h && relevance === 0) return { load: h.load, spread: clamp(h.spread / 2, HISTORY_SPREAD, 0.07), warmup: "light" };
    // Lighter than history: by as much as the rating can be believed
    // (warmupReliability, 0 at RPE 5 and easier). Heavier: a lower bound however
    // easy it was, so its full (small) say.
    const nudge = (x: number) => relevance * (x < 0 ? Math.max(x, WARMUP_NUDGE_DOWN) * wu.reliability : Math.min(x, WARMUP_NUDGE_UP));
    const softFor = (w: number) =>
      h
        ? {
            load: h.load * (1 + WARMUP_NUDGE_WEIGHT * nudge(w / h.load - 1)),
            spread: clamp(h.spread / 2, HISTORY_SPREAD, 0.07),
          }
        : {
            load: Math.min(w * WARMUP_COLD_START_FACTOR, wu.load * WARMUP_COLD_START_MAX_RATIO),
            // as wide as the rating is believable (RPE 7: ±10.5%), never narrower than before
            spread: Math.max(WARMUP_COLD_START_SPREAD, wu.spread),
          };
    const w = wu.e1rm * targetPct;
    const soft = softFor(w);
    // A hard warm-up is read like a set done today (header note 8).
    // Down as far as it says (backing off is the safe side), up by at most
    // WARMUP_HARD_MAX_UP over the soft estimate (a typo'd warm-up can't load the bar).
    // (a hard rating counts only as far as the warm-up is near the working weight)
    const k = wu.trust * relevance;
    const hard = Math.min(w, soft.load * (1 + WARMUP_HARD_MAX_UP));
    let load = k * hard + (1 - k) * soft.load;
    // Monotonic: the same warm-up rated harder never suggests MORE than rated a
    // normal 7 (the soft read). Otherwise "felt heavy" could out-weigh "felt
    // smooth" whenever the warm-up implies more than recent sessions.
    if (k > 0) load = Math.min(load, softFor(wu.normalE1rm * targetPct).load);
    // Said when it couldn't move the number: too easy to read, and no heavier than history.
    const tooEasy = !!h && wu.reliability === 0 && load <= h.load * (1 + 1e-9);
    return { load, spread: k * TODAY_SPREAD + (1 - k) * soft.spread, warmup: tooEasy ? "too_easy" : "tuned" };
  }
  // Spread floors are calibrated on real logs so the range is honest (most
  // sets land inside it) rather than falsely precise.
  let out: { load: number; spread: number } | null = null;
  if (t && h) {
    const blend = 0.75 * t.load + 0.25 * h.load;
    // A back-off read from the top set it follows: history may only bring it
    // down (header note 9).
    out = { load: model.carried ? Math.min(t.load, blend) : blend, spread: clamp(h.spread / 2, TODAY_SPREAD, 0.05) };
  }
  else if (t) out = { load: t.load, spread: TODAY_SPREAD };
  else if (h) {
    const spread = clamp(h.spread / 2, HISTORY_SPREAD, 0.07);
    out = { load: h.load, spread: model.early ? Math.max(EARLY_SPREAD, spread) : spread };
  }
  if (floor && (!out || floor.load > out.load)) out = { load: floor.load, spread: TODAY_SPREAD };
  return out;
}

export interface LoadSuggestion {
  low: number;
  high: number;
  target: number;
  unit: "kg" | "lb";
  /**
   * What the last warm-up did to it (LoadEstimate.warmup): only when one was
   * read. "light": too far under the working weight to say anything (warmupRelevance).
   */
  warmup?: "tuned" | "too_easy" | "light";
  /** Double progression decided it (note 12): add a step, stay and build reps, or come down a step. */
  progression?: RepProgression;
}

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Plate-loadable increments. Lighter lb loads (dumbbells, cables) use 2.5. */
export function loadStep(unit: "kg" | "lb", load: number): number {
  if (unit === "kg") return load < 20 ? 1 : 2.5;
  return load < 50 ? 2.5 : 5;
}

/**
 * Suggested load window for a set of `reps` at `rpe`.
 * Low = RPE −0.5, high = RPE +0.5, widened by the model's spread.
 */
export function suggestSetLoad(
  model: LoadModel,
  target: { reps: number; rpe: number },
): LoadSuggestion | null {
  // Double progression (note 12): one weight, the last session's or the next step.
  if (model.progression && model.today.length === 0) {
    const p = model.progression;
    return { low: p.load, high: p.load, target: p.load, unit: model.unit, progression: p };
  }
  const reps = Math.round(target.reps);
  const rpe = Math.min(10, Math.max(MIN_RPE, target.rpe));
  const est = estimateFor(model, reps, rpe);
  if (!est) return null;
  const mid = percentOf1RM(reps, 10 - rpe);
  const lowPct = percentOf1RM(reps, 10 - Math.max(MIN_RPE, rpe - 0.5));
  const highPct = percentOf1RM(reps, 10 - Math.min(10, rpe + 0.5));
  if (!mid || !lowPct || !highPct) return null;
  const raw = est.load;
  // Plate steps for the competition lifts; anything else rounds to the steps this
  // athlete loads on it and lands on a weight they've used (loadIncrement, snapLoad).
  const own = !!(model.ladder?.length || model.equipment);
  const step = own ? loadIncrement({ ladder: model.ladder, unit: model.unit, load: raw, kind: model.equipment }) : loadStep(model.unit, raw);
  const snap = (x: number) => (model.ladder?.length ? snapLoad(x, step, model.ladder) : roundToStep(x, step));
  const targetLoad = snap(raw);
  // ±0.5 RPE window (shrunk like the estimate), widened by history noise.
  const lowRatio = Math.pow(lowPct / mid, HISTORY_ALPHA);
  const highRatio = Math.pow(highPct / mid, HISTORY_ALPHA);
  let low = snap(raw * lowRatio * (1 - est.spread));
  let high = snap(raw * highRatio * (1 + est.spread));
  low = Math.min(low, targetLoad);
  high = Math.max(high, targetLoad);
  if (!(targetLoad > 0) || !(low > 0)) return null;
  return { low, high, target: targetLoad, unit: model.unit, ...(est.warmup ? { warmup: est.warmup } : {}) };
}

/**
 * The in-session "audible": how much to change the next set when the bar moves
 * clearly faster or slower than planned. ~2.5% rounded to a loadable plate
 * step and never less than one step (3.3% on average once rounded): a little
 * under one RPE on the chart, where one rep in reserve is worth 3–4.5% at 1–8
 * reps.
 */
export function audibleStep(target: number, unit: "kg" | "lb"): number {
  const step = loadStep(unit, target);
  return Math.max(step, roundToStep(target * 0.025, step));
}

/**
 * When the suggestion is a weight to choose from rather than one number: the
 * day's first heavy set of a barbell squat, bench or deadlift (the competition
 * lift or a barbell variation, `rangeLift`) that's prescribed by effort, read
 * from enough history, on the lift's first card today with nothing of it logged
 * anywhere yet (`firstHeavyCards`, pick-range.ts). That's the call a lifter makes
 * from their warm-ups, so the card offers the loads one "audible" either side of
 * the estimate (the same step the ⓘ says to move by when the bar is flying or
 * slow), never wider than the model's own calibrated range.
 *
 * Why one audible, not the model's spread: backtested Nov 15 2026 on 316 cold
 * first sets of the competition lifts (11 athletes) and 354 of variations (16),
 * the honest cold uncertainty is wide (the middle half of real loads ran −4% to
 * +10% of the estimate), and the model's own spread barely varies case to case
 * (at its 5% floor two times in three), so it can't size a range per lift. A
 * range that wide is no choice at all; one audible either side (±3.3% on average
 * once rounded to plates, a little under one RPE either side of the target)
 * held as many real first sets as an exact ±1 RPE band on the chart (37% vs
 * 36%), so the step stays: the loads between a day an RPE easier and an RPE
 * harder than usual, the swing a lifter can actually feel in their warm-ups.
 *
 * Everything else stays one number: a set logged on this card today, rated or
 * not (`loggedHere`), a logged final warm-up (it already tuned the number), a
 * back-off or variation on a later card of the lift (`firstOfLift`), an early
 * estimate from thin history (a range would claim a precision it doesn't have),
 * and accessories, including a dumbbell, machine or band lift of a main lift's
 * family, whose loads jump by the stack or the dumbbell and progress from last
 * time. A coach's load (a % of a max, a fixed weight, a top-set back-off) never
 * reaches the engine.
 */
export const PICK_RANGE_MAX_LOADS = 7;
export function suggestionPicks(input: {
  hint: LoadSuggestion;
  model: Pick<LoadModel, "source" | "early" | "carried" | "warmup" | "today">;
  /** A barbell squat, bench or deadlift: the competition lift or a barbell variation (rangeLift, pick-range.ts). */
  mainLift: boolean;
  /** The prescription names an RPE or RIR (planningTarget otherwise assumes RPE 8). */
  effortPrescribed: boolean;
  /** The lift's first card today, with no set of it logged on another card (firstHeavyCards). */
  firstOfLift?: boolean;
  /** A working set is already logged on this card today, rated or not. */
  loggedHere?: boolean;
}): { low: number; high: number; loads: number[] } | null {
  const { hint, model } = input;
  if (!input.mainLift || !input.effortPrescribed) return null;
  if (input.firstOfLift === false || input.loggedHere) return null;
  if (model.source !== "history" || model.early || model.carried || model.warmup || model.today.length) return null;
  const swing = audibleStep(hint.target, hint.unit);
  const down = Math.min(swing, hint.target - hint.low);
  const up = Math.min(swing, hint.high - hint.target);
  // Loadable weights from the target out, a plate step apart (two when a heavy
  // pull would make it a long row), so the target is always one of them.
  let by = loadStep(hint.unit, hint.target);
  const steps = (span: number) => Math.floor(span / by + 1e-9);
  while (steps(down) + steps(up) + 1 > PICK_RANGE_MAX_LOADS) by *= 2;
  const kd = steps(down);
  const ku = steps(up);
  if (kd + ku === 0) return null;
  const loads: number[] = [];
  for (let k = -kd; k <= ku; k++) loads.push(Math.round((hint.target + k * by) * 100) / 100);
  return { low: loads[0], high: loads[loads.length - 1], loads };
}

/**
 * What the athlete's LAST warm-up should be before the first working set, so it
 * is heavy enough to read how today feels yet light enough to cost nothing:
 * a single at ~90% for a top set of 1–3 reps, a double at ~87% for 4–6 and
 * ~85% for 7+ (standard powerlifting warm-up ramps), rounded DOWN to plates.
 */
export function suggestFinalWarmup(target: number, planReps: number, unit: "kg" | "lb"): { load: number; reps: number } | null {
  if (!(target > 0) || !(planReps >= 1)) return null;
  const pct = planReps <= 3 ? 0.9 : planReps <= 6 ? 0.87 : 0.85;
  const step = loadStep(unit, target);
  const load = Math.floor((target * pct) / step) * step;
  if (!(load > 0)) return null;
  return { load, reps: planReps <= 3 ? 1 : 2 };
}

/**
 * Which reps/RPE to plan for from the prescription. Rep ranges plan for the
 * midpoint; no prescribed effort means a normal working set (RPE 8).
 */
export function planningTarget(input: {
  repTarget: { exact?: number; min?: number; max?: number } | null | undefined;
  rpeTarget: { exact?: number; min?: number; max?: number } | null | undefined;
  rirTarget: { exact?: number; min?: number; max?: number } | null | undefined;
}): { reps: number; rpe: number } | null {
  const r = input.repTarget;
  const reps = r?.exact ?? (r?.min != null && r?.max != null ? Math.round((r.min + r.max) / 2) : r?.min ?? r?.max);
  if (!reps || reps < 1 || reps > MAX_SET_REPS) return null;
  const mid = (t: { exact?: number; min?: number; max?: number } | null | undefined) =>
    t?.exact ?? (t?.min != null && t?.max != null ? (t.min + t.max) / 2 : t?.min ?? t?.max ?? null);
  const rpe = mid(input.rpeTarget);
  const rir = mid(input.rirTarget);
  const effort = rpe != null ? rpe : rir != null ? 10 - rir : 8;
  const plan = { reps, rpe: Math.min(10, Math.max(MIN_RPE, Math.round(effort * 2) / 2)) };
  // Past the chart (e.g. 30 reps @ RPE 7) there is nothing to plan with.
  return percentOf1RM(plan.reps, 10 - plan.rpe) ? plan : null;
}


// ── Live across cards (header note 9) ─────────────────────────────────────
export const DAY_FACTOR_MAX = 0.08;
export const DAY_FACTOR_TRUST_SAME = 0.8;
export const DAY_FACTOR_TRUST_FAMILY = 0.5;

/**
 * How today's logged sets of a lift compare with what its recent sessions
 * predicted for the same reps @ RPE: 1.03 = moving 3% better than usual.
 * Every rated set counts (light ones capped by MAX_EASIER_CREDIT inside
 * estimateFor), and the first sets weigh most (later sets carry fatigue). Null without enough
 * history or a usable set.
 */
export function todayVsUsual(input: {
  history: PreviousLiftLog[];
  sets: SetSample[];
  unit: "kg" | "lb";
  bodyweightKg?: number | null;
  lift?: LiftKind;
  now?: Date;
}): number | null {
  // History as logged: today's sets compared here come from every card of the
  // lift, back-offs included (note 11 is for a fresh first set only).
  const model = buildLoadModel({ history: input.history, today: [], unit: input.unit, bodyweightKg: input.bodyweightKg, lift: input.lift, backoffs: "as_logged", now: input.now });
  if (model.status !== "ready" || model.source !== "history" || model.early) return null;
  let sum = 0;
  let weight = 0;
  let i = 0;
  for (const s of input.sets) {
    // Light sets count too (an RPE 4 tempo wave is real work); a cut-off at 6
    // made re-rating 6 → 5.5 drop the read and other cards jump back.
    if (s.rpe == null || s.rpe > 10 || !(s.load > 0) || !(s.reps >= 1) || s.reps > 12) continue;
    const est = estimateFor(model, Math.round(s.reps), Math.max(MIN_RPE, s.rpe));
    if (!est || !(est.load > 0)) continue;
    const w = 1 / (1 + i++);
    sum += (s.load / est.load) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

/** Today's read → the factor applied to another card of the lift. */
export function dayFactorFrom(ratio: number | null | undefined, trust: number): number | null {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const shift = Math.min(DAY_FACTOR_MAX, Math.max(-DAY_FACTOR_MAX, (ratio - 1) * trust));
  return Math.abs(shift) < 0.005 ? null : 1 + shift;
}
