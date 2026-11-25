/**
 * A client's cardio plan as the builder edits it (Nov 23 2026): a list of
 * sessions, each one kind of cardio on a set of days, for so long, this hard,
 * at this point in the day, with how it progresses and what the client reads.
 * The live plan is `cardio_targets` (one row per session, read everywhere the
 * client's cardio already shows: the Workouts day card, the workout's last
 * exercise, analytics); a draft is this shape kept on `cardio_plan_drafts`
 * until the coach publishes it. Pure and tested (cardio-plan.test.ts).
 *
 * Speed is kept in mph (what cardio_targets stores); the coach's speed unit
 * only changes how it's shown and typed.
 */
import { CARDIO_WEEKDAYS, normalizeCardioWeekdays, type CardioWeekday } from "@/lib/cardio-prescription";
import { kmhToMph, mphToKmh, round, type SpeedUnit } from "@/lib/weight-management/units";
import { DEFAULT_MODALITY, isModality, modalityOf, modalitySpec, netKcalPerMin, type Modality } from "@/lib/cardio/modalities";

export type DaysRule = "training" | "non_training" | "weekdays" | "daily" | "high";
export type Timing = "any" | "after_lifting" | "before_lifting" | "separate";
export type ProgressionKind = "none" | "minutes" | "incline" | "speed" | "sessions";
export type Progression = { kind: ProgressionKind; step: number; everyWeeks: number; cap: number | null };

export type CardioSession = {
  /** Stable while editing (the row id once published, else a local key). */
  key: string;
  /** The cardio_targets row it came from, if any. */
  id: string | null;
  modality: Modality;
  /** The name of a custom or conditioning session ("Sled pushes"). */
  name: string | null;
  days: DaysRule;
  /** The weekdays it's on. For training / daily / high these follow the client's own days at publish. */
  weekdays: CardioWeekday[];
  minutes: number;
  speedMinMph: number | null;
  speedMaxMph: number | null;
  incline: number | null;
  inclineMax: number | null;
  hrZone: string | null;
  hrMin: number | null;
  hrMax: number | null;
  rpeMin: number | null;
  rpeMax: number | null;
  timing: Timing;
  progression: Progression;
  /** What the client reads. */
  instructions: string;
  /** The coach's own note (never shown to the client). */
  coachNote: string;
  enabled: boolean;
};

export type CardioPlan = { sessions: CardioSession[] };

/** What the plan needs to know about the client to place sessions on days. */
export type PlanContext = {
  trainingDays: CardioWeekday[];
  highDays: CardioWeekday[];
};

export const NO_PROGRESSION: Progression = { kind: "none", step: 0, everyWeeks: 1, cap: null };

export const DAYS_RULE_LABEL: Record<DaysRule, string> = {
  training: "Training days",
  non_training: "Non-training days",
  weekdays: "Specific days",
  daily: "Every day",
  high: "High day",
};

export const TIMING_LABEL: Record<Timing, string> = {
  any: "Any time",
  after_lifting: "After lifting",
  before_lifting: "Before lifting",
  separate: "Separate from lifting (6+ h apart)",
};

export const TIMING_SHORT: Record<Timing, string> = {
  any: "any time",
  after_lifting: "after lifting",
  before_lifting: "before lifting",
  separate: "away from lifting",
};

export const PROGRESSION_LABEL: Record<ProgressionKind, string> = {
  none: "Hold steady",
  minutes: "Add minutes",
  incline: "Add incline",
  speed: "Add speed",
  sessions: "Add a session",
};

const SHORT_DAY: Record<CardioWeekday, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

let localKeySeed = 0;
export function newSessionKey(): string {
  localKeySeed += 1;
  return `new-${Date.now().toString(36)}-${localKeySeed}`;
}

/** Which weekdays a rule puts a session on, for this client. */
export function weekdaysFor(rule: DaysRule, picked: CardioWeekday[], ctx: PlanContext): CardioWeekday[] {
  const training = new Set(ctx.trainingDays);
  if (rule === "training") return CARDIO_WEEKDAYS.filter((d) => training.has(d));
  if (rule === "daily") return [...CARDIO_WEEKDAYS];
  if (rule === "high") return ctx.highDays.length ? [...ctx.highDays] : picked;
  if (rule === "non_training") {
    const off = picked.filter((d) => !training.has(d));
    return off.length ? CARDIO_WEEKDAYS.filter((d) => off.includes(d)) : CARDIO_WEEKDAYS.filter((d) => !training.has(d));
  }
  return CARDIO_WEEKDAYS.filter((d) => picked.includes(d));
}

/** "Mon, Wed, Fri" / "Every day" / "Training days (Mon, Tue, Thu, Fri)". */
export function daysWords(s: Pick<CardioSession, "days" | "weekdays">, ctx: PlanContext): string {
  const days = weekdaysFor(s.days, s.weekdays, ctx);
  if (days.length === 7) return "Every day";
  const list = days.map((d) => SHORT_DAY[d]).join(", ");
  if (s.days === "training") return days.length ? `Training days (${list})` : "Training days";
  if (s.days === "high") return days.length ? `High day (${list})` : "High day";
  return list || "No days picked";
}

/** A new session of a kind, at its starting values, on the days a rule picks. */
export function newSession(modality: Modality = DEFAULT_MODALITY, days: DaysRule = "non_training", ctx?: PlanContext): CardioSession {
  const spec = modalitySpec(modality);
  const d = spec.defaults;
  const weekdays = ctx ? weekdaysFor(days, [], ctx) : [];
  return {
    key: newSessionKey(),
    id: null,
    modality,
    name: null,
    days,
    weekdays,
    minutes: d.minutes,
    speedMinMph: d.speedMph,
    speedMaxMph: d.speedMph,
    incline: d.incline,
    inclineMax: d.inclineMax,
    hrZone: null,
    hrMin: null,
    hrMax: null,
    rpeMin: d.rpeMin,
    rpeMax: d.rpeMax,
    timing: days === "training" ? "after_lifting" : "any",
    progression: { ...NO_PROGRESSION },
    instructions: "",
    coachNote: "",
    enabled: true,
  };
}

/** Switching kinds keeps the time, days and effort; settings that don't apply are cleared, ones it needs get its defaults. */
export function withModality(s: CardioSession, modality: Modality): CardioSession {
  const spec = modalitySpec(modality);
  const has = (f: string) => (spec.fields as string[]).includes(f);
  return {
    ...s,
    modality,
    name: has("name") ? s.name : null,
    speedMinMph: has("speed") ? (s.speedMinMph ?? spec.defaults.speedMph) : null,
    speedMaxMph: has("speed") ? (s.speedMaxMph ?? s.speedMinMph ?? spec.defaults.speedMph) : null,
    incline: has("incline") ? (s.incline ?? spec.defaults.incline) : null,
    inclineMax: has("inclineMax") ? (s.inclineMax ?? spec.defaults.inclineMax) : null,
  };
}

/** One weight-management treadmill session (weight-management/treadmill.ts `TreadmillSession`, kept structural here). */
export type WeightStepSession = { minutes: number; speedMph: number; inclinePct: number; perWeek: number; weekdays: string[] };

/**
 * The weight-management engine's cardio step (after lifting on training days, and days off) as a change to a
 * Cardio tab plan, for its draft: the training-days session and the days-off session take the step's time
 * and days, and a treadmill session its speed and incline (another kind keeps its own settings); a session
 * the step adds is an incline walk, one it drops is taken off, and every other session (set weekdays, every
 * day, a sport) stays as it is. Never published from here: the coach reviews and publishes the draft.
 */
export function withWeightStep(base: CardioPlan, step: { trainingDay: WeightStepSession | null; restDay: WeightStepSession | null }, ctx: PlanContext): CardioPlan {
  let sessions = base.sessions.map((s) => ({ ...s, weekdays: [...s.weekdays] }));
  const place = (rule: "training" | "non_training", want: WeightStepSession | null) => {
    const i = sessions.findIndex((s) => s.enabled && s.days === rule);
    if (!want) {
      if (i >= 0) sessions = sessions.filter((_, j) => j !== i);
      return;
    }
    const picked = rule === "non_training" ? normalizeCardioWeekdays(want.weekdays) : [];
    const cur = i >= 0 ? sessions[i] : { ...newSession("treadmill_incline", rule, ctx), hrZone: "Zone 2" };
    const tread = modalitySpec(cur.modality).treadmill;
    const mph = round(want.speedMph, 2);
    const next: CardioSession = {
      ...cur,
      minutes: clamp(Math.round(want.minutes), 5, 180),
      weekdays: rule === "non_training" ? weekdaysFor("non_training", picked, ctx) : weekdaysFor("training", [], ctx),
      ...(tread
        ? {
            speedMinMph: mph,
            speedMaxMph: mph,
            incline: round(want.inclinePct, 1),
            inclineMax: cur.inclineMax != null && cur.inclineMax > want.inclinePct ? cur.inclineMax : cur.modality === "treadmill_variable" ? round(want.inclinePct + 2, 1) : null,
          }
        : {}),
    };
    if (i >= 0) sessions[i] = next;
    else sessions = [...sessions, next];
  };
  place("training", step.trainingDay);
  place("non_training", step.restDay);
  return { sessions };
}

function readProgression(v: unknown): Progression {
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = (["none", "minutes", "incline", "speed", "sessions"] as const).find((k) => k === p.kind) ?? "none";
  return {
    kind,
    step: Math.max(0, num(p.step) ?? 0),
    everyWeeks: clamp(Math.round(num(p.everyWeeks ?? p.every_weeks) ?? 1), 1, 8),
    cap: num(p.cap),
  };
}

function readRule(row: Record<string, any>, weekdays: CardioWeekday[]): DaysRule {
  const rule = String(row.day_rule ?? "");
  if (rule === "training" || rule === "non_training" || rule === "weekdays" || rule === "daily" || rule === "high") return rule;
  const dt = String(row.day_type ?? "").toLowerCase();
  if (/^\s*training( day)?\s*$/.test(dt)) return "training";
  if (/^\s*high( day)?\s*$/.test(dt)) return "high";
  if (/(non.?training|rest)/.test(dt)) return "non_training";
  if (weekdays.length === 7) return "daily";
  return "weekdays";
}

/** A cardio_targets row as a session (any row, old or new: missing fields read sensibly). */
export function sessionFromRow(row: Record<string, any>): CardioSession {
  const weekdays = normalizeCardioWeekdays(row.scheduled_weekdays);
  const modality = modalityOf(row);
  const spec = modalitySpec(modality);
  const has = (f: string) => (spec.fields as string[]).includes(f);
  const rpeFromIntensity = (() => {
    const m = String(row.intensity ?? "").match(/RPE\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?/i);
    if (m) return { min: Number(m[1]), max: Number(m[2] ?? m[1]) };
    const i = String(row.intensity ?? "").toLowerCase();
    if (/zone 2|easy|low/.test(i)) return { min: 3, max: 4 };
    if (/moderate/.test(i)) return { min: 5, max: 6 };
    if (/hard|high|hiit/.test(i)) return { min: 7, max: 8 };
    return { min: null, max: null };
  })();
  return {
    key: row.id ?? newSessionKey(),
    id: row.id ?? null,
    modality,
    name: has("name") ? (String(row.custom_type ?? "").trim() || null) : null,
    days: readRule(row, weekdays),
    weekdays,
    minutes: clamp(Math.round(num(row.duration_minutes) ?? spec.defaults.minutes), 1, 240),
    speedMinMph: has("speed") ? num(row.speed_min_mph) : null,
    speedMaxMph: has("speed") ? (num(row.speed_max_mph) ?? num(row.speed_min_mph)) : null,
    incline: has("incline") ? num(row.incline) : null,
    inclineMax: has("inclineMax") ? num(row.incline_max) : null,
    hrZone: String(row.heart_rate_zone ?? "").trim() || null,
    hrMin: num(row.hr_min),
    hrMax: num(row.hr_max),
    rpeMin: num(row.rpe_min) ?? rpeFromIntensity.min,
    rpeMax: num(row.rpe_max) ?? rpeFromIntensity.max,
    timing: (["any", "after_lifting", "before_lifting", "separate"] as const).find((t) => t === row.timing) ?? "any",
    progression: readProgression(row.progression),
    instructions: String(row.client_notes ?? ""),
    coachNote: String(row.admin_notes ?? ""),
    enabled: row.enabled !== false,
  };
}

/** A session read back from JSON (a draft, a version, Cleo's answer), cleaned: never trusted as typed. */
export function cleanSession(v: unknown, ctx?: PlanContext): CardioSession | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, any>;
  const modality: Modality = isModality(s.modality) ? s.modality : modalityOf({ cardio_type: s.cardio_type ?? s.modality, custom_type: s.name });
  const spec = modalitySpec(modality);
  const has = (f: string) => (spec.fields as string[]).includes(f);
  const days: DaysRule = (["training", "non_training", "weekdays", "daily", "high"] as const).find((d) => d === s.days) ?? "weekdays";
  let weekdays = normalizeCardioWeekdays(s.weekdays);
  if (ctx) weekdays = weekdaysFor(days, weekdays, ctx);
  const minutes = num(s.minutes);
  if (minutes == null || minutes <= 0) return null;
  const speedLo = has("speed") ? num(s.speedMinMph) : null;
  const speedHi = has("speed") ? (num(s.speedMaxMph) ?? speedLo) : null;
  const rpeLo = num(s.rpeMin);
  const rpeHi = num(s.rpeMax) ?? rpeLo;
  const hrLo = num(s.hrMin);
  const hrHi = num(s.hrMax) ?? hrLo;
  return {
    key: typeof s.key === "string" && s.key ? s.key.slice(0, 80) : typeof s.id === "string" ? s.id : newSessionKey(),
    id: typeof s.id === "string" && /^[0-9a-f-]{36}$/i.test(s.id) ? s.id : null,
    modality,
    name: has("name") ? (String(s.name ?? "").trim().slice(0, 60) || null) : null,
    days,
    weekdays,
    minutes: clamp(Math.round(minutes), 1, 240),
    speedMinMph: speedLo != null ? round(clamp(speedLo, 0.5, 15), 2) : null,
    speedMaxMph: speedHi != null ? round(clamp(Math.max(speedHi, speedLo ?? speedHi), 0.5, 15), 2) : null,
    incline: has("incline") && num(s.incline) != null ? round(clamp(num(s.incline)!, 0, 15), 1) : null,
    inclineMax: has("inclineMax") && num(s.inclineMax) != null ? round(clamp(num(s.inclineMax)!, 0, 15), 1) : null,
    hrZone: String(s.hrZone ?? "").trim().slice(0, 40) || null,
    hrMin: hrLo != null ? Math.round(clamp(hrLo, 60, 210)) : null,
    hrMax: hrHi != null ? Math.round(clamp(Math.max(hrHi, hrLo ?? hrHi), 60, 210)) : null,
    rpeMin: rpeLo != null ? round(clamp(rpeLo, 1, 10), 1) : null,
    rpeMax: rpeHi != null ? round(clamp(Math.max(rpeHi, rpeLo ?? rpeHi), 1, 10), 1) : null,
    timing: (["any", "after_lifting", "before_lifting", "separate"] as const).find((t) => t === s.timing) ?? "any",
    progression: readProgression(s.progression),
    instructions: String(s.instructions ?? "").slice(0, 600),
    coachNote: String(s.coachNote ?? "").slice(0, 600),
    enabled: s.enabled !== false,
  };
}

export function cleanPlan(v: unknown, ctx?: PlanContext): CardioPlan {
  const list = Array.isArray(v) ? v : Array.isArray((v as any)?.sessions) ? (v as any).sessions : [];
  const sessions = list.map((s: unknown) => cleanSession(s, ctx)).filter((s: CardioSession | null): s is CardioSession => !!s).slice(0, 14);
  // keys stay unique (a duplicated session from an older draft never shares one)
  const seen = new Set<string>();
  for (const s of sessions) {
    if (seen.has(s.key)) s.key = newSessionKey();
    seen.add(s.key);
  }
  return { sessions };
}

/** "RPE 4–5" / "Zone 2" / "120–140 bpm": how hard, in one short phrase. */
export function effortWords(s: Pick<CardioSession, "rpeMin" | "rpeMax" | "hrZone" | "hrMin" | "hrMax">): string | null {
  const parts: string[] = [];
  if (s.rpeMin != null || s.rpeMax != null) {
    const lo = s.rpeMin ?? s.rpeMax!;
    const hi = s.rpeMax ?? lo;
    parts.push(lo === hi ? `RPE ${lo}` : `RPE ${lo}–${hi}`);
  }
  if (s.hrMin != null) parts.push(s.hrMax != null && s.hrMax !== s.hrMin ? `${s.hrMin}–${s.hrMax} bpm` : `${s.hrMin} bpm`);
  else if (s.hrZone) parts.push(s.hrZone);
  return parts.length ? parts.join(" · ") : null;
}

/** A speed (mph stored) in the coach's unit, one decimal. */
export function speedText(mph: number | null, unit: SpeedUnit): string | null {
  if (mph == null) return null;
  const v = unit === "kmh" ? mphToKmh(mph) : mph;
  return v.toFixed(1);
}

/** A typed speed in the coach's unit, as mph for storage (rounded to what a treadmill shows). */
export function speedInputToMph(typed: string, unit: SpeedUnit): number | null {
  const v = num(String(typed).replace(",", "."));
  if (v == null || v <= 0) return null;
  return unit === "kmh" ? round(kmhToMph(round(v, 1)), 3) : round(v, 1);
}

/** The machine settings in one line: "3.0 mph · 6% incline", "6–10% incline". */
export function settingsWords(s: CardioSession, unit: SpeedUnit): string | null {
  const parts: string[] = [];
  const u = unit === "kmh" ? "km/h" : "mph";
  if (s.speedMinMph != null) {
    const lo = speedText(s.speedMinMph, unit);
    const hi = speedText(s.speedMaxMph, unit);
    parts.push(hi && hi !== lo ? `${lo}–${hi} ${u}` : `${lo} ${u}`);
  }
  if (s.incline != null && s.inclineMax != null && s.inclineMax > s.incline) parts.push(`${s.incline}–${s.inclineMax}% incline`);
  else if (s.incline != null && s.incline > 0) parts.push(`${s.incline}% incline`);
  else if (s.incline === 0 && modalitySpec(s.modality).treadmill) parts.push("flat");
  return parts.length ? parts.join(" · ") : null;
}

export function sessionTitle(s: Pick<CardioSession, "modality" | "name">): string {
  const spec = modalitySpec(s.modality);
  return (spec.fields as string[]).includes("name") && s.name ? s.name : spec.label;
}

/** One line a client understands: "Incline treadmill walk · 25 min · 3.0 mph · 6% incline · RPE 4–5". */
export function sessionLine(s: CardioSession, unit: SpeedUnit): string {
  return [sessionTitle(s), `${s.minutes} min`, settingsWords(s, unit), effortWords(s)].filter(Boolean).join(" · ");
}

export function progressionWords(p: Progression, unit: SpeedUnit): string | null {
  if (p.kind === "none" || !(p.step > 0)) return null;
  const every = p.everyWeeks > 1 ? `every ${p.everyWeeks} weeks` : "each week";
  const cap = p.cap != null ? ` up to ${p.kind === "speed" ? speedText(p.cap, unit) + (unit === "kmh" ? " km/h" : " mph") : p.kind === "incline" ? `${p.cap}%` : p.kind === "minutes" ? `${p.cap} min` : `${p.cap} sessions`}` : "";
  const step =
    p.kind === "minutes" ? `+${p.step} min` : p.kind === "incline" ? `+${p.step}% incline` : p.kind === "speed" ? `+${speedText(p.step, unit)} ${unit === "kmh" ? "km/h" : "mph"}` : `+${p.step} session${p.step === 1 ? "" : "s"}`;
  return `${step} ${every}${cap}`;
}

/* ------------------------------------------------------------------ */
/* The week                                                            */

export type WeekDay = { day: CardioWeekday; short: string; training: boolean; sessions: Array<{ key: string; title: string; minutes: number; timing: Timing }>; minutes: number };

/** The plan laid out Monday to Sunday for this client (enabled sessions only). */
export function weekSchedule(plan: CardioPlan, ctx: PlanContext): WeekDay[] {
  const training = new Set(ctx.trainingDays);
  return CARDIO_WEEKDAYS.map((day) => {
    const sessions = plan.sessions
      .filter((s) => s.enabled && weekdaysFor(s.days, s.weekdays, ctx).includes(day))
      .map((s) => ({ key: s.key, title: modalitySpec(s.modality).short, minutes: s.minutes, timing: s.timing }));
    return { day, short: SHORT_DAY[day], training: training.has(day), sessions, minutes: sessions.reduce((a, b) => a + b.minutes, 0) };
  });
}

export type PlanTotals = {
  sessions: number;
  minutes: number;
  days: number;
  /** Minutes at RPE 6+ (or a heart rate range that reads as hard), a week. */
  hardMinutes: number;
  /** Average target effort, weighted by minutes (sessions without one left out). */
  avgRpe: number | null;
  /** Net kcal a week from the sessions, when a bodyweight is known (an estimate). */
  estKcal: number | null;
  longest: number;
};

export function planTotals(plan: CardioPlan, ctx: PlanContext, kg: number | null = null): PlanTotals {
  let sessions = 0;
  let minutes = 0;
  let hard = 0;
  let rpeWeighted = 0;
  let rpeMinutes = 0;
  let kcal = 0;
  let kcalKnown = kg != null && kg > 0;
  let longest = 0;
  const days = new Set<string>();
  for (const s of plan.sessions) {
    if (!s.enabled) continue;
    const on = weekdaysFor(s.days, s.weekdays, ctx);
    const n = on.length;
    if (!n) continue;
    on.forEach((d) => days.add(d));
    sessions += n;
    minutes += n * s.minutes;
    longest = Math.max(longest, s.minutes);
    const rpe = s.rpeMax ?? s.rpeMin;
    if (rpe != null) {
      const mid = ((s.rpeMin ?? rpe) + rpe) / 2;
      rpeWeighted += mid * n * s.minutes;
      rpeMinutes += n * s.minutes;
      if (mid >= 6) hard += n * s.minutes;
    }
    const k = netKcalPerMin({ modality: s.modality, speedMph: s.speedMinMph, incline: s.incline, inclineMax: s.inclineMax }, kg);
    if (k == null) kcalKnown = false;
    else kcal += k * n * s.minutes;
  }
  return {
    sessions,
    minutes,
    days: days.size,
    hardMinutes: Math.round(hard),
    avgRpe: rpeMinutes ? round(rpeWeighted / rpeMinutes, 1) : null,
    estKcal: kcalKnown && sessions ? Math.round(kcal / 10) * 10 : null,
    longest,
  };
}

/* ------------------------------------------------------------------ */
/* Checks before publishing                                            */

export type SessionProblem = { key: string; level: "error" | "warn"; text: string };

/** What's wrong with a session as written (errors block publishing; warnings are said). */
export function planProblems(plan: CardioPlan, ctx: PlanContext): SessionProblem[] {
  const out: SessionProblem[] = [];
  for (const s of plan.sessions) {
    const title = sessionTitle(s);
    const on = weekdaysFor(s.days, s.weekdays, ctx);
    if (s.enabled && !on.length) {
      out.push({
        key: s.key,
        level: "error",
        text: s.days === "training" ? `${title}: their training days aren't set yet` : s.days === "high" ? `${title}: they have no high day set` : `${title}: pick at least one day`,
      });
    }
    const spec = modalitySpec(s.modality);
    if ((spec.fields as string[]).includes("name") && !s.name) out.push({ key: s.key, level: "error", text: `${spec.label}: give it a name the client will recognise` });
    if (s.minutes < 5) out.push({ key: s.key, level: "warn", text: `${title}: under 5 minutes` });
    if (s.minutes > 90) out.push({ key: s.key, level: "warn", text: `${title}: ${s.minutes} minutes is a long session` });
    if (spec.walking && s.speedMinMph != null && (s.speedMinMph < 1.5 || s.speedMinMph > 4.6)) out.push({ key: s.key, level: "warn", text: `${title}: ${s.speedMinMph} mph is outside a walking pace` });
    if (s.incline != null && s.incline > 12) out.push({ key: s.key, level: "warn", text: `${title}: ${s.incline}% incline is very steep` });
    if (s.inclineMax != null && s.incline != null && s.inclineMax < s.incline) out.push({ key: s.key, level: "error", text: `${title}: the top incline is lower than the start` });
    if (s.rpeMin == null && s.rpeMax == null && s.hrMin == null && !s.hrZone) out.push({ key: s.key, level: "warn", text: `${title}: no effort target (RPE or heart rate)` });
    if (s.days === "training" && s.timing === "before_lifting" && (s.rpeMax ?? 0) >= 6) out.push({ key: s.key, level: "warn", text: `${title}: hard cardio before lifting can blunt the session` });
    if (s.progression.kind !== "none" && s.progression.cap == null) out.push({ key: s.key, level: "warn", text: `${title}: progression has no ceiling` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* What changed                                                        */

/** The prescription a client sees (the coach's note left out). */
function prescriptionKey(s: CardioSession, ctx: PlanContext): string {
  return JSON.stringify([
    s.modality,
    s.name,
    s.days,
    weekdaysFor(s.days, s.weekdays, ctx),
    s.minutes,
    s.speedMinMph,
    s.speedMaxMph,
    s.incline,
    s.inclineMax,
    s.hrZone,
    s.hrMin,
    s.hrMax,
    s.rpeMin,
    s.rpeMax,
    s.timing,
    s.progression,
    s.instructions.trim(),
    s.enabled,
  ]);
}

export function sessionsEqual(a: CardioSession, b: CardioSession, ctx: PlanContext): boolean {
  return prescriptionKey(a, ctx) === prescriptionKey(b, ctx);
}

export type SessionChange =
  | { kind: "added"; key: string; after: CardioSession; lines: string[] }
  | { kind: "removed"; key: string; before: CardioSession; lines: string[] }
  | { kind: "changed"; key: string; before: CardioSession; after: CardioSession; lines: string[] }
  | { kind: "note"; key: string; before: CardioSession; after: CardioSession; lines: string[] };

/** Before and after, session by session, in words (a session is matched by its key or row id). */
export function diffPlans(before: CardioPlan, after: CardioPlan, ctx: PlanContext, unit: SpeedUnit): SessionChange[] {
  const out: SessionChange[] = [];
  const match = (s: CardioSession, list: CardioSession[]) => list.find((x) => x.key === s.key || (s.id && x.id === s.id));
  for (const a of after.sessions) {
    const b = match(a, before.sessions);
    if (!b) {
      out.push({ kind: "added", key: a.key, after: a, lines: [`Added ${sessionLine(a, unit)} · ${daysWords(a, ctx)}`] });
      continue;
    }
    if (sessionsEqual(a, b, ctx)) {
      if (a.coachNote.trim() !== b.coachNote.trim()) out.push({ kind: "note", key: a.key, before: b, after: a, lines: [`${sessionTitle(a)}: private note changed`] });
      continue;
    }
    const lines: string[] = [];
    const t = sessionTitle(a);
    if (a.modality !== b.modality || a.name !== b.name) lines.push(`${sessionTitle(b)} → ${t}`);
    const bd = daysWords(b, ctx);
    const ad = daysWords(a, ctx);
    if (bd !== ad) lines.push(`${t}: ${bd} → ${ad}`);
    if (a.minutes !== b.minutes) lines.push(`${t}: ${b.minutes} → ${a.minutes} min`);
    const bs = settingsWords(b, unit);
    const as = settingsWords(a, unit);
    if (bs !== as) lines.push(`${t}: ${bs ?? "no settings"} → ${as ?? "no settings"}`);
    const be = effortWords(b);
    const ae = effortWords(a);
    if (be !== ae) lines.push(`${t}: ${be ?? "no effort target"} → ${ae ?? "no effort target"}`);
    if (a.timing !== b.timing) lines.push(`${t}: ${TIMING_SHORT[b.timing]} → ${TIMING_SHORT[a.timing]}`);
    if (JSON.stringify(a.progression) !== JSON.stringify(b.progression)) lines.push(`${t}: progression ${progressionWords(b.progression, unit) ?? "none"} → ${progressionWords(a.progression, unit) ?? "none"}`);
    if (a.instructions.trim() !== b.instructions.trim()) lines.push(`${t}: instructions changed`);
    if (a.enabled !== b.enabled) lines.push(`${t}: ${a.enabled ? "switched back on" : "paused"}`);
    out.push({ kind: "changed", key: a.key, before: b, after: a, lines: lines.length ? lines : [`${t} changed`] });
  }
  for (const b of before.sessions) {
    if (!match(b, after.sessions)) out.push({ kind: "removed", key: b.key, before: b, lines: [`Removed ${sessionTitle(b)} (${daysWords(b, ctx)})`] });
  }
  return out;
}

/**
 * A proposal with only the picked changes on the base plan (Cleo's per-change approval): a picked
 * added or changed session is taken as proposed, a picked removal is dropped, and everything not
 * picked stays exactly as it was on the base. Keys are diffPlans' (the proposed session's key, a
 * removed session's own key).
 */
export function pickChanges(base: CardioPlan, proposed: CardioPlan, keys: ReadonlySet<string>): CardioPlan {
  const same = (a: CardioSession, b: CardioSession) => a.key === b.key || (!!a.id && a.id === b.id);
  const out: CardioSession[] = [];
  for (const p of proposed.sessions) {
    const b = base.sessions.find((x) => same(p, x));
    if (keys.has(p.key)) out.push(p);
    else if (b) out.push(b);
  }
  for (const b of base.sessions) {
    if (proposed.sessions.some((p) => same(p, b))) continue;
    if (!keys.has(b.key)) out.push(b);
  }
  return { sessions: out };
}

/** A change the client would notice (a private note alone isn't one). */
export function isMeaningful(changes: SessionChange[]): boolean {
  return changes.some((c) => c.kind !== "note");
}

/** The weekly minutes before → after, for the summary line. */
export function minutesChange(before: CardioPlan, after: CardioPlan, ctx: PlanContext): { before: number; after: number } {
  return { before: planTotals(before, ctx).minutes, after: planTotals(after, ctx).minutes };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */

const DAY_TYPE: Record<DaysRule, string> = {
  training: "Training Day",
  non_training: "Non-Training Day",
  weekdays: "General",
  daily: "General",
  high: "High Day",
};

/** The cardio_targets fields a session writes (dates, status and source are the publisher's). */
export function rowFields(s: CardioSession, ctx: PlanContext, unit: SpeedUnit) {
  const spec = modalitySpec(s.modality);
  const weekdays = weekdaysFor(s.days, s.weekdays, ctx);
  const effort = effortWords(s);
  return {
    modality: s.modality,
    cardio_type: spec.storage,
    custom_type: s.name,
    machine_preference: spec.treadmill ? "Treadmill" : null,
    day_type: DAY_TYPE[s.days],
    day_rule: s.days,
    custom_day_type: null,
    scheduled_weekdays: weekdays,
    frequency_per_week: weekdays.length,
    duration_minutes: s.minutes,
    speed_min_mph: s.speedMinMph,
    speed_max_mph: s.speedMaxMph ?? s.speedMinMph,
    speed_unit: unit,
    incline: s.incline,
    incline_max: s.inclineMax,
    heart_rate_zone: s.hrMin != null ? (s.hrMax != null && s.hrMax !== s.hrMin ? `${s.hrMin}–${s.hrMax} bpm` : `${s.hrMin} bpm`) : s.hrZone,
    hr_min: s.hrMin,
    hr_max: s.hrMax,
    rpe_min: s.rpeMin,
    rpe_max: s.rpeMax,
    intensity: effort ? effort.split(" · ")[0] : null,
    timing: s.timing,
    progression: s.progression,
    client_notes: s.instructions.trim() || null,
    admin_notes: s.coachNote.trim() || null,
    enabled: s.enabled,
    completion_rule: "any_target",
  };
}
