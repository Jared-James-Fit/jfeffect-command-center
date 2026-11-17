/**
 * Lift-specific meet taper (pure, tested). Once a meet's lifting day is
 * confirmed, the taper's sessions (a prep's locked final weeks) are planned
 * per lift instead of all sliding together:
 *
 *   1. Each lift's final meaningful heavy session gets its own days out
 *      (`liftTargets`), inside that lift's window (TAPER_WINDOWS: bench
 *      recovers fastest and can sit closest, deadlift tolerates being furthest
 *      out): toward the gap that preceded the athlete's best-peaked meet for
 *      that lift when their logs hold one (`pastMeetTapers`; all the way with
 *      3+ meets, at most halfway from what's written with 1–2), else where the
 *      program has it now. A lift whose Training Max work keeps running past
 *      its RPE caps (`slowLifts`, tm-review.ts) gets SLOW_RECOVERY_DAYS more.
 *      The heavy sessions are then placed together (`planLiftTaper`).
 *   2. The primer keeps its days out (two days before, as written).
 *   3. Light technique sessions keep their days out unless that puts a lift's
 *      light exposure within LIGHT_AFTER_HEAVY days of its own final heavy
 *      day or on a day another session took: then they slide toward the meet.
 *   4. Nothing lands before the last session the taper leaves alone, before
 *      today, on or after the lifting day, or two sessions on one day; heavy
 *      days stay HEAVY_GAP apart (squat and deadlift HEAVY_SQUAT_DEADLIFT_GAP).
 *
 * "Best-peaked" is the meet result over the best estimated max the athlete
 * showed in training 2–10 weeks before it (so a stronger athlete later on
 * doesn't read as a better taper). It's evidence, not proof: two meets is a
 * small sample and a stance or technique change in between weakens it, which
 * the read says (`confidence`). The plan is a proposal the coach previews and
 * applies (pl_prep_set_meet_day with `_moves`), or keeps the even shift.
 */
import { percentOf1RM } from "@/lib/load-suggestion";

export type TaperLift = "squat" | "bench" | "deadlift";
export const TAPER_LIFTS: TaperLift[] = ["squat", "bench", "deadlift"];

/** Days out for a lift's final meaningful heavy session. */
export const TAPER_WINDOWS: Record<TaperLift, { min: number; max: number }> = {
  squat: { min: 8, max: 14 },
  bench: { min: 5, max: 11 },
  deadlift: { min: 8, max: 16 },
};
export const SLOW_RECOVERY_DAYS = 2;
export const LIGHT_AFTER_HEAVY = 2;
/** A set heavy enough to count as a final heavy exposure: this share of the meet result (a single or a triple)... */
const HEAVY_SHARE = 0.9;
/** ...or a hard set (RPE 8.5+) at this share. */
const HARD_SHARE = 0.85;
/** A meet day: a single on every lift at this share of the heaviest load in the 120 days before. */
const MEET_SHARE = 0.95;

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);
export const addDays = (iso: string, n: number) => isoOf(dayNum(iso) + n);

export type LiftSet = { date: string; lift: TaperLift; kg: number; reps: number; rpe: number | null };

export type PastMeetLift = {
  resultKg: number;
  /** the result over the best estimated max 2–10 weeks before (1 = performed at it) */
  peak: number | null;
  lastHeavy: { date: string; daysOut: number; kg: number; reps: number; rpe: number | null } | null;
};
export type PastMeet = { date: string; lifts: Partial<Record<TaperLift, PastMeetLift>> };

const e1rm = (s: { kg: number; reps: number; rpe: number | null }) => {
  if (s.rpe == null || s.rpe < 6.5 || s.reps > 10) return null;
  const p = percentOf1RM(s.reps, 10 - s.rpe);
  return p ? s.kg / p : null;
};

/**
 * The athlete's past meets from their logs: a day with a single on every
 * competition lift at MEET_SHARE of the heaviest of that lift in the 120 days
 * before. `hints` are known meet dates (a tested max's date); a meet logged up
 * to two days after one is counted from the hint.
 */
export function pastMeetTapers(sets: LiftSet[], hints: string[] = []): PastMeet[] {
  const byDay = new Map<string, LiftSet[]>();
  for (const s of sets) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const days = [...byDay.keys()].sort();
  const meets: PastMeet[] = [];
  for (const day of days) {
    const today = byDay.get(day)!;
    const tops: Partial<Record<TaperLift, number>> = {};
    let meet = true;
    for (const lift of TAPER_LIFTS) {
      const single = Math.max(0, ...today.filter((s) => s.lift === lift && s.reps === 1).map((s) => s.kg));
      const before = sets.filter((s) => s.lift === lift && s.reps <= 3 && daysBetween(s.date, day) > 0 && daysBetween(s.date, day) <= 120);
      const best = Math.max(0, ...before.map((s) => s.kg));
      if (!(single > 0) || !(best > 0) || single < best * MEET_SHARE) {
        meet = false;
        break;
      }
      tops[lift] = single;
    }
    if (!meet) continue;
    const hint = hints.find((h) => daysBetween(h, day) >= 0 && daysBetween(h, day) <= 2);
    const date = hint ?? day;
    const lifts: PastMeet["lifts"] = {};
    for (const lift of TAPER_LIFTS) {
      const result = tops[lift]!;
      const prior = sets.filter((s) => s.lift === lift && daysBetween(s.date, date) > 0);
      const heavy = prior
        .filter((s) => (s.reps <= 3 && s.kg >= result * HEAVY_SHARE) || ((s.rpe ?? 0) >= 8.5 && s.kg >= result * HARD_SHARE))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.kg - a.kg))[0];
      const window = prior.filter((s) => daysBetween(s.date, date) >= 14 && daysBetween(s.date, date) <= 70);
      const best = Math.max(0, ...window.map((s) => e1rm(s) ?? 0));
      lifts[lift] = {
        resultKg: result,
        peak: best > 0 ? Math.round((result / best) * 1000) / 1000 : null,
        lastHeavy: heavy ? { date: heavy.date, daysOut: daysBetween(heavy.date, date), kg: heavy.kg, reps: heavy.reps, rpe: heavy.rpe } : null,
      };
    }
    // the same meet logged on two days counts once
    if (meets.length && daysBetween(meets[meets.length - 1].date, date) <= 2) continue;
    meets.push({ date, lifts });
  }
  return meets;
}

export type LiftTarget = {
  lift: TaperLift;
  /** days out the program has it at after an even shift */
  writtenDaysOut: number | null;
  /** days out the plan aims for */
  daysOut: number;
  /** days out before the athlete's best-peaked meet, when the logs hold one */
  historyDaysOut: number | null;
  window: { min: number; max: number };
  source: "history" | "written";
  confidence: "none" | "low" | "moderate";
  slow: boolean;
  evidence: string[];
};

const fmtKg = (kg: number) => `${Math.round(kg * 10) / 10} kg`;
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LIFT_NAME: Record<TaperLift, string> = { squat: "squat", bench: "bench", deadlift: "deadlift" };

/**
 * Each lift's final heavy days out. With 3+ past meets the gap before the
 * best-peaked one is the target; with 1–2 (low confidence) the target moves at
 * most halfway from where the program has it toward that gap; with none it's
 * as written. A slow-recovering lift gets SLOW_RECOVERY_DAYS more. Always
 * inside the lift's window.
 */
export function liftTargets(input: {
  meets: PastMeet[];
  writtenDaysOut: Partial<Record<TaperLift, number>>;
  slowLifts?: TaperLift[];
}): LiftTarget[] {
  return TAPER_LIFTS.map((lift) => {
    const window = TAPER_WINDOWS[lift];
    const written = input.writtenDaysOut[lift] ?? null;
    const seen = input.meets
      .map((m) => ({ date: m.date, l: m.lifts[lift] }))
      .filter((x): x is { date: string; l: PastMeetLift } => !!x.l?.lastHeavy && x.l.peak != null);
    const evidence = seen.map(
      ({ date, l }) =>
        `${longDate(date)} meet: last heavy ${LIFT_NAME[lift]} ${l.lastHeavy!.daysOut} days out (${fmtKg(l.lastHeavy!.kg)} × ${l.lastHeavy!.reps}${l.lastHeavy!.rpe != null ? ` @${l.lastHeavy!.rpe}` : ""}), then ${fmtKg(l.resultKg)}, ${Math.round((l.peak as number) * 100)}% of the best he'd shown in training.`,
    );
    const confidence: LiftTarget["confidence"] = !seen.length ? "none" : seen.length >= 3 ? "moderate" : "low";
    const slow = (input.slowLifts ?? []).includes(lift);
    const best = seen.slice().sort((a, b) => (b.l.peak as number) - (a.l.peak as number))[0];
    const historyDaysOut = best ? best.l.lastHeavy!.daysOut : null;
    const clamp = (n: number) => Math.min(window.max, Math.max(window.min, n));
    const base = written ?? Math.round((window.min + window.max) / 2);
    let target = base;
    if (historyDaysOut != null) target = confidence === "moderate" ? historyDaysOut : base + Math.trunc((historyDaysOut - base) / 2);
    if (slow) {
      target += SLOW_RECOVERY_DAYS;
      evidence.push(`His ${LIFT_NAME[lift]} Training Max work keeps running past its RPE caps: ${SLOW_RECOVERY_DAYS} more days before the meet.`);
    }
    if (historyDaysOut != null && confidence === "low" && target !== historyDaysOut) {
      evidence.push(`Only ${seen.length} past meet${seen.length === 1 ? "" : "s"} to go on, so it moves at most halfway from the written ${base} days.`);
    }
    return {
      lift,
      writtenDaysOut: written,
      daysOut: clamp(target),
      historyDaysOut,
      window,
      source: historyDaysOut != null ? "history" : "written",
      confidence,
      slow,
      evidence,
    };
  });
}

/** A taper session as the planner sees it: which lifts it trains heavy or light. */
export type TaperSession = {
  dayId: string;
  title: string;
  /** its date after an even shift to the lifting day */
  date: string;
  heavy: TaperLift[];
  light: TaperLift[];
  /** the primer: the last session before the meet */
  primer?: boolean;
};

export type TaperMove = { dayId: string; title: string; from: string; to: string; why: string };

export type TaperPlan = {
  liftingDay: string;
  targets: LiftTarget[];
  moves: TaperMove[];
  /** every session with its planned date (moved or not) */
  sessions: Array<TaperSession & { planned: string }>;
  /** each lift's final heavy session, days out as planned */
  finalHeavy: Array<{ lift: TaperLift; date: string; daysOut: number }>;
  warnings: string[];
};

/** Heavy sessions at least this many days apart, squat and deadlift HEAVY_SQUAT_DEADLIFT_GAP. */
export const HEAVY_GAP = 2;
export const HEAVY_SQUAT_DEADLIFT_GAP = 3;
/** The first heavy taper session waits this long after the last session before the taper. */
export const AFTER_LAST_WEEK = 2;

/**
 * Plans the taper for a confirmed lifting day. `sessions` are the taper's
 * sessions already shifted evenly to that day (their written spacing); the
 * plan moves only what the lift targets ask for. The final heavy sessions are
 * placed together (every combination of days is tried: there are at most a
 * few), the rest keep their days out unless a rule says otherwise.
 */
export function planLiftTaper(input: {
  liftingDay: string;
  sessions: TaperSession[];
  meets: PastMeet[];
  slowLifts?: TaperLift[];
  /** the last session before the taper (left alone) */
  notBefore: string;
  today: string;
  /** the athlete's training weekdays (0 = Sunday); a day off them costs a little */
  trainingDays?: number[];
}): TaperPlan {
  const L = input.liftingDay;
  const Ln = dayNum(L);
  const warnings: string[] = [];
  const sessions = input.sessions.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const finalHeavy = new Map<TaperLift, TaperSession>();
  for (const s of sessions) for (const lift of s.heavy) finalHeavy.set(lift, s); // the last one wins
  const writtenDaysOut: Partial<Record<TaperLift, number>> = {};
  for (const [lift, s] of finalHeavy) writtenDaysOut[lift] = daysBetween(s.date, L);
  const targets = liftTargets({ meets: input.meets, writtenDaysOut, slowLifts: input.slowLifts });
  const targetOf = new Map(targets.map((t) => [t.lift, t]));

  const earliest = Math.max(dayNum(input.notBefore) + 1, dayNum(input.today));
  const latest = Ln - 1;
  const onTrainingDay = (n: number) => !input.trainingDays?.length || input.trainingDays.includes(((n % 7) + 7 + 4) % 7);

  // 1. the final heavy sessions, together
  const heavySessions = [...new Set([...finalHeavy.values()])];
  const liftsOf = (s: TaperSession) => s.heavy.filter((l) => finalHeavy.get(l) === s);
  const candidates = heavySessions.map((s) => {
    const all: number[] = [];
    for (let n = Math.max(earliest, dayNum(input.notBefore) + AFTER_LAST_WEEK); n <= latest; n++) all.push(n);
    const inWindow = all.filter((n) => liftsOf(s).every((l) => Ln - n >= TAPER_WINDOWS[l].min && Ln - n <= TAPER_WINDOWS[l].max));
    return inWindow.length ? inWindow : all;
  });
  const writtenOrder = heavySessions.map((s) => dayNum(s.date));
  let best: { cost: number; days: number[] } | null = null;
  const pick: number[] = [];
  const walk = (i: number) => {
    if (i === heavySessions.length) {
      let cost = 0;
      for (let k = 0; k < heavySessions.length; k++) {
        const s = heavySessions[k];
        for (const l of liftsOf(s)) cost += Math.abs(Ln - pick[k] - (targetOf.get(l)?.daysOut ?? Ln - writtenOrder[k]));
        cost += 0.25 * Math.abs(pick[k] - writtenOrder[k]);
        if (!onTrainingDay(pick[k]) && onTrainingDay(writtenOrder[k])) cost += 0.75;
        for (let j = 0; j < k; j++) if (Math.sign(pick[k] - pick[j]) !== Math.sign(writtenOrder[k] - writtenOrder[j])) cost += 1;
      }
      if (!best || cost < best.cost - 1e-9) best = { cost, days: pick.slice() };
      return;
    }
    for (const n of candidates[i]) {
      let fits = true;
      for (let j = 0; j < i && fits; j++) {
        const gap = Math.abs(n - pick[j]);
        const sd =
          (liftsOf(heavySessions[i]).includes("squat") && liftsOf(heavySessions[j]).includes("deadlift")) ||
          (liftsOf(heavySessions[i]).includes("deadlift") && liftsOf(heavySessions[j]).includes("squat"));
        if (gap < (sd ? HEAVY_SQUAT_DEADLIFT_GAP : HEAVY_GAP)) fits = false;
      }
      if (!fits) continue;
      pick[i] = n;
      walk(i + 1);
    }
  };
  walk(0);
  const planned = new Map<string, number>();
  const taken = new Map<number, string>();
  const why = new Map<string, string>();
  const put = (dayId: string, n: number) => {
    planned.set(dayId, n);
    taken.set(n, dayId);
  };
  const chosen = best as { cost: number; days: number[] } | null;
  if (!chosen) {
    warnings.push("The final heavy sessions don't fit between the last week and the meet with the spacing they need: they keep the even shift.");
    for (const s of heavySessions) put(s.dayId, dayNum(s.date));
  } else {
    heavySessions.forEach((s, k) => {
      put(s.dayId, chosen.days[k]);
      const lifts = liftsOf(s);
      why.set(s.dayId, `Final heavy ${lifts.map((l) => LIFT_NAME[l]).join(" + ")}: ${Ln - chosen.days[k]} days out`);
    });
  }

  // 2. the primer first, then the light sessions (nearest the meet first) keep their days out unless a rule says otherwise
  const rest = sessions
    .filter((s) => !planned.has(s.dayId))
    .sort((a, b) => Number(!!b.primer) - Number(!!a.primer) || (a.date < b.date ? 1 : -1));
  for (const s of rest) {
    const base = dayNum(s.date);
    const tooSoon = (n: number) =>
      s.light.some((lift) => {
        const h = finalHeavy.get(lift);
        if (!h || !planned.has(h.dayId)) return false;
        const hd = planned.get(h.dayId)!;
        // a light exposure that was written after the lift's final heavy stays LIGHT_AFTER_HEAVY+ days after it
        return base > dayNum(h.date) && n - hd < LIGHT_AFTER_HEAVY;
      });
    const free = (n: number) => n >= earliest && n <= latest && !taken.has(n);
    const fits = (n: number) => free(n) && !tooSoon(n);
    let at: number | undefined = fits(base) ? base : undefined;
    for (let d = 1; at == null && d <= 10; d++) {
      if (fits(base + d)) at = base + d;
      else if (fits(base - d)) at = base - d;
    }
    if (at == null) {
      warnings.push(`${s.title} has no free day that keeps ${LIGHT_AFTER_HEAVY} days after its lift's final heavy session: it keeps the even shift (${s.date}).`);
      at = base;
    }
    put(s.dayId, at);
    if (at !== base) why.set(s.dayId, s.primer ? "Primer: the nearest free day" : `Kept ${LIGHT_AFTER_HEAVY}+ days after the final heavy session and off a taken day`);
  }

  const out = sessions.map((s) => ({ ...s, planned: isoOf(planned.get(s.dayId) ?? dayNum(s.date)) }));
  const moves: TaperMove[] = out
    .filter((s) => s.planned !== s.date)
    .map((s) => ({ dayId: s.dayId, title: s.title, from: s.date, to: s.planned, why: why.get(s.dayId) ?? "Moved to keep the order" }));
  const finals = TAPER_LIFTS.filter((l) => finalHeavy.has(l)).map((l) => {
    const d = planned.get(finalHeavy.get(l)!.dayId)!;
    return { lift: l, date: isoOf(d), daysOut: Ln - d };
  });
  for (const t of targets) {
    const f = finals.find((x) => x.lift === t.lift);
    if (f && f.daysOut !== t.daysOut) warnings.push(`Final heavy ${LIFT_NAME[t.lift]} lands ${f.daysOut} days out, not ${t.daysOut}: the spacing between heavy days decided it.`);
  }
  return { liftingDay: L, targets, moves, sessions: out, finalHeavy: finals, warnings };
}

/** Lifts whose Training Max work keeps running past its caps (tm-review "review"). */
export function slowLiftsFrom(reviews: Partial<Record<TaperLift, { status: string }>>): TaperLift[] {
  return TAPER_LIFTS.filter((l) => reviews[l]?.status === "review");
}

/** How a row's lift and effort make a session heavy or light for a lift. */
export function classifyTaperRow(row: { lift: TaperLift | null; rpeCap: number | null }): "heavy" | "light" | null {
  if (!row.lift) return null;
  return (row.rpeCap ?? 0) >= 7 ? "heavy" : "light";
}
