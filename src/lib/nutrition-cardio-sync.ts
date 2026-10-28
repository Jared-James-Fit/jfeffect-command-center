/**
 * Cardio and daily steps move with the nutrition plan. The AI writes, per
 * day type, the day's total steps and its cardio session ("25 min incline
 * walk · ~150 kcal" or "none"); the coach reviews both next to the day's
 * calories and meals, and publishing the plan writes the steps onto the
 * nutrition day and syncs each day type's cardio_targets row (updated in
 * place, or created). Pure.
 *
 * cardio_targets.step_target is the steps for the cardio SESSION and stays
 * automatic; the day's total steps live on nutrition_target_days.steps.
 */
import { INCLINE_TREADMILL_DEFAULT, defaultCardioConfigFor, scheduledWeekdaysForDayType } from "@/lib/cardio-prescription";

/** "Non-Training Day", "NON TRAINING DAY", "Rest Day" → one key ("rest" and "non-training" are the same day). */
export function dayKey(label: string | null | undefined): string {
  const k = String(label ?? "").toLowerCase().replace(/menu/g, "").replace(/[^a-z]/g, "");
  if (k === "restday" || k === "nontraining" || k === "offday" || k === "nontrainingday") return "nontrainingday";
  if (k === "training") return "trainingday";
  if (k === "high") return "highday";
  return k;
}

export type AiCardioDay = {
  label: string;
  /** Total steps for the day. */
  steps: number | null;
  /** Cardio session minutes / kcal; `none` = no cardio that day. */
  minutes: number | null;
  kcal: number | null;
  none: boolean;
};

const firstNum = (s: string) => {
  const m = s.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0])) : null;
};

/**
 * The AI's steps + cardio per day type. Reads the new sections (DAILY STEPS
 * TARGETS / CARDIO SESSIONS) and the older ones (CARDIO STEPS TARGETS /
 * CARDIO CALORIE TARGETS, where "0 kcal" meant steps only).
 */
export function parseAiCardio(targetsText: string | null | undefined): Map<string, AiCardioDay> {
  const out = new Map<string, AiCardioDay>();
  let section: "steps" | "sessions" | "kcal" | null = null;
  const day = (label: string) => {
    const k = dayKey(label);
    let d = out.get(k);
    if (!d) {
      d = { label: label.trim(), steps: null, minutes: null, kcal: null, none: false };
      out.set(k, d);
    }
    return d;
  };
  for (const raw of String(targetsText ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(daily\s+)?(cardio\s+)?steps?\s+targets?\s*:?$/i.test(line) || /^cardio steps targets/i.test(line)) { section = "steps"; continue; }
    if (/^cardio\s+sessions?\s*:?$/i.test(line)) { section = "sessions"; continue; }
    if (/^cardio\s+calorie\s+targets?\s*:?$/i.test(line)) { section = "kcal"; continue; }
    if (/^[A-Z][A-Z\s/&-]+:?$/.test(line) && !/day/i.test(line)) { section = null; continue; }
    const m = line.match(/^([A-Za-z][A-Za-z\s-]*day)\s*:\s*(.*)$/i);
    if (!section || !m) continue;
    const value = m[2].trim();
    const d = day(m[1]);
    if (section === "steps") d.steps = firstNum(value);
    else if (section === "sessions") {
      if (!value || /^(none|no cardio|rest|off|-|0)\b/i.test(value)) {
        d.none = true;
        d.minutes = null;
        d.kcal = null;
      } else {
        const min = value.match(/(\d+)(?:\s*[-–]\s*\d+)?\s*(?:min|mins|minutes)\b/i);
        const cal = value.replace(/,/g, "").match(/(\d+)(?:\s*[-–]\s*\d+)?\s*(?:kcal|cal|calories)\b/i);
        d.minutes = min ? Number(min[1]) : null;
        d.kcal = cal ? Number(cal[1]) : null;
        d.none = false;
      }
    } else if (section === "kcal" && !out.get(dayKey(m[1]))?.minutes) {
      const n = firstNum(value);
      d.kcal = n && n > 0 ? n : null;
      // Old format: 0 kcal ("steps only") means no cardio session.
      if (n === 0) d.none = true;
    }
  }
  return out;
}

/** What the coach edits per day type. */
export type CardioDraft = {
  /** Plan cardio on this day type. */
  enabled: boolean;
  cardio_type: string;
  duration_minutes: number | null;
  frequency_per_week: number | null;
  /** Cardio session calories; null = automatic from minutes. */
  kcal: number | null;
  /** The cardio_targets row it updates (null = a new one is created). */
  rowId: string | null;
  /** A multi-week cardio program covers this day: it's left alone. */
  program: string | null;
  /** The AI changed it (for the review highlight). */
  fromAi: boolean;
};

type CardioRow = {
  id: string;
  day_type: string | null;
  status?: string | null;
  enabled?: boolean | null;
  program_name?: string | null;
  cardio_type?: string | null;
  duration_minutes?: number | null;
  frequency_per_week?: number | null;
  calorie_target_min?: number | null;
  calorie_target_mode?: string | null;
  updated_at?: string | null;
};

const live = (rows: CardioRow[]) => rows.filter((r) => String(r.status ?? "Active") !== "Archived");

/** Default sessions per week for a day type, from how many such days the week has. */
export function defaultFrequency(label: string, trainingDays: number): number {
  const k = dayKey(label);
  if (k === "highday") return 1;
  if (k === "trainingday") return Math.max(1, Math.min(6, trainingDays || 3));
  if (k === "nontrainingday") return Math.max(1, 7 - (trainingDays || 3) - 1);
  return 3;
}

/**
 * One draft per nutrition day: the client's current cardio for that day type
 * (a standalone row, not a multi-week program), with the AI's minutes / kcal /
 * "none" on top when there is an AI plan.
 */
export function cardioDraftsFor(input: {
  labels: string[];
  rows: CardioRow[];
  ai?: Map<string, AiCardioDay> | null;
  trainingDays?: number;
}): Record<string, CardioDraft> {
  const rows = live(input.rows);
  const out: Record<string, CardioDraft> = {};
  for (const label of input.labels) {
    const k = dayKey(label);
    const program = rows.find((r) => r.program_name && dayKey(r.day_type) === k)?.program_name ?? null;
    const row = rows
      .filter((r) => !r.program_name && dayKey(r.day_type) === k)
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
    const base: CardioDraft = {
      enabled: !!row && row.enabled !== false,
      cardio_type: row?.cardio_type || INCLINE_TREADMILL_DEFAULT.cardio_type,
      duration_minutes: row?.duration_minutes ?? defaultCardioConfigFor(label).duration_minutes,
      frequency_per_week: row?.frequency_per_week ?? defaultFrequency(label, input.trainingDays ?? 0),
      kcal: row?.calorie_target_mode === "custom" ? row.calorie_target_min ?? null : null,
      rowId: row?.id ?? null,
      program,
      fromAi: false,
    };
    const a = input.ai?.get(k);
    if (a && !program && (a.none || a.minutes != null || a.kcal != null)) {
      base.fromAi = true;
      if (a.none) base.enabled = false;
      else {
        base.enabled = true;
        if (a.minutes != null) base.duration_minutes = a.minutes;
        if (a.kcal != null) base.kcal = a.kcal;
      }
    }
    out[label] = base;
  }
  return out;
}

/**
 * The writes that make cardio match the published plan: each day's row is
 * updated in place (only what changed; a "Rest Day" row matched to
 * "Non-Training Day" takes the plan's name so it stays linked) or created.
 * Days covered by a cardio program are left alone, and a day with cardio off
 * and no row writes nothing.
 */
export function planCardioSync(input: {
  clientId: string;
  days: Array<{ label: string; draft: CardioDraft | undefined }>;
  rows: CardioRow[];
  today: string;
  trainingDays?: unknown;
  highDay?: string | null;
}): { updates: Array<{ id: string; patch: Record<string, unknown> }>; inserts: Array<Record<string, unknown>> } {
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  for (const { label, draft } of input.days) {
    if (!draft || draft.program) continue;
    const kcal = draft.kcal && draft.kcal > 0 ? Math.round(draft.kcal) : null;
    const wanted: Record<string, unknown> = {
      day_type: label,
      enabled: draft.enabled,
      duration_minutes: draft.duration_minutes,
      frequency_per_week: draft.frequency_per_week,
      calorie_target_mode: kcal ? "custom" : "auto",
      calorie_target_min: kcal,
      calorie_target_max: kcal,
      show_calories_to_client: !!kcal,
    };
    const row = draft.rowId ? byId.get(draft.rowId) : undefined;
    if (row) {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(wanted)) {
        const cur = (row as any)[k];
        if (k === "enabled" ? (cur !== false) !== v : (cur ?? null) !== (v ?? null)) patch[k] = v;
      }
      // An unchanged calorie target (automatic, or the same custom low end of
      // a range like 150–200) is left exactly as the coach set it.
      const sameKcal = row.calorie_target_mode === "custom" ? kcal != null && kcal === (row.calorie_target_min ?? null) : !kcal;
      if (sameKcal) {
        delete patch.calorie_target_min;
        delete patch.calorie_target_max;
        delete patch.calorie_target_mode;
        delete patch.show_calories_to_client;
      }
      if (Object.keys(patch).length) updates.push({ id: row.id, patch: { ...patch, last_updated_at: new Date().toISOString() } });
      continue;
    }
    if (!draft.enabled) continue;
    const cfg = defaultCardioConfigFor(label);
    inserts.push({
      client_id: input.clientId,
      day_type: label,
      custom_day_type: null,
      cardio_type: draft.cardio_type || cfg.cardio_type,
      custom_type: null,
      intensity: cfg.intensity,
      frequency_per_week: draft.frequency_per_week,
      duration_minutes: draft.duration_minutes ?? cfg.duration_minutes,
      scheduled_weekdays: scheduledWeekdaysForDayType({
        dayType: label,
        trainingDays: input.trainingDays,
        highDay: input.highDay ?? null,
        fullRestDay: null,
      }),
      calorie_target_mode: kcal ? "custom" : "auto",
      calorie_target_min: kcal,
      calorie_target_max: kcal,
      show_calories_to_client: !!kcal,
      step_target_mode: "auto",
      step_target: null,
      incline: INCLINE_TREADMILL_DEFAULT.incline,
      speed_min_mph: INCLINE_TREADMILL_DEFAULT.speed_min_mph,
      speed_max_mph: INCLINE_TREADMILL_DEFAULT.speed_max_mph,
      completion_rule: INCLINE_TREADMILL_DEFAULT.completion_rule,
      client_notes: cfg.client_notes,
      start_date: input.today,
      status: "Active",
      enabled: true,
      visible_to_client: true,
    });
  }
  return { updates, inserts };
}

/** The client's cardio now, for the AI ("CURRENT CARDIO"). Empty when there is none. */
export function currentCardioText(rows: CardioRow[]): string {
  const list = live(rows).filter((r) => r.enabled !== false);
  if (!list.length) return "";
  const lines = list.map((r) => {
    const kcal = r.calorie_target_mode === "custom" && r.calorie_target_min ? ` · ~${r.calorie_target_min} kcal` : "";
    const per = r.frequency_per_week ? ` · ${r.frequency_per_week}x/week` : "";
    return `- ${r.day_type ?? "Any day"}: ${r.duration_minutes ?? "?"} min ${String(r.cardio_type ?? "cardio").toLowerCase()}${per}${kcal}${r.program_name ? ` (program: ${r.program_name})` : ""}`;
  });
  return `CURRENT CARDIO\n${lines.join("\n")}`;
}

/** One-line summary of a day's steps + cardio, for previews and copy. */
export function cardioLine(steps: number | null | undefined, d: CardioDraft | undefined): string {
  const s = steps ? `${steps.toLocaleString("en-US")} steps` : null;
  const c = !d
    ? null
    : d.program
      ? `cardio: ${d.program} program`
      : d.enabled
        ? `${d.duration_minutes ?? "?"} min ${d.cardio_type.toLowerCase()}${d.kcal ? ` · ~${d.kcal} kcal` : ""}${d.frequency_per_week ? ` · ${d.frequency_per_week}x/wk` : ""}`
        : "no cardio";
  return [s, c].filter(Boolean).join(" · ");
}
