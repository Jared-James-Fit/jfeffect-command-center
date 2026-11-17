/**
 * The program editor's Sheet view (desktop): every exercise of a week as a row
 * of plain cells, read and written exactly like the card editor writes them
 * (the same row fields, the same load basis rules), so the two views are one
 * program. Pure: what a cell shows, what typing into it does to the row, and
 * the spreadsheet parts (paste from Google Sheets, copy out, fill a progression).
 */
import { defaultRestSeconds } from "@/lib/exercise-metadata";

export type SheetField = "sets" | "reps" | "rpe" | "rir" | "load" | "tempo" | "rest" | "notes";

export type SheetColumn = { key: SheetField; label: string; hint: string; width: string; numeric?: boolean };

/** The columns, in order. Exercise and the row number sit in front of them. */
export const SHEET_COLUMNS: SheetColumn[] = [
  { key: "sets", label: "Sets", hint: "1–20", width: "w-14", numeric: true },
  { key: "reps", label: "Reps / time", hint: "5, 8-10, AMRAP · time rows: 45s, 1:30", width: "w-24" },
  { key: "rpe", label: "RPE", hint: "7, 7-8", width: "w-16", numeric: true },
  { key: "rir", label: "RIR", hint: "2, 1-2", width: "w-14", numeric: true },
  { key: "load", label: "Load", hint: "75% TM · 80% 1RM · 85% e1RM · 92.5% top · 100 kg · 225 lb · blank = none", width: "w-40" },
  { key: "tempo", label: "Tempo", hint: "3-1-1-0", width: "w-20" },
  { key: "rest", label: "Rest", hint: "90, 1:30, 3m", width: "w-16" },
  { key: "notes", label: "Notes", hint: "What the athlete reads under the exercise", width: "min-w-[12rem]" },
];

export const SHEET_FIELDS: SheetField[] = SHEET_COLUMNS.map((c) => c.key);

const BASIS_WORD: Record<string, string> = {
  training_max: "TM",
  "1rm": "1RM",
  est_1rm: "e1RM",
  top_set: "top",
  prev_set: "prev",
  prev_week: "last week",
};

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function isTimeRow(row: any): boolean {
  return row?.measurement_type === "time" || row?.tracking_type === "time";
}

/** m:ss, or plain seconds under a minute ("45s"). */
export function formatSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(Number(sec)) || Number(sec) <= 0) return "";
  const s = Math.round(Number(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    return `${h}:${String(mm).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Seconds from what a coach types: "90" (seconds), "1:30", "1:00:00", "45s",
 * "2m", "3 min", "2.5 min". Null when it isn't a time.
 */
export function parseSeconds(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const clock = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] != null ? Number(clock[3]) : null];
    return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
  }
  const unit = t.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)$/);
  if (unit) {
    const n = Number(unit[1]);
    const u = unit[2];
    if (u.startsWith("h")) return Math.round(n * 3600);
    if (u.startsWith("m")) return Math.round(n * 60);
    return Math.round(n);
  }
  if (/^\d+(?:\.\d+)?$/.test(t)) return Math.round(Number(t));
  return null;
}

/** Load as the coach reads it: "75% TM", "92.5% top", "100 kg", or "" for none. */
export function formatLoad(row: any): string {
  const basis = row?.percentage_basis ?? null;
  const pct = row?.percentage != null && row.percentage !== "" ? Number(row.percentage) : null;
  if (basis && BASIS_WORD[basis] && pct != null && Number.isFinite(pct)) return `${trimNum(pct)}% ${BASIS_WORD[basis]}`;
  if (basis === "none") return "";
  const unit = row?.load_unit === "lb" ? "lb" : "kg";
  const v = unit === "lb" ? row?.load_lb : row?.load_kg;
  const other = unit === "lb" ? row?.load_kg : row?.load_lb;
  const n = v != null && v !== "" ? Number(v) : other != null && other !== "" ? Number(other) : null;
  if (n != null && Number.isFinite(n) && n > 0) {
    const u = v != null && v !== "" ? unit : unit === "lb" ? "kg" : "lb";
    return `${trimNum(n)} ${u}`;
  }
  return "";
}

/**
 * What typing a load does to the row, in the card editor's own terms:
 * blank = no suggested load, "75%" keeps the row's % basis (a training max
 * when it had none), "80% 1RM" / "85% e1RM" / "92.5% top" pick the basis,
 * "100 kg" / "225 lb" / "100" (the row's unit) is a set weight.
 */
export function parseLoad(text: string, row: any): { patch: Record<string, any> } | { error: string } {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return { patch: { percentage_basis: "none", percentage: null, load_kg: null, load_lb: null, manual_override: false } };
  const pct = t.match(/^(\d+(?:\.\d+)?)\s*%\s*(of\s*)?(tm|training max|1rm|1 rm|max|e1rm|est|estimated|top|top set|prev|prev set|previous|previous set|last week|prev week|previous week)?$/);
  if (pct) {
    const n = Number(pct[1]);
    if (!(n > 0 && n <= 150)) return { error: "A percentage between 1 and 150" };
    const word = pct[3] ?? null;
    const keep = row?.percentage_basis && BASIS_WORD[row.percentage_basis] ? row.percentage_basis : "training_max";
    const basis =
      word == null ? keep
      : word.startsWith("tm") || word === "training max" ? "training_max"
      : word === "1rm" || word === "1 rm" || word === "max" ? "1rm"
      : word.startsWith("e") || word.startsWith("est") ? "est_1rm"
      : word.includes("week") ? "prev_week"
      : word.startsWith("prev") ? "prev_set"
      : "top_set";
    return { patch: { percentage_basis: basis, percentage: n, load_kg: null, load_lb: null, manual_override: false } };
  }
  const w = t.match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs)?$/);
  if (w) {
    const n = Number(w[1]);
    if (!(n > 0 && n < 1500)) return { error: "A weight over 0" };
    const unit = w[2] ? (w[2].startsWith("kg") ? "kg" : "lb") : row?.load_unit === "lb" ? "lb" : "kg";
    return {
      patch: {
        percentage_basis: "manual",
        percentage: null,
        load_unit: unit,
        load_kg: unit === "kg" ? n : null,
        load_lb: unit === "lb" ? n : null,
        manual_override: false,
      },
    };
  }
  return { error: "Try 75% TM, 80% 1RM, 92.5% top, 100 kg or 225 lb" };
}

function effortText(text: string, max: number): string | { error: string } {
  const t = text.trim().replace(/^@\s*/, "").replace(/\s+/g, "");
  if (!t) return "";
  const m = t.match(/^(\d+(?:\.\d+)?)(?:[-–](\d+(?:\.\d+)?))?$/);
  if (!m) return { error: `A number like 7 or a range like 7-8` };
  const a = Number(m[1]);
  const b = m[2] != null ? Number(m[2]) : null;
  if (a < 0 || a > max || (b != null && (b < 0 || b > max || b < a))) return { error: `Between 0 and ${max}` };
  return b != null ? `${trimNum(a)}-${trimNum(b)}` : trimNum(a);
}

/** What a cell shows. */
export function formatCell(row: any, field: SheetField): string {
  if (!row) return "";
  switch (field) {
    case "sets":
      return row.sets != null && row.sets !== "" ? String(row.sets) : "";
    case "reps":
      return isTimeRow(row) ? formatSeconds(row.duration_seconds) : String(row.reps_text ?? "");
    case "rpe":
      return row.rpe != null ? String(row.rpe) : "";
    case "rir":
      return row.rir != null ? String(row.rir) : "";
    case "load":
      return formatLoad(row);
    case "tempo":
      return String(row.tempo ?? "");
    case "rest": {
      const s = row.rest_seconds_override ?? row.rest_seconds;
      return formatSeconds(s);
    }
    case "notes":
      return String(row.notes ?? "");
  }
}

/**
 * Typing into a cell: the row's fields that change, or why the text doesn't
 * read (the cell keeps the coach's text and says so, never guesses).
 */
export function applyCell(row: any, field: SheetField, text: string): { patch: Record<string, any> } | { error: string } {
  const t = text.trim();
  switch (field) {
    case "sets": {
      if (!t) return { patch: { sets: null } };
      if (!/^\d+$/.test(t)) return { error: "Whole sets, 1–20" };
      const n = Number(t);
      if (n < 1 || n > 20) return { error: "Whole sets, 1–20" };
      return { patch: { sets: n } };
    }
    case "reps": {
      if (isTimeRow(row)) {
        if (!t) return { patch: { duration_seconds: null } };
        const s = parseSeconds(t);
        if (s == null || s <= 0 || s > 6 * 3600) return { error: "A time like 45s, 1:30 or 20 min" };
        return { patch: { duration_seconds: s } };
      }
      return { patch: { reps_text: t || null } };
    }
    case "rpe": {
      const r = effortText(t, 10);
      return typeof r === "string" ? { patch: { rpe: r || null } } : r;
    }
    case "rir": {
      const r = effortText(t, 10);
      return typeof r === "string" ? { patch: { rir: r || null } } : r;
    }
    case "load":
      if (isTimeRow(row) && t) return { error: "A time row has no load" };
      return parseLoad(t, row);
    case "tempo":
      return { patch: { tempo: t || null } };
    case "rest": {
      if (!t) return { patch: { rest_seconds: null, rest_seconds_override: null } };
      const s = parseSeconds(t);
      if (s == null || s < 0 || s > 1800) return { error: "Rest like 90, 1:30 or 3m (30 min at most)" };
      return { patch: { rest_seconds: s, rest_seconds_override: s } };
    }
    case "notes":
      return { patch: { notes: t || null } };
  }
}

/** A grid of text from a paste: Google Sheets / Excel give tab-separated rows. */
export function parseTsv(text: string): string[][] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return clean.split("\n").map((line) => line.split("\t"));
}

/** True when a paste is more than one cell (tabs or several lines). */
export function isMultiCellPaste(text: string): boolean {
  const g = parseTsv(text);
  return g.length > 1 || (g[0]?.length ?? 0) > 1;
}

/** Cells back out as text Google Sheets reads as a grid. */
export function toTsv(grid: string[][]): string {
  return grid.map((r) => r.map((c) => c.replace(/[\t\n]/g, " ")).join("\t")).join("\n");
}

/**
 * A progression across cells: start, then add `step` each one (decimals kept
 * to two places, never a float tail). Effort is capped at 10 and sets at 20.
 */
export function progression(start: number, step: number, count: number, field: SheetField): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let v = Math.round((start + step * i) * 100) / 100;
    if (field === "rpe" || field === "rir") v = Math.min(10, Math.max(0, v));
    if (field === "sets") v = Math.min(20, Math.max(1, Math.round(v)));
    out.push(trimNum(v));
  }
  return out;
}

/** The number a cell's text starts from for a progression ("75% TM" → 75, "7-8" → 7). */
export function leadingNumber(text: string): number | null {
  const m = text.trim().match(/^@?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Write a progression value into a cell, keeping what the cell was about:
 * a load stays a % of the same basis (or the same unit), anything else is the number.
 */
export function progressionText(row: any, field: SheetField, value: string): string {
  if (field !== "load") return value;
  const cur = formatCell(row, "load");
  const word = cur.match(/%\s*(.+)$/);
  if (word) return `${value}% ${word[1]}`;
  const unit = cur.match(/\s(kg|lb)$/);
  if (unit) return `${value} ${unit[1]}`;
  return `${value}%`;
}

/** A new row for a library exercise, set up like the card editor's Add. */
export function newRowForExercise(ex: any): Record<string, any> {
  const time = ex?.default_measurement_type === "time";
  return {
    sort_order: 0,
    time_profile: "accessory_compound",
    percentage_basis: "none",
    exercise_id: ex?.id ?? null,
    exercise_name_override: ex?.name ?? null,
    rest_seconds: defaultRestSeconds(ex as any),
    tracking_type: time ? "time" : "reps_weight",
    measurement_type: time ? "time" : "reps",
    ...(time && ex?.duration_seconds ? { duration_seconds: ex.duration_seconds } : {}),
  };
}

// ── Across weeks ───────────────────────────────────────────────────────────

/** One exercise slot (its day and place in the day) followed week to week. */
export type WeekSlot = { key: string; dayIndex: number; dayLabel: string; pos: number; name: string };

function dayOf(week: any, dayIndex: number): any | null {
  return (week?.days ?? []).find((d: any) => Number(d?.day_index) === dayIndex) ?? null;
}

/**
 * The slots of a block: every (day, place) any week has, named after the
 * exercise there in the first week that has one, in day then place order.
 */
export function weekSlots(weeksData: any[], nameOf: (row: any) => string): WeekSlot[] {
  const byKey = new Map<string, WeekSlot>();
  for (const w of weeksData ?? []) {
    for (const d of w?.days ?? []) {
      const di = Number(d?.day_index ?? 0);
      (d?.rows ?? []).forEach((r: any, pos: number) => {
        const key = `${di}:${pos}`;
        if (byKey.has(key)) return;
        const title = String(d?.subtitle || d?.title || "").trim();
        byKey.set(key, { key, dayIndex: di, dayLabel: title ? `Day ${di} · ${title}` : `Day ${di}`, pos, name: nameOf(r) });
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.dayIndex - b.dayIndex || a.pos - b.pos);
}

/** The row in a week at a slot, if that week has one there. */
export function rowAtSlot(week: any, slot: { dayIndex: number; pos: number }): any | null {
  return dayOf(week, slot.dayIndex)?.rows?.[slot.pos] ?? null;
}

/** A copy of the weeks with one row (by week and slot) patched. */
export function patchSlot(weeksData: any[], weekIdx: number, slot: { dayIndex: number; pos: number }, patch: Record<string, any>): any[] {
  return weeksData.map((w, wi) => {
    if (wi !== weekIdx) return w;
    return {
      ...w,
      days: (w.days ?? []).map((d: any) => {
        if (Number(d?.day_index) !== slot.dayIndex) return d;
        return {
          ...d,
          rows: (d.rows ?? []).map((r: any, i: number) => (i === slot.pos ? { ...r, ...patch } : r)),
        };
      }),
    };
  });
}
