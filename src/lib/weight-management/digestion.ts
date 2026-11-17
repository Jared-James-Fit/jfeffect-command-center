/**
 * Digestion from the weekly check-in, without making the check-in longer for
 * anyone who's fine: the follow-up questions only show when they tap
 * "Digestion / bloating" (messenger-checkin-card.tsx). Read over weeks, it
 * names patterns ("bloating after meals, 3 of the last 4 weeks, started the
 * week the plan changed") as things worth checking, never as causes, and
 * suggests practical changes (how meals are spread, fibre and food volume,
 * what's eaten before training, fizzy drinks and sugar alcohols) without ever
 * cutting a whole food group. A gut that's bloated or backed up also reads
 * heavy on the scale (and on a waist tape), which the decision engine weighs
 * before touching calories. Anything persistent or severe goes to a doctor.
 * Pure, tested.
 */
import { addDays, daysBetween } from "@/lib/weight-management/units";

export const DIGESTION_FLAG = "Digestion / bloating";
export const DIGESTION_SYMPTOMS = ["Bloating", "Constipation", "Loose stools", "Reflux / heartburn", "Gas", "Stomach pain"] as const;
export const DIGESTION_TIMINGS = ["After meals", "Evenings", "Training days", "Mornings", "All day"] as const;

export type CheckinAnswers = Record<string, unknown>;
export type CheckinRow = { date: string; answers: CheckinAnswers | null };

export type WeeklyGut = {
  date: string;
  flagged: boolean;
  symptoms: string[];
  timing: string | null;
  /** 1 (barely) – 5 (severe), when asked. */
  severity: number | null;
};

export type DigestionRead = {
  /** Check-ins read (most recent first, up to 6). */
  weeks: WeeklyGut[];
  flagged: number;
  of: number;
  /** Weeks flagged in a row, ending with the latest. */
  streak: number;
  latest: WeeklyGut | null;
  symptoms: Array<{ symptom: string; weeks: number }>;
  timing: string | null;
  severityTrend: "better" | "worse" | "same" | null;
  /** First flagged within 2 weeks of a new nutrition plan. */
  afterPlanChange: string | null;
  /** The latest week: bloating or constipation, which can read 0.5–1.5 kg heavy on the scale. */
  scaleEffect: boolean;
  medical: string | null;
  suggestions: string[];
  summary: string | null;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

export function weeklyGut(row: CheckinRow): WeeklyGut {
  const a = row.answers ?? {};
  const flags = arr(a.recovery_flags);
  const symptoms = arr(a.digestion_symptoms).filter((s) => (DIGESTION_SYMPTOMS as readonly string[]).includes(s));
  const flagged = flags.includes(DIGESTION_FLAG) || symptoms.length > 0;
  const sev = num(a.digestion_severity);
  return {
    date: row.date.slice(0, 10),
    flagged,
    symptoms,
    timing: typeof a.digestion_timing === "string" && a.digestion_timing ? a.digestion_timing : null,
    severity: sev != null && sev >= 1 && sev <= 5 ? sev : null,
  };
}

const SUGGEST: Record<string, string[]> = {
  Bloating: [
    "Spread vegetables and high-fibre foods across the day instead of one big serving",
    "Check fizzy drinks, sugar-free gum and protein bars (sugar alcohols) and big salads at one meal",
    "Eat a little slower and keep meal sizes even across the day",
  ],
  Constipation: [
    "Raise fibre slowly (about 5 g a week, not all at once), with water at target",
    "Keep daily steps up and meals at regular times",
  ],
  "Loose stools": [
    "Check sugar alcohols, a lot of caffeine, very fatty meals and anything new (a supplement, creatine loading, magnesium)",
    "If dairy seems to line up with it, try lactose-free milk or a whey isolate for 2 weeks rather than cutting dairy out",
  ],
  "Reflux / heartburn": ["Finish the last big meal 2–3 hours before bed and keep that one lower in fat", "Watch coffee on an empty stomach"],
  Gas: ["Spread beans, onions and cruciferous vegetables across meals and raise them gradually"],
  "Stomach pain": ["Note what was eaten before it and when, so the coach can look for a pattern"],
};

/** Read the last 6 weekly check-ins (any order), with the start dates of their nutrition plans. */
export function readDigestion(rows: CheckinRow[], planStarts: string[] = []): DigestionRead {
  const weeks = rows
    .filter((r) => r.date)
    .map(weeklyGut)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  const latest = weeks[0] ?? null;
  const flaggedWeeks = weeks.filter((w) => w.flagged);
  let streak = 0;
  for (const w of weeks) {
    if (!w.flagged) break;
    streak++;
  }
  const counts = new Map<string, number>();
  for (const w of flaggedWeeks) for (const s of w.symptoms) counts.set(s, (counts.get(s) ?? 0) + 1);
  const symptoms = [...counts.entries()].map(([symptom, n]) => ({ symptom, weeks: n })).sort((a, b) => b.weeks - a.weeks);
  const timingCounts = new Map<string, number>();
  for (const w of flaggedWeeks) if (w.timing) timingCounts.set(w.timing, (timingCounts.get(w.timing) ?? 0) + 1);
  const timing = [...timingCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const sevs = flaggedWeeks.filter((w) => w.severity != null);
  const severityTrend =
    sevs.length >= 2 ? (sevs[0].severity! < sevs[sevs.length - 1].severity! ? "better" : sevs[0].severity! > sevs[sevs.length - 1].severity! ? "worse" : "same") : null;

  // first flagged week of the current run, against the plans
  const runStart = streak ? weeks[streak - 1].date : null;
  const afterPlanChange = runStart ? (planStarts.find((p) => p <= runStart && daysBetween(p, runStart) <= 14) ?? null) : null;

  const severe = weeks.slice(0, 2).every((w) => w.flagged && (w.severity ?? 0) >= 4) && weeks.length >= 2;
  const painful = flaggedWeeks.filter((w) => w.symptoms.includes("Stomach pain")).length >= 2;
  const loose = flaggedWeeks.filter((w) => w.symptoms.includes("Loose stools")).length >= 3;
  const medical =
    severe
      ? "Severe two weeks running: worth a doctor's look before changing food."
      : painful
        ? "Stomach pain more than once: worth a doctor's look."
        : loose
          ? "Loose stools most weeks: worth a doctor's look."
          : streak >= 4
            ? "Flagged 4 weeks in a row: if it isn't easing, a doctor or a registered dietitian should look at it."
            : null;

  const suggestions: string[] = [];
  if (timing === "Training days") suggestions.push("Keep the pre-workout meal lower in fibre and fat, 60–120 min before training, with vegetables in the other meals");
  for (const s of symptoms) for (const line of SUGGEST[s.symptom] ?? []) if (!suggestions.includes(line)) suggestions.push(line);
  if (afterPlanChange) suggestions.unshift(`It started within 2 weeks of the plan that began ${afterPlanChange}: the newest foods or a bigger food volume are the first thing to look at`);

  const scaleEffect = !!latest?.flagged && latest.symptoms.some((s) => s === "Bloating" || s === "Constipation");
  const summary = flaggedWeeks.length
    ? `${symptoms.length ? symptoms.map((s) => s.symptom.toLowerCase()).slice(0, 2).join(" and ") : "digestion"} flagged ${flaggedWeeks.length} of the last ${weeks.length} check-ins${timing ? `, mostly ${timing.toLowerCase()}` : ""}${severityTrend ? ` (${severityTrend === "same" ? "no better" : severityTrend})` : ""}`
    : null;

  return {
    weeks,
    flagged: flaggedWeeks.length,
    of: weeks.length,
    streak,
    latest,
    symptoms,
    timing,
    severityTrend,
    afterPlanChange,
    scaleEffect,
    medical,
    suggestions: suggestions.slice(0, 5),
    summary: summary ? summary[0].toUpperCase() + summary.slice(1) : null,
  };
}

/** Check-ins in the window, oldest first, newest within `days` of today. */
export function recentCheckins(rows: CheckinRow[], today: string, days = 42): CheckinRow[] {
  const from = addDays(today, -days);
  return rows.filter((r) => r.date && r.date.slice(0, 10) >= from && r.date.slice(0, 10) <= today);
}
