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
};

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
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
