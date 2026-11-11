/**
 * CANONICAL cardio adherence + analytics math.
 *
 * Single source of truth used by BOTH:
 *  - Training Analytics → Cardio section
 *  - Training Readiness (weekly cardio supporting signal)
 *
 * Data sources (canonical, no new tables):
 *  - public.cardio_targets      → prescriptions (frequency_per_week,
 *                                 duration_minutes, cardio_type, intensity,
 *                                 heart_rate_zone, start_date/end_date,
 *                                 status, enabled)
 *  - public.cardio_completions  → logged results (completed, skipped,
 *                                 duration_minutes, cardio_type, rpe,
 *                                 distance, distance_unit, avg_speed,
 *                                 incline, calories, avg_heart_rate)
 */

export type CardioTargetRow = {
  id?: string | null;
  cardio_type?: string | null;
  custom_type?: string | null;
  frequency_per_week?: number | null;
  duration_minutes?: number | null;
  intensity?: string | null;
  heart_rate_zone?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  enabled?: boolean | null;
};

export type CardioCompletionRow = {
  id?: string | null;
  cardio_target_id?: string | null;
  completed_date: string;
  completed?: boolean | null;
  skipped?: boolean | null;
  duration_minutes?: number | null;
  cardio_type?: string | null;
  incline?: number | null;
  avg_speed?: number | null;
  distance?: number | null;
  distance_unit?: string | null;
  calories?: number | null;
  avg_heart_rate?: number | null;
  rpe?: number | null;
  /** 'workout' = logged as the last exercise of a workout; anything else = logged on its own. */
  completion_target?: string | null;
};

export type CardioZone = "zone2" | "hiit" | "moderate" | "other";

export const ZONE_LABELS: Record<CardioZone, string> = {
  zone2: "Zone 2 / LISS",
  hiit: "HIIT",
  moderate: "Moderate",
  other: "Other",
};

/* ── date helpers (ISO yyyy-MM-dd, string comparison safe) ───────────── */

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

/* ── canonical status ────────────────────────────────────────────────── */

/** Completed means the canonical log says so — never inferred from existence. */
export function isCompletedCardio(c: CardioCompletionRow): boolean {
  return c.completed === true && !c.skipped;
}

export function isSkippedCardio(c: CardioCompletionRow): boolean {
  return !!c.skipped;
}

/* ── classification ──────────────────────────────────────────────────── */

export function classifyZone(source: {
  cardio_type?: string | null;
  custom_type?: string | null;
  intensity?: string | null;
  heart_rate_zone?: string | null;
}): CardioZone {
  const hay = [source.cardio_type, source.custom_type, source.intensity, source.heart_rate_zone]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay.trim()) return "other";
  if (/hiit|interval|sprint|zone\s*[45]/.test(hay)) return "hiit";
  if (/liss|zone\s*2|z2|steady|low[\s-]*intensity|conversational/.test(hay)) return "zone2";
  if (/moderate|zone\s*3|tempo/.test(hay)) return "moderate";
  return "other";
}

const MODALITY_RULES: Array<[RegExp, string]> = [
  [/incline\s*walk|treadmill\s*walk|walk/i, "Incline Walking"],
  [/treadmill|run|jog/i, "Running"],
  [/bike|cycl|spin|assault|airdyne/i, "Bike"],
  [/stair|step\s*mill|stepper/i, "Stairmill"],
  [/elliptical|arc\s*trainer/i, "Elliptical"],
  [/row/i, "Rowing"],
  [/swim/i, "Swimming"],
  [/ski\s*erg|skierg/i, "SkiErg"],
];

export function classifyModality(raw?: string | null): string {
  const s = (raw ?? "").trim();
  if (!s) return "Other";
  for (const [re, label] of MODALITY_RULES) if (re.test(s)) return label;
  return s.length <= 24 ? s : "Other";
}

/** Modalities where incline/speed are meaningful (never mixed with bike/row). */
export function modalitySupportsInclineSpeed(modality: string): boolean {
  return modality === "Incline Walking" || modality === "Running";
}

/* ── prescription maths ──────────────────────────────────────────────── */

export function isActiveTarget(t: CardioTargetRow): boolean {
  return (t.enabled ?? true) && (t.status ?? "") !== "Archived";
}

/** Targets whose own window overlaps [start, end]. */
export function targetsInRange(
  targets: CardioTargetRow[],
  start: string,
  end: string,
): CardioTargetRow[] {
  return targets
    .filter(isActiveTarget)
    .filter((t) => (!t.start_date || t.start_date <= end) && (!t.end_date || t.end_date >= start));
}

/** Weeks a target is actually live inside [start, end] (fractional, >= 0). */
export function targetWeeksInRange(t: CardioTargetRow, start: string, end: string): number {
  const s = t.start_date && t.start_date > start ? t.start_date : start;
  const e = t.end_date && t.end_date < end ? t.end_date : end;
  const days = daysBetween(s, e) + 1;
  if (days <= 0) return 0;
  return days / 7;
}

export type CardioPrescription = {
  sessions: number;
  minutes: number;
};

/** Prescribed sessions + minutes across a date range. */
export function prescribedFor(
  targets: CardioTargetRow[],
  start: string,
  end: string,
): CardioPrescription {
  let sessions = 0;
  let minutes = 0;
  for (const t of targetsInRange(targets, start, end)) {
    const weeks = targetWeeksInRange(t, start, end);
    const freq = Number(t.frequency_per_week) || 0;
    const s = freq * weeks;
    sessions += s;
    minutes += s * (Number(t.duration_minutes) || 0);
  }
  return { sessions: Math.round(sessions), minutes: Math.round(minutes) };
}

/**
 * THE adherence formula. Used by analytics AND readiness so the two can never
 * disagree. Returns null when nothing was prescribed (no false 0%).
 */
export function adherencePct(completed: number, prescribed: number): number | null {
  if (!prescribed || prescribed <= 0) return null;
  return Math.min(100, Math.round((completed / prescribed) * 100));
}

/* ── weekly buckets ──────────────────────────────────────────────────── */

export type CardioWeek = {
  index: number;
  start: string;
  end: string;
  label: string;
  prescribedSessions: number;
  completedSessions: number;
  prescribedMinutes: number;
  completedMinutes: number;
  adherence: number | null;
  /** Average RPE of the week's rated sessions (null when none was rated). */
  avgRpe: number | null;
  /** Calories logged that week (null when none were). */
  calories: number | null;
};

function weekLabel(start: string): string {
  const d = parseISO(start);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function buildWeeks(
  targets: CardioTargetRow[],
  completions: CardioCompletionRow[],
  start: string,
  end: string,
): CardioWeek[] {
  const weeks: CardioWeek[] = [];
  const total = daysBetween(start, end) + 1;
  if (total <= 0) return weeks;
  const count = Math.min(Math.ceil(total / 7), 104);
  for (let i = 0; i < count; i++) {
    const wStart = addDays(start, i * 7);
    let wEnd = addDays(wStart, 6);
    if (wEnd > end) wEnd = end;
    const p = prescribedFor(targets, wStart, wEnd);
    const done = completions.filter(
      (c) => c.completed_date >= wStart && c.completed_date <= wEnd && isCompletedCardio(c),
    );
    weeks.push({
      index: i + 1,
      start: wStart,
      end: wEnd,
      label: weekLabel(wStart),
      prescribedSessions: p.sessions,
      completedSessions: done.length,
      prescribedMinutes: p.minutes,
      completedMinutes: Math.round(done.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0)),
      adherence: adherencePct(done.length, p.sessions),
      avgRpe: avgOf(done.map((c) => c.rpe)),
      calories: sumOf(done.map((c) => c.calories)),
    });
  }
  return weeks;
}

/* ── modality / zone breakdowns ──────────────────────────────────────── */

export type ModalityStat = {
  modality: string;
  sessions: number;
  minutes: number;
  pctOfMinutes: number;
  avgIncline: number | null;
  avgSpeed: number | null;
  speedUnit: string | null;
};

export function modalityBreakdown(completions: CardioCompletionRow[]): ModalityStat[] {
  const done = completions.filter(isCompletedCardio);
  const totalMinutes = done.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0);
  const map = new Map<string, CardioCompletionRow[]>();
  for (const c of done) {
    const key = classifyModality(c.cardio_type);
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  const out: ModalityStat[] = [];
  for (const [modality, rows] of map) {
    const minutes = rows.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0);
    const inclines = modalitySupportsInclineSpeed(modality)
      ? rows.map((r) => Number(r.incline)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const speeds = modalitySupportsInclineSpeed(modality)
      ? rows.map((r) => Number(r.avg_speed)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const unitRow = rows.find((r) => !!r.distance_unit);
    const unit = unitRow?.distance_unit?.toLowerCase();
    out.push({
      modality,
      sessions: rows.length,
      minutes: Math.round(minutes),
      pctOfMinutes: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
      avgIncline: inclines.length ? round1(avg(inclines)) : null,
      avgSpeed: speeds.length ? round1(avg(speeds)) : null,
      speedUnit: speeds.length ? (unit === "km" || unit === "kilometers" ? "km/h" : "mph") : null,
    });
  }
  return out.sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions);
}

export type ZoneStat = { zone: CardioZone; label: string; sessions: number; minutes: number };

export function zoneBreakdown(
  completions: CardioCompletionRow[],
  targetsById: Map<string, CardioTargetRow>,
): ZoneStat[] {
  const done = completions.filter(isCompletedCardio);
  const map = new Map<CardioZone, ZoneStat>();
  for (const c of done) {
    const target = c.cardio_target_id ? targetsById.get(c.cardio_target_id) : undefined;
    const zone = classifyZone({
      cardio_type: c.cardio_type ?? target?.cardio_type,
      custom_type: target?.custom_type,
      intensity: target?.intensity,
      heart_rate_zone: target?.heart_rate_zone,
    });
    const cur = map.get(zone) ?? { zone, label: ZONE_LABELS[zone], sessions: 0, minutes: 0 };
    cur.sessions += 1;
    cur.minutes += Number(c.duration_minutes) || 0;
    map.set(zone, cur);
  }
  return [...map.values()]
    .map((z) => ({ ...z, minutes: Math.round(z.minutes) }))
    .sort((a, b) => b.minutes - a.minutes);
}

/* ── full summary ────────────────────────────────────────────────────── */

export type Zone2Tracker = {
  prescribedSessions: number;
  completedSessions: number;
  prescribedMinutes: number;
  completedMinutes: number;
  adherence: number | null;
};

export type CardioSummary = {
  hasPrescription: boolean;
  prescribedSessions: number;
  completedSessions: number;
  skippedSessions: number;
  prescribedMinutes: number;
  completedMinutes: number;
  adherence: number | null;
  minutesAdherence: number | null;
  avgDuration: number | null;
  weeks: CardioWeek[];
  modalities: ModalityStat[];
  zones: ZoneStat[];
  zone2: Zone2Tracker | null;
  /** Calories logged across completed sessions (null when none were). */
  totalCalories: number | null;
  /** Per session, over the sessions that logged calories. */
  avgCalories: number | null;
  caloriesSessions: number;
  /** Average RPE over the sessions that were rated. */
  avgRpe: number | null;
  rpeSessions: number;
  avgHeartRate: number | null;
  /** Every session in range (done and skipped), newest first: the details a coach reads. */
  sessions: CardioSession[];
  /** How hard the same cardio feels over the range (the most-rated modality), or null. */
  effort: (EffortTrend & { modality: string }) | null;
};

export type CardioSession = {
  id: string | null;
  date: string;
  modality: string;
  minutes: number | null;
  calories: number | null;
  rpe: number | null;
  heartRate: number | null;
  incline: number | null;
  speed: number | null;
  distance: number | null;
  distanceUnit: string | null;
  fromWorkout: boolean;
  skipped: boolean;
};

/* ── effort trend ────────────────────────────────────────────────────── */

export type EffortPoint = { date: string; minutes: number | null; rpe: number | null };

export type EffortTrend = {
  /** easier = lower RPE for the same (or more) work; harder = higher RPE for the same (or less). */
  direction: "easier" | "harder" | "steady";
  fromRpe: number;
  toRpe: number;
  fromMinutes: number | null;
  toMinutes: number | null;
  /** Rated sessions it read. */
  sessions: number;
  text: string;
};

/** Below this many rated sessions, one hard day would read as a trend. */
export const EFFORT_MIN_SESSIONS = 4;

/**
 * Is the same cardio getting easier or harder? The first few rated sessions
 * against the last few (up to 3 each), RPE beside session length, so "RPE 7 →
 * 6 at the same 20 minutes" (fitter) is never confused with "RPE 6 because the
 * walks got shorter". A half point of RPE is the smallest change it calls.
 * Pass one modality at a time: a bike's RPE says nothing about a walk's.
 */
export function effortTrend(points: EffortPoint[]): EffortTrend | null {
  const rated = points
    .filter((p) => p.rpe != null && Number.isFinite(Number(p.rpe)) && Number(p.rpe) > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rated.length < EFFORT_MIN_SESSIONS) return null;
  const k = Math.min(3, Math.floor(rated.length / 2));
  const early = rated.slice(0, k);
  const late = rated.slice(-k);
  const fromRpe = round1(avg(early.map((p) => Number(p.rpe))));
  const toRpe = round1(avg(late.map((p) => Number(p.rpe))));
  const mins = (arr: EffortPoint[]) => {
    const m = arr.map((p) => Number(p.minutes)).filter((n) => Number.isFinite(n) && n > 0);
    return m.length ? Math.round(avg(m)) : null;
  };
  const fromMinutes = mins(early);
  const toMinutes = mins(late);
  const both = fromMinutes != null && toMinutes != null;
  const longer = both && toMinutes! > fromMinutes! * 1.1;
  const shorter = both && toMinutes! < fromMinutes! * 0.9;
  const d = round1(toRpe - fromRpe);
  const direction: EffortTrend["direction"] =
    d <= -0.5 && !shorter ? "easier" : d >= 0.5 && !longer ? "harder" : "steady";
  const length = !both
    ? ""
    : longer || shorter
      ? ` while sessions went from ${fromMinutes} to ${toMinutes} min`
      : ` for about the same ${toMinutes} min`;
  const text =
    direction === "easier"
      ? `Effort is down from RPE ${fromRpe} to ${toRpe}${length}. The same cardio is getting easier, which usually means fitness is improving and there's room to progress it (more time or incline).`
      : direction === "harder"
        ? `Effort is up from RPE ${fromRpe} to ${toRpe}${length}. Worth a look at sleep, recovery, food and how hard lifting has been.`
        : d === 0 || (!longer && !shorter)
          ? `Effort is steady at about RPE ${toRpe}${length}.`
          : `RPE went from ${fromRpe} to ${toRpe}${length}.`;
  return { direction, fromRpe, toRpe, fromMinutes, toMinutes, sessions: rated.length, text };
}

export function summarizeCardio(input: {
  targets: CardioTargetRow[];
  completions: CardioCompletionRow[];
  start: string;
  end: string;
}): CardioSummary {
  const { start, end } = input;
  const completions = input.completions.filter(
    (c) => c.completed_date >= start && c.completed_date <= end,
  );
  const inRangeTargets = targetsInRange(input.targets, start, end);
  const targetsById = new Map<string, CardioTargetRow>();
  for (const t of input.targets) if (t.id) targetsById.set(t.id, t);

  const done = completions.filter(isCompletedCardio);
  const prescribed = prescribedFor(input.targets, start, end);
  const completedMinutes = Math.round(
    done.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0),
  );

  const z2Targets = inRangeTargets.filter(
    (t) => classifyZone(t) === "zone2",
  );
  const z2Prescribed = prescribedFor(z2Targets, start, end);
  const z2Ids = new Set(z2Targets.map((t) => t.id).filter(Boolean) as string[]);
  const z2Done = done.filter((c) => {
    if (c.cardio_target_id && z2Ids.has(c.cardio_target_id)) return true;
    if (c.cardio_target_id) return false;
    return classifyZone({ cardio_type: c.cardio_type }) === "zone2";
  });

  const withDuration = done.filter((c) => (Number(c.duration_minutes) || 0) > 0);
  const calories = done.map((c) => c.calories).filter(isNum);
  const rpes = done.map((c) => c.rpe).filter(isNum);

  // the details, newest first
  const sessions: CardioSession[] = completions
    .filter((c) => isCompletedCardio(c) || isSkippedCardio(c))
    .map((c) => {
      const modality = classifyModality(c.cardio_type);
      const unit = c.distance_unit?.toLowerCase() ?? null;
      return {
        id: c.id ?? null,
        date: c.completed_date,
        modality,
        minutes: isNum(c.duration_minutes) ? Math.round(Number(c.duration_minutes)) : null,
        calories: isNum(c.calories) ? Math.round(Number(c.calories)) : null,
        rpe: isNum(c.rpe) ? round1(Number(c.rpe)) : null,
        heartRate: isNum(c.avg_heart_rate) ? Math.round(Number(c.avg_heart_rate)) : null,
        incline: modalitySupportsInclineSpeed(modality) && isNum(c.incline) ? round1(Number(c.incline)) : null,
        speed: modalitySupportsInclineSpeed(modality) && isNum(c.avg_speed) ? round1(Number(c.avg_speed)) : null,
        distance: isNum(c.distance) ? round1(Number(c.distance)) : null,
        distanceUnit: unit,
        fromWorkout: c.completion_target === "workout",
        skipped: isSkippedCardio(c),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // effort, like with like: the modality with the most rated sessions
  const byModality = new Map<string, EffortPoint[]>();
  for (const x of sessions) {
    if (x.skipped || x.rpe == null) continue;
    const arr = byModality.get(x.modality) ?? [];
    arr.push({ date: x.date, minutes: x.minutes, rpe: x.rpe });
    byModality.set(x.modality, arr);
  }
  const [effortModality, effortPoints] = [...byModality.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [null, []];
  const trend = effortModality ? effortTrend(effortPoints) : null;

  return {
    hasPrescription: prescribed.sessions > 0,
    prescribedSessions: prescribed.sessions,
    completedSessions: done.length,
    skippedSessions: completions.filter(isSkippedCardio).length,
    prescribedMinutes: prescribed.minutes,
    completedMinutes,
    adherence: adherencePct(done.length, prescribed.sessions),
    minutesAdherence: adherencePct(completedMinutes, prescribed.minutes),
    avgDuration: withDuration.length
      ? Math.round(
          withDuration.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0) /
            withDuration.length,
        )
      : null,
    weeks: buildWeeks(input.targets, completions, start, end),
    modalities: modalityBreakdown(completions),
    zones: zoneBreakdown(completions, targetsById),
    zone2:
      z2Prescribed.sessions > 0
        ? {
            prescribedSessions: z2Prescribed.sessions,
            completedSessions: z2Done.length,
            prescribedMinutes: z2Prescribed.minutes,
            completedMinutes: Math.round(
              z2Done.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0),
            ),
            adherence: adherencePct(z2Done.length, z2Prescribed.sessions),
          }
        : null,
    totalCalories: calories.length ? Math.round(calories.reduce((s, n) => s + n, 0)) : null,
    avgCalories: calories.length ? Math.round(avg(calories)) : null,
    caloriesSessions: calories.length,
    avgRpe: rpes.length ? round1(avg(rpes)) : null,
    rpeSessions: rpes.length,
    avgHeartRate: avgOf(done.map((c) => c.avg_heart_rate), 0),
    sessions,
    effort: trend && effortModality ? { ...trend, modality: effortModality } : null,
  };
}

/* ── insight ─────────────────────────────────────────────────────────── */

export function cardioInsight(
  summary: CardioSummary,
  rangeLabel: string,
  priorCompletedMinutes?: number | null,
): string | null {
  if (!summary.hasPrescription && summary.completedSessions === 0) return null;
  if (summary.adherence != null && summary.prescribedSessions >= 2) {
    const trailing =
      priorCompletedMinutes != null && priorCompletedMinutes > 0
        ? summary.completedMinutes - priorCompletedMinutes
        : null;
    const base = `Cardio adherence is ${summary.adherence}% in ${rangeLabel.toLowerCase()}.`;
    if (trailing != null && Math.abs(trailing) >= 15) {
      return `${base} That's ${Math.abs(trailing)} ${trailing > 0 ? "more" : "fewer"} minutes than the previous period.`;
    }
    return base;
  }
  if (summary.completedSessions > 0) {
    return `${summary.completedSessions} cardio session${summary.completedSessions === 1 ? "" : "s"} logged (${summary.completedMinutes} min) in ${rangeLabel.toLowerCase()}.`;
  }
  return "No meaningful cardio trend yet.";
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
function isNum(v: unknown): v is number {
  return v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;
}
/** Average of the values that were logged (rounded to `digits`), or null when none were. */
function avgOf(values: Array<number | null | undefined>, digits = 1): number | null {
  const n = values.filter(isNum).map(Number);
  if (!n.length) return null;
  const f = 10 ** digits;
  return Math.round(avg(n) * f) / f;
}
/** Sum of the values that were logged, or null when none were. */
function sumOf(values: Array<number | null | undefined>): number | null {
  const n = values.filter(isNum).map(Number);
  return n.length ? Math.round(n.reduce((s, x) => s + x, 0)) : null;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
