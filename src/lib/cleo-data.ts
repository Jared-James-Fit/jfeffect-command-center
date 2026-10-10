/**
 * Pure helpers behind Cleo's lookups (cleo-tools.server.ts): matching an
 * exercise name the way people say it, writing a logged set the way a coach
 * reads it, grouping sets into sessions, and merging body weight sources.
 * No I/O, so the same rules hold in tests.
 */

const LB_PER_KG = 2.2046226218;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * "high bar squat" matches "High-Bar Back Squat"; "highbar" matches too.
 * Every word asked for has to be in the name.
 */
export function matchesExercise(name: string | null | undefined, query: string | null | undefined): boolean {
  if (!query?.trim()) return true;
  const n = norm(name ?? "");
  const q = norm(query);
  if (!n || !q) return false;
  if (n.replace(/ /g, "").includes(q.replace(/ /g, ""))) return true;
  return q.split(" ").every((w) => n.includes(w));
}

export type LoggedSet = {
  completed_at: string;
  exercise: string;
  day_title: string | null;
  set_index: number | null;
  entered_value: number | null;
  entered_unit: string | null;
  normalized_kg: number | null;
  normalized_lb: number | null;
  reps: number | null;
  rpe: string | number | null;
  rir: string | null;
  is_working_set: boolean | null;
  load_type: string | null;
  is_bodyweight: boolean | null;
  notes: string | null;
};

function round(n: number, step = 0.5): number {
  const decimals = step < 1 ? (String(step).split(".")[1]?.length ?? 1) : 0;
  return Number((Math.round(n / step) * step).toFixed(decimals));
}

/** The load as the client typed it, or in `unit` when only the normalised value exists. */
export function formatLoad(s: Pick<LoggedSet, "entered_value" | "entered_unit" | "normalized_kg" | "normalized_lb" | "load_type" | "is_bodyweight">, unit: "kg" | "lb" = "lb"): string {
  let value: number | null = null;
  let u: string = unit;
  if (s.entered_value != null && s.entered_unit) {
    value = Number(s.entered_value);
    u = s.entered_unit;
  } else if (unit === "kg" && s.normalized_kg != null) value = Number(s.normalized_kg);
  else if (unit === "lb" && s.normalized_lb != null) value = Number(s.normalized_lb);
  else if (s.normalized_kg != null) value = unit === "lb" ? Number(s.normalized_kg) * LB_PER_KG : Number(s.normalized_kg);
  const shown = value != null && Number.isFinite(value) ? `${round(value, 0.5)} ${u}` : null;
  if (s.load_type === "assisted") return shown ? `assisted ${shown}` : "assisted";
  if (s.load_type === "bodyweight" || s.is_bodyweight) return shown && value ? `BW + ${shown}` : "BW";
  return shown ?? "no load";
}

export function formatSet(s: LoggedSet, unit: "kg" | "lb" = "lb"): string {
  const effort = s.rpe != null && `${s.rpe}`.trim() ? ` @RPE ${s.rpe}` : s.rir ? ` @${s.rir} RIR` : "";
  const reps = s.reps != null ? ` x ${s.reps}` : "";
  const warm = s.is_working_set === false ? " (warm-up)" : "";
  const note = s.notes?.trim() ? ` "${s.notes.trim().slice(0, 80)}"` : "";
  return `${formatLoad(s, unit)}${reps}${effort}${warm}${note}`;
}

/** Calendar day of an instant in `tz` (YYYY-MM-DD). */
export function dayIn(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return iso.slice(0, 10);
  }
}

export type Session = { date: string; title: string | null; exercises: Array<{ name: string; sets: LoggedSet[] }> };

/** Sets grouped by training day (newest first), then by exercise in the order they were done. */
export function groupSessions(sets: LoggedSet[], tz: string): Session[] {
  const byDay = new Map<string, Session>();
  const sorted = [...sets].sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  for (const s of sorted) {
    const date = dayIn(s.completed_at, tz);
    let session = byDay.get(date);
    if (!session) {
      session = { date, title: s.day_title, exercises: [] };
      byDay.set(date, session);
    }
    if (!session.title && s.day_title) session.title = s.day_title;
    let ex = session.exercises.find((e) => e.name === s.exercise);
    if (!ex) {
      ex = { name: s.exercise, sets: [] };
      session.exercises.push(ex);
    }
    ex.sets.push(s);
  }
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Epley estimate; only from 1 to 12 reps, where it means something. */
export function estimate1rm(loadKg: number | null, reps: number | null): number | null {
  if (loadKg == null || reps == null || reps < 1 || reps > 12 || loadKg <= 0) return null;
  return reps === 1 ? loadKg : loadKg * (1 + reps / 30);
}

export function formatSessions(sessions: Session[], unit: "kg" | "lb" = "lb"): string {
  const lines: string[] = [];
  for (const s of sessions) {
    lines.push(`${s.date}${s.title ? ` | ${s.title}` : ""}`);
    for (const ex of s.exercises) {
      const working = ex.sets.filter((x) => x.is_working_set !== false);
      const top = working
        .map((x) => ({ x, e1: estimate1rm(x.normalized_kg, x.reps) }))
        .filter((t) => t.e1 != null)
        .sort((a, b) => (b.e1 ?? 0) - (a.e1 ?? 0))[0];
      const e1 = top?.e1 != null ? ` (top set e1RM ~${round(unit === "kg" ? top.e1 : top.e1 * LB_PER_KG, 1)} ${unit})` : "";
      lines.push(`  ${ex.name}${e1}`);
      for (const set of ex.sets) lines.push(`    ${set.set_index != null ? `set ${set.set_index + 1}: ` : ""}${formatSet(set, unit)}`);
    }
  }
  return lines.join("\n");
}

export type BodyweightEntry = { date: string; value: number; unit: "kg" | "lb"; source: string; note: string | null };

function toUnit(v: number, from: "kg" | "lb", to: "kg" | "lb"): number {
  if (from === to) return v;
  return to === "lb" ? v * LB_PER_KG : v / LB_PER_KG;
}

/** One entry per day, newest first. Earlier sources in the list win a tie (the portal log over coach-entered metrics). */
export function mergeBodyweight(...sources: BodyweightEntry[][]): BodyweightEntry[] {
  const byDate = new Map<string, BodyweightEntry>();
  for (const list of sources) for (const e of list) if (!byDate.has(e.date) && Number.isFinite(e.value) && e.value > 0) byDate.set(e.date, e);
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Latest weigh-in plus the change in weekly average (last 7 days vs the 7 before), in the latest entry's unit. */
export function bodyweightSummary(entries: BodyweightEntry[], today: string): string {
  if (!entries.length) return "No body weight logged.";
  const latest = entries[0];
  const unit = latest.unit;
  const dayMs = 86_400_000;
  const t = Date.parse(`${today}T00:00:00Z`);
  const avg = (fromDays: number, toDays: number) => {
    const xs = entries.filter((e) => {
      const d = (t - Date.parse(`${e.date}T00:00:00Z`)) / dayMs;
      return d >= fromDays && d < toDays;
    });
    return xs.length ? xs.reduce((s, e) => s + toUnit(e.value, e.unit, unit), 0) / xs.length : null;
  };
  const thisWeek = avg(0, 7);
  const lastWeek = avg(7, 14);
  const parts = [`Latest: ${round(latest.value, 0.1)} ${latest.unit} on ${latest.date} (${latest.source}).`];
  if (thisWeek != null) parts.push(`7-day average ${round(thisWeek, 0.1)} ${unit}.`);
  if (thisWeek != null && lastWeek != null) {
    const d = round(thisWeek - lastWeek, 0.1);
    parts.push(`Change vs the week before: ${d > 0 ? "+" : ""}${d} ${unit}.`);
  }
  return parts.join(" ");
}
