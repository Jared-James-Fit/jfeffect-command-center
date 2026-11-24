/**
 * Checking what a model copied out of a roster or a training post (pure,
 * tested): it only ever copies. A competitor's name that isn't in the source
 * is dropped; a training lift whose load or reps aren't written in the source
 * is dropped; nothing is saved until the coach confirms the rows. When the
 * source is a picture there's no text to check against, so every row comes
 * back marked low confidence for the coach to read against the picture.
 */
import { LB_PER_KG } from "./rules";
import type { Lift, Observation } from "./types";

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type RosterRow = {
  name: string;
  weightClass: string | null;
  federation: string | null;
  country: string | null;
  sex: "M" | "F" | null;
};

export function cleanRoster(raw: unknown, source: string | null): RosterRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.lifters)
      ? (raw as any).lifters
      : [];
  const src = source ? norm(source) : null;
  const seen = new Set<string>();
  const out: RosterRow[] = [];
  for (const r of rows) {
    const name = String(r?.name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (name.length < 3) continue;
    if (src && !src.includes(norm(name))) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const cls =
      String(r?.weight_class ?? r?.weightClass ?? "")
        .trim()
        .slice(0, 20) || null;
    out.push({
      name,
      weightClass: cls && (!src || src.includes(norm(cls))) ? cls : null,
      federation:
        String(r?.federation ?? "")
          .trim()
          .slice(0, 80) || null,
      country:
        String(r?.country ?? "")
          .trim()
          .slice(0, 60) || null,
      sex: r?.sex === "M" || r?.sex === "F" ? r.sex : null,
    });
    if (out.length >= 80) break;
  }
  return out;
}

const numbersOf = (s: string) =>
  new Set([...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", "."))));

export function cleanTraining(raw: unknown, source: string | null, today: string): Observation[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.lifts)
      ? (raw as any).lifts
      : [];
  const nums = source ? numbersOf(source) : null;
  const out: Observation[] = [];
  for (const r of rows) {
    const unit = String(r?.unit ?? "kg")
      .toLowerCase()
      .startsWith("lb")
      ? "lb"
      : "kg";
    const load = Number(r?.load);
    const reps = Math.round(Number(r?.reps));
    if (!(load > 0) || !(reps >= 1 && reps <= 30)) continue;
    // reps written as a word ("a single", "a double", "triple") count as written
    const repsWritten =
      !source ||
      nums!.has(reps) ||
      (reps === 1 && /\b(single|1rm|max out|maxed)\b/i.test(source)) ||
      (reps === 2 && /\bdouble\b/i.test(source)) ||
      (reps === 3 && /\btriple\b/i.test(source));
    if (nums && (!nums.has(load) || !repsWritten)) continue;
    const loadKg = Math.round((unit === "lb" ? load / LB_PER_KG : load) * 10) / 10;
    const lift: Lift | null = ["squat", "bench", "deadlift"].includes(r?.lift) ? r.lift : null;
    const standard = ["competition", "variation", "unclear"].includes(r?.standard)
      ? r.standard
      : "unclear";
    const date =
      /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date ?? "")) && String(r.date) <= today
        ? String(r.date)
        : today;
    const rpe = Number(r?.rpe);
    out.push({
      date,
      lift,
      exercise: String(r?.exercise ?? lift ?? "Lift").slice(0, 80),
      loadKg,
      reps,
      rpe: rpe >= 5 && rpe <= 10 && (!nums || nums.has(rpe)) ? rpe : null,
      standard,
      equipment:
        String(r?.equipment ?? "")
          .trim()
          .slice(0, 60) || null,
      source: source ? "caption" : "screenshot",
      url: null,
      confidence: source ? (standard === "competition" ? "medium" : "low") : "low",
      note:
        String(r?.note ?? "")
          .trim()
          .slice(0, 200) || null,
    });
    if (out.length >= 30) break;
  }
  return out;
}

export const ROSTER_SYSTEM = `You copy lifters out of a powerlifting meet roster, nominations list or start list. Copy, never guess: only names that are written there. Answer ONLY with JSON {"lifters":[{"name":"Full Name","weight_class":"83","federation":null,"country":null,"sex":"M"|"F"|null}]}.`;

export const TRAINING_SYSTEM = `You copy training lifts out of a powerlifter's post caption or screenshot. Copy, never guess: a lift only when its load and reps are written. Mark "standard": "competition" only for the competition lift done to competition standard (paused bench, no straps, raw, full depth); a variation (pause squat, block pull, touch-and-go bench, strapped pull, belted when they compete raw is fine) is "variation"; unsure is "unclear". Answer ONLY with JSON {"lifts":[{"date":"YYYY-MM-DD"|null,"lift":"squat"|"bench"|"deadlift"|null,"exercise":"as written","load":200,"unit":"kg"|"lb","reps":1,"rpe":null,"standard":"competition"|"variation"|"unclear","equipment":null,"note":null}]}.`;
