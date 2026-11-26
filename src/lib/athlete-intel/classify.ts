/**
 * Reading powerlifting words (pure, tested): which competition lift an
 * exercise is and whether it's done to competition standard, a load or a set
 * written in shorthand ("180x3@8", "3x5 @ 150kg", "2x2 @ 92.5%"), a date
 * written the ways coaches write them, and what a file is for. Never a guess:
 * what isn't recognised says so (`unclear`, null).
 */
import type { Lift, Purpose, Standard, Unit } from "./types";

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%.+]+/g, " ")
    .trim();

/** Words that make an exercise a variation that doesn't compare with the competition lift. */
const SQUAT_VARIATION =
  /\b(pause[ds]?|paused|\d\s*(ct|count|sec)|tempo|pin|box|front|safety|ssb|cambered|belt squat|goblet|split|bulgarian|hack|leg press|zercher|anderson|bottoms? up|hatfield|banded|chains?|1 and a? ?1\/?4|quarter|half|partial|smith|db|dumbbell|kb|kettlebell|overhead|beltless|wide stance|narrow)\b/;
const BENCH_VARIATION =
  /\b(incline|decline|close grip|close grip|cg|cgbp|spoto|larsen|pin|board|floor|db|dumbbell|feet up|touch and go|tng|t ?n ?g|wide grip|[2-9]\s*(ct|count|sec)|long pause|banded|chains?|smith|machine|swiss bar|football bar|slingshot|reverse grip|dead bench|bottoms? up|partial|half)\b/;
const DEAD_VARIATION =
  /\b(rdl|romanian|stiff|sldl|deficit|block|blocks|rack pull|pin pull|paused|pause|\d\s*(ct|count|sec)|snatch grip|trap bar|hex|halting|banded|chains?|good morning|single leg|db|dumbbell|kb|kettlebell|jefferson|suitcase|clean|snatch|strapped|straps|beltless|tempo|elevated|below the knee|above the knee)\b/;

/** The competition lift an exercise belongs to, and whether it's the competition lift itself. */
export function classifyExercise(raw: string): { lift: Lift | null; standard: Standard } {
  const s = ` ${norm(raw)} `;
  if (!s.trim()) return { lift: null, standard: "unclear" };
  // bench variations named without the word bench (before "press" reads as another movement)
  if (/\b(larsen|spoto|floor press|board press|pin press|jm press|close grip press)\b/.test(s)) return { lift: "bench", standard: "variation" };
  // other movements that share a word with a lift
  if (/\b(pull ?ups?|chin ?ups?|lat pull|pulldown|leg curl|leg extension|hip thrust|glute|row|press(?!.*bench)|ohp|overhead press|shoulder press|military)\b/.test(s) && !/\bbench\b/.test(s))
    return { lift: null, standard: "unclear" };
  const comp = /\b(comp|competition|meet|platform)\b/.test(s);
  if (/\b(squat|sq|squats|low ?bar|lb squat|back squat)\b/.test(s)) {
    if (SQUAT_VARIATION.test(s)) return { lift: "squat", standard: "variation" };
    if (/\bhigh ?bar\b/.test(s) && !comp) return { lift: "squat", standard: "unclear" };
    return { lift: "squat", standard: "competition" };
  }
  if (/\b(bench|bp|bench press)\b/.test(s)) {
    if (BENCH_VARIATION.test(s)) return { lift: "bench", standard: "variation" };
    // a plain "bench press" may be touch-and-go: paused / comp / 1 count say it's to standard
    if (comp || /\b(paused?|1\s*(ct|count)|competition style)\b/.test(s)) return { lift: "bench", standard: "competition" };
    return { lift: "bench", standard: "competition" };
  }
  if ((/\b(dead ?lifts?|dl|dls|deads?|sumo|conventional|conv)\b/.test(s) && !/\b(romanian|rdl|stiff)\b/.test(s)) || /\bcomp (pull|dead)\b/.test(s)) {
    if (DEAD_VARIATION.test(s)) return { lift: "deadlift", standard: "variation" };
    return { lift: "deadlift", standard: "competition" };
  }
  if (/\b(rdl|romanian|stiff)\b/.test(s)) return { lift: "deadlift", standard: "variation" };
  return { lift: null, standard: "unclear" };
}

/** A unit word ("kg", "kgs", "lb", "lbs", "pounds", "kilos"). */
export function unitOf(raw: string | null | undefined): Unit | null {
  const s = String(raw ?? "").toLowerCase();
  if (/\b(kgs?|kilo(gram)?s?)\b/.test(s) || /\dkg\b/.test(s)) return "kg";
  if (/\b(lbs?|pounds?|#)\b/.test(s) || /\dlbs?\b/.test(s)) return "lb";
  return null;
}

export type ParsedSet = {
  sets: number;
  reps: number;
  load: number | null;
  unit: Unit | null;
  pct: number | null;
  rpe: number | null;
  rir: number | null;
};

const n = (s: string | undefined) => (s == null ? NaN : Number(s.replace(",", ".")));
const rpeOk = (x: number) => Number.isFinite(x) && x >= 5 && x <= 10 && Math.round(x * 2) === x * 2;

function effortOf(s: string): { rpe: number | null; rir: number | null } {
  const rpe = /(?:@\s*|rpe\s*)(\d{1,2}(?:[.,]5)?)\b(?!\s*(?:%|kg|lb))/i.exec(s);
  const rir = /(\d(?:[.,]5)?)\s*rir\b|\brir\s*(\d(?:[.,]5)?)/i.exec(s);
  const rv = rpe ? n(rpe[1]) : NaN;
  const ri = rir ? n(rir[1] ?? rir[2]) : NaN;
  return { rpe: rpeOk(rv) ? rv : null, rir: Number.isFinite(ri) && ri >= 0 && ri <= 5 ? ri : null };
}

/**
 * One written set or set group: "180x3@8", "180 kg x 3 @ RPE 8", "3x5 @ 150",
 * "2x2 @ 92.5%", "180x3x2" (load × reps × sets), "5 @ 140". Null when it isn't one.
 */
export function parseSetText(raw: string, unitHint: Unit | null = null): ParsedSet | null {
  const s = raw.replace(/×/g, "x").replace(/\s+/g, " ").trim();
  if (!s || s.length > 60) return null;
  const unit = unitOf(s) ?? unitHint;
  const { rpe, rir } = effortOf(s);
  const pct = /(\d{2,3}(?:[.,]\d)?)\s*%/.exec(s);
  // "3x5 @ 150kg" / "2x2 @ 92.5%" / "3 x 5 @ 8"
  let m = /^(\d{1,2})\s*x\s*(\d{1,2})(?:\s*(?:@|at)\s*(.*))?$/i.exec(s.replace(/\s*(sets?|reps?)\b/gi, ""));
  if (m && Number(m[1]) <= 12 && Number(m[2]) <= 30) {
    const sets = Number(m[1]);
    const reps = Number(m[2]);
    const rest = m[3] ?? "";
    const load = /(\d{2,4}(?:[.,]\d{1,2})?)\s*(kg|kgs|lb|lbs)?\b(?!\s*%)/i.exec(rest.replace(/rpe\s*\d+(?:[.,]5)?/i, ""));
    const pv = pct ? n(pct[1]) : NaN;
    const lv = load && !pct ? n(load[1]) : NaN;
    const loadOk = Number.isFinite(lv) && lv >= 20 && lv <= 600;
    return {
      sets,
      reps,
      load: loadOk ? lv : null,
      unit: loadOk ? unitOf(load?.[2] ?? "") ?? unit : null,
      pct: Number.isFinite(pv) && pv >= 30 && pv <= 110 ? pv : null,
      rpe: loadOk || pct ? rpe : rpe ?? (rest && rpeOk(n(rest)) ? n(rest) : null),
      rir,
    };
  }
  // "180x3", "180 kg x 3 @ 8", "180x3x2"
  m = /^(\d{2,4}(?:[.,]\d{1,2})?)\s*(kg|kgs|lb|lbs)?\s*x\s*(\d{1,2})(?:\s*x\s*(\d{1,2}))?\b/i.exec(s);
  if (m) {
    const load = n(m[1]);
    const reps = Number(m[3]);
    const sets = m[4] ? Number(m[4]) : 1;
    if (load >= 20 && load <= 600 && reps >= 1 && reps <= 30 && sets >= 1 && sets <= 12)
      return { sets, reps, load, unit: unitOf(m[2] ?? "") ?? unit, pct: null, rpe, rir };
  }
  // "5 @ 140", "3 reps @ 200kg"
  m = /^(\d{1,2})\s*(?:reps?)?\s*@\s*(\d{2,4}(?:[.,]\d{1,2})?)\s*(kg|kgs|lb|lbs)?\b/i.exec(s);
  if (m) {
    const reps = Number(m[1]);
    const load = n(m[2]);
    if (reps >= 1 && reps <= 30 && load >= 20 && load <= 600)
      return { sets: 1, reps, load, unit: unitOf(m[3] ?? "") ?? unit, pct: null, rpe: null, rir };
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (x: number) => String(x).padStart(2, "0");
const valid = (y: number, mo: number, d: number) => {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 ? `${y}-${pad(mo)}-${pad(d)}` : null;
};

/**
 * A date as coaches write it: "2026-11-18", "Nov 18", "18 Nov 2026",
 * "11/18/2026", "18/11/26", an Excel serial (46000), "Mon Nov 18". A day and
 * month with no year takes the year that puts it on or before `today` (logs
 * are the past). Day-first vs month-first: the one that makes a real date,
 * else month-first. Null when it isn't a date.
 */
export function parseDate(raw: string, today: string): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s.length > 40) return null;
  const ty = Number(today.slice(0, 4));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  // Excel serial day (1900 system), only in a plausible window
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 40000 && serial < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const withYear = (mo: number, d: number, y: number | null) => {
    if (y != null) return valid(y < 100 ? 2000 + y : y, mo, d);
    const cand = valid(ty, mo, d);
    if (cand && cand <= today) return cand;
    return valid(ty - 1, mo, d);
  };
  m = /^(?:[a-z]{3,9}\.?,?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?\b/.exec(s);
  const month = (w: string) => MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
  if (m && month(m[1])) {
    const mo = month(m[1]);
    return withYear(mo, Number(m[2]), m[3] ? Number(m[3]) : null);
  }
  m = /^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{2,4}))?\b/.exec(s);
  if (m && month(m[2])) {
    const mo = month(m[2]);
    return withYear(mo, Number(m[1]), m[3] ? Number(m[3]) : null);
  }
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3] ? Number(m[3]) : null;
    if (a > 12 && b <= 12) return withYear(b, a, y);
    return withYear(a, b, y) ?? withYear(b, a, y);
  }
  return null;
}

/** What a file looks like it's for, from its name, sheet names and words. */
export function detectPurposes(o: { name?: string | null; text: string; sheetNames?: string[] }): Purpose[] {
  const head = norm(`${o.name ?? ""} ${(o.sheetNames ?? []).join(" ")}`);
  const body = norm(o.text.slice(0, 20_000));
  const all = `${head} ${body}`;
  const out = new Set<Purpose>();
  if (/\b(log|logs|actual|completed|done|results? log|training diary|journal|history)\b/.test(all)) out.add("logs");
  if (/\b(program|programme|block|week \d|wk ?\d|day \d|meso|template|plan|prescribed|target)\b/.test(all)) out.add("program");
  if (/\b(meet|competition|nationals|provincials|openpowerlifting|total|wilks|gl points|dots|placing|1st place|2nd place)\b/.test(all) && /\b(total|place|meet)\b/.test(all))
    out.add("competition_history");
  if (/\b(opener|openers|attempts?|2nd attempt|third attempt|3rd|attempt selection)\b/.test(all)) out.add("attempts");
  if (/\b(warm ?ups?|warmups?|last warm)\b/.test(all)) out.add("warmups");
  if (/\b(cue|cues|technique|depth|lockout|bar path|elbows|hips rise|knees|brace|bracing|leg drive|setup|hitch)\b/.test(all)) out.add("technical");
  if (/\b(coach|coaching|recommend|recommendation|notes from|instructions?|plan for meet|meet day plan)\b/.test(all)) out.add("coach_recommendations");
  return out.size ? [...out] : ["other"];
}
