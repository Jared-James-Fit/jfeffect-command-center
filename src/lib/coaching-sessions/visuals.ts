/**
 * The shared screen's pictures (Nov 25 2026): what each slide shows beside its
 * words, from the athlete's own records only (their workouts, their weigh-ins,
 * their all-time records, the meet's date). Never Cleo's read, never a coach
 * note, never a number that isn't on file: a picture with nothing behind it
 * isn't drawn. Pure, so the slide that gets each picture is decided the same
 * way every time (tested in coaching-sessions-visuals.test.ts).
 */
import type { SectionKey } from "./prepare";

export type VisualWeek = { start: string; planned: number; done: number };

export type PresentationVisuals = {
  unit: "kg" | "lb";
  /** the last 4 weeks of planned workouts, oldest first */
  training: { weeks: VisualWeek[]; planned: number; done: number } | null;
  /** weigh-ins in the athlete's unit, oldest first, and the class limit when the meet has one */
  bodyweight: { points: Array<{ date: string; value: number }>; limit: number | null; classLabel: string | null } | null;
  /** all-time records in the last 4 weeks, in the athlete's unit */
  records: Array<{ exercise: string; load: number; reps: number; date: string }>;
  /** the meet or goal date, when it's ahead */
  countdown: { daysOut: number; date: string | null; title: string } | null;
};

export type VisualKind = "countdown" | "records" | "training" | "bodyweight";

export const EMPTY_VISUALS: PresentationVisuals = { unit: "lb", training: null, bodyweight: null, records: [], countdown: null };

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * Workouts by week, the 4 weeks ending today (the same 28 days the prep reads):
 * planned = every required workout dated up to today, done = those finished.
 * Optional sessions never count as planned.
 */
export function weekBuckets(
  workouts: Array<{ date: string; done: boolean; optional: boolean }>,
  today: string,
): { weeks: VisualWeek[]; planned: number; done: number } | null {
  const t = dayNum(today);
  const first = t - 27;
  const weeks: VisualWeek[] = [0, 1, 2, 3].map((k) => ({ start: isoOf(first + k * 7), planned: 0, done: 0 }));
  for (const w of workouts) {
    if (w.optional) continue;
    const d = dayNum(w.date);
    if (d < first || d > t) continue;
    const k = Math.min(3, Math.floor((d - first) / 7));
    weeks[k]!.planned += 1;
    if (w.done) weeks[k]!.done += 1;
  }
  const planned = weeks.reduce((a, w) => a + w.planned, 0);
  const done = weeks.reduce((a, w) => a + w.done, 0);
  return planned > 0 ? { weeks, planned, done } : null;
}

/** "63" → 63, "84+" / "120+" → null (no upper limit), anything else → null. */
export function classLimit(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = String(label).trim();
  if (s.includes("+") || /\bshw\b|super/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 250 ? n : null;
}

/**
 * Which picture each slide shows (slide 0 is the title; slide i+1 is section
 * i). One picture per slide at most, and each picture once: the countdown on
 * the title, the records on Recognize, the training weeks on Evaluate when
 * workouts went unlogged (else on Recognize when they didn't), the weigh-ins
 * on Evaluate when there's a class to make, else on Coach or Execute when
 * there are enough of them to read.
 */
export function slideVisuals(sections: Array<{ key: SectionKey }>, v: PresentationVisuals): Record<number, VisualKind> {
  const out: Record<number, VisualKind> = {};
  const used = new Set<VisualKind>();
  const give = (slide: number, kind: VisualKind, ok: boolean) => {
    if (!ok || used.has(kind) || out[slide]) return;
    out[slide] = kind;
    used.add(kind);
  };
  const hasCountdown = !!v.countdown && v.countdown.daysOut >= 0 && v.countdown.daysOut <= 120;
  const training = v.training;
  const consistent = !!training && training.done / training.planned >= 0.9;
  const bw = !!v.bodyweight && v.bodyweight.points.length >= 3;

  give(0, "countdown", hasCountdown);
  sections.forEach((s, i) => {
    const slide = i + 1;
    if (s.key === "recognize") {
      give(slide, "records", v.records.length > 0);
      give(slide, "training", !!training && consistent);
    }
    if (s.key === "evaluate") {
      give(slide, "training", !!training && !consistent);
      give(slide, "bodyweight", bw && !!v.bodyweight?.limit);
    }
    if (s.key === "coach" || s.key === "execute") {
      give(slide, "bodyweight", bw);
    }
  });
  return out;
}
