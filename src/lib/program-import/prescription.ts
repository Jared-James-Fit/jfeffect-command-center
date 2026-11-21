/**
 * Reading a written prescription ("4 x 6-8 @ RPE 8", "3×5 @ 75%", "2 RIR,
 * 90s rest", "Tempo 3-1-1-0", "1 x 3 @ 8, then 3 x 5 @ 85%") into the plan's
 * numbers, deterministically. What isn't recognised is handed back
 * (`leftover`), never guessed at. Pure.
 */
import type { ImportedExercise, WeightUnit } from "./types";

export type Rx = Pick<
  ImportedExercise,
  "sets" | "reps" | "load" | "unit" | "pct" | "pct_of" | "rpe" | "rir" | "tempo" | "rest_seconds" | "velocity"
> & {
  /** Training max / e1RM wording the plan has no place for, said in words. */
  basisNote: string | null;
};

export const emptyRx = (): Rx => ({
  sets: null,
  reps: null,
  load: null,
  unit: null,
  pct: null,
  pct_of: null,
  rpe: null,
  rir: null,
  tempo: null,
  rest_seconds: null,
  velocity: null,
  basisNote: null,
});

const DASH = /\s*[-–—]\s*|\s+to\s+/;
const num = (s: string) => Number(s.replace(",", "."));
const RPE_OK = /^(10|[1-9](\.5)?)(-(10|[1-9](\.5)?))?$/;
const RIR_OK = /^(10|[0-9](\.5)?)(-(10|[0-9](\.5)?))?$/;

/** "8", "7.5-8", "8 to 9" as the plan writes an effort range, or null when it isn't one. */
export function effortRange(raw: string, kind: "rpe" | "rir"): string | null {
  const parts = raw.trim().split(DASH).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const vals = parts.map((p) => {
    const n = num(p);
    if (!Number.isFinite(n)) return null;
    // 8.5 stays; a quarter (8.25) isn't a scale anyone writes on a plan
    return Math.round(n * 2) / 2 === n ? String(n) : null;
  });
  if (vals.some((v) => v == null)) return null;
  const s = vals.length === 2 && vals[0] === vals[1] ? vals[0]! : vals.join("-");
  return (kind === "rpe" ? RPE_OK : RIR_OK).test(s) ? s : null;
}

/** "8-10", "5", "AMRAP", "5+", "12-15", "30s"… as the plan keeps reps (≤ 20 characters). */
export function repsText(raw: string): string | null {
  const s = raw.trim().replace(/\s*[-–—]\s*/g, "-").replace(/\s+to\s+/gi, "-");
  if (!s) return null;
  if (/^(amrap|max|max reps|failure|f)$/i.test(s)) return "AMRAP";
  if (/^\d{1,3}(-\d{1,3})?\+?$/.test(s)) return s;
  if (/^\d{1,3}(\/\d{1,3}){1,5}$/.test(s)) return s; // 5/3/1, 10/8/6 (a set each)
  if (/^\d{1,3}\s*(s|sec|secs|seconds)$/i.test(s)) return `${s.match(/\d+/)![0]}s`;
  if (/^\d{1,3}\s*(each|\/side|per side|ea|e\/s)$/i.test(s)) return `${s.match(/\d+/)![0]} each`;
  return null;
}

/** "2 min", "90s", "2:30", "3-5 min" → seconds (a range: its lower end, said in `rangeNote`). */
export function restSeconds(raw: string): { seconds: number | null; rangeNote: string | null } {
  const s = raw.trim().toLowerCase();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return { seconds: Number(m[1]) * 60 + Number(m[2]), rangeNote: null };
  m = /^(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(s|sec|secs|seconds|"|m|min|mins|minutes|'|)$/.exec(s);
  if (!m) return { seconds: null, rangeNote: null };
  const unitMin = /^(m|min|mins|minutes|')$/.test(m[3]) || (m[3] === "" && num(m[1]) <= 10);
  const toSec = (v: string) => Math.round(num(v) * (unitMin ? 60 : 1));
  const lo = toSec(m[1]);
  if (!(lo > 0 && lo <= 1800)) return { seconds: null, rangeNote: null };
  const rangeNote = m[2] ? `Rest ${raw.trim()}` : null;
  return { seconds: Math.min(lo, 900), rangeNote };
}

/** A unit word → kg / lb. */
export function unitWord(raw: string | null | undefined): WeightUnit | null {
  const s = String(raw ?? "").toLowerCase();
  if (/^(kg|kgs|kilo|kilos|kilograms?)$/.test(s)) return "kg";
  if (/^(lb|lbs|pound|pounds|#)$/.test(s)) return "lb";
  return null;
}

/** What a percentage is of, from the words after it. */
function pctBasis(words: string): { of: "1rm" | "top_set"; note: string | null } {
  const w = words.toLowerCase();
  if (/top\s*(set|single)?|today'?s top|of top/.test(w)) return { of: "top_set", note: null };
  if (/\btm\b|training max/.test(w)) return { of: "1rm", note: "% of training max" };
  if (/e1rm|estimated/.test(w)) return { of: "1rm", note: "% of estimated max" };
  return { of: "1rm", note: null };
}

/**
 * Every recognised piece of one written prescription. `leftover` is what's
 * left once they're taken out (words that belong in notes, or something that
 * needs a person to read it).
 */
export function parsePrescription(text: string, unitHint: WeightUnit | null = null): { rx: Rx; leftover: string; found: number } {
  const rx = emptyRx();
  let rest = ` ${text.replace(/ /g, " ")} `;
  let found = 0;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const m = re.exec(rest);
    if (!m) return;
    if (fn(m) === false) return;
    rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
    found++;
  };

  // velocity: 0.6 m/s, 0.8-1.0 m/s
  take(/(\d?[.,]\d+(?:\s*[-–]\s*\d?[.,]\d+)?)\s*m\s*\/\s*s\b/i, (m) => {
    rx.velocity = `${m[1].replace(/\s+/g, "")} m/s`;
  });
  // tempo: "tempo 3-1-1-0", "tempo 31X1"
  take(/\btempo\s*:?\s*([0-9xX](?:[-\s.]?[0-9xX]){2,3})\b/i, (m) => {
    rx.tempo = m[1].replace(/[\s.]/g, "-").toUpperCase().slice(0, 12);
  });
  // rest: "rest 2 min", "2:00 rest", "rest: 90s", "3-5 min rest"
  take(/\brest\s*:?\s*(\d{1,2}:\d{2}|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*(?:s|sec|secs|seconds|m|min|mins|minutes|'|")?)(?![\w%])/i, (m) => {
    const r = restSeconds(m[1]);
    if (r.seconds == null) return false;
    rx.rest_seconds = r.seconds;
  });
  take(/(\d{1,2}:\d{2}|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*(?:s|sec|secs|seconds|m|min|mins|minutes))\s*(?:rest|between sets|recovery)\b/i, (m) => {
    if (rx.rest_seconds != null) return false;
    const r = restSeconds(m[1]);
    if (r.seconds == null) return false;
    rx.rest_seconds = r.seconds;
  });
  // RIR: "2 RIR", "RIR 1-2", "1-2 reps in reserve"
  take(/\b(\d(?:\.5)?(?:\s*[-–]\s*\d(?:\.5)?)?)\s*(?:rir|reps? in (?:the )?(?:reserve|tank))\b/i, (m) => {
    const v = effortRange(m[1], "rir");
    if (!v) return false;
    rx.rir = v;
  });
  take(/\brir\s*:?\s*(\d(?:\.5)?(?:\s*[-–]\s*\d(?:\.5)?)?)\b/i, (m) => {
    if (rx.rir) return false;
    const v = effortRange(m[1], "rir");
    if (!v) return false;
    rx.rir = v;
  });
  // RPE: "RPE 8", "@8", "@ RPE 7-8", "8 RPE"
  take(/\brpe\s*:?\s*@?\s*(\d{1,2}(?:\.5)?(?:\s*[-–]\s*\d{1,2}(?:\.5)?)?)(?![\d%.])/i, (m) => {
    const v = effortRange(m[1], "rpe");
    if (!v) return false;
    rx.rpe = v;
  });
  take(/\b(\d{1,2}(?:\.5)?(?:\s*[-–]\s*\d{1,2}(?:\.5)?)?)\s*rpe\b/i, (m) => {
    if (rx.rpe) return false;
    const v = effortRange(m[1], "rpe");
    if (!v) return false;
    rx.rpe = v;
  });
  // percentage: "75%", "@ 75% 1RM", "70-75%", "90% of top set"
  take(/(\d{1,3}(?:[.,]\d+)?)(?:\s*[-–]\s*(\d{1,3}(?:[.,]\d+)?))?\s*%\s*((?:of\s*)?(?:(?:your\s*)?(?:1\s*rm|max|e1rm|estimated max|tm|training max|today'?s top set|top set|top single|top)\b)?)/i, (m) => {
    const lo = num(m[1]);
    if (!(lo > 0 && lo <= 150)) return false;
    const basis = pctBasis(m[3] ?? "");
    rx.pct = lo;
    rx.pct_of = basis.of;
    if (m[2]) rx.basisNote = [`${m[1]}–${m[2]}%`, basis.note].filter(Boolean).join(" ");
    else rx.basisNote = basis.note;
  });
  // a weight with its unit: "100kg", "225 lbs", "@ 315#"
  take(/@?\s*(\d{1,4}(?:[.,]\d+)?)\s*(kg|kgs|kilos?|lbs?|pounds?|#)(?![a-z])/i, (m) => {
    const v = num(m[1]);
    if (!(v > 0 && v <= 1500)) return false;
    rx.load = v;
    rx.unit = unitWord(m[2]);
  });
  // sets x reps: "3x5", "3 × 8-10", "4x5+", "3x AMRAP", "3 sets of 10", "3 sets x 12 reps"
  take(/\b(\d{1,2})\s*(?:x|×|\*|sets?\s*(?:of|x|×)?)\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?\+?|amrap|max(?:\s*reps)?|failure)(?:\s*reps?)?(?:\s*(?:each|\/side|per side|ea))?\b/i, (m) => {
    const sets = Number(m[1]);
    const reps = repsText(m[2]);
    if (!(sets >= 1 && sets <= 50) || !reps) return false;
    rx.sets = sets;
    rx.reps = /each|side|ea\b/i.test(m[0]) ? `${reps} each` : reps;
  });
  // "5 reps", "x5" after sets came from elsewhere
  take(/(?:^|\s)x\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?\+?)\b/i, (m) => {
    if (rx.reps) return false;
    rx.reps = repsText(m[1]);
  });
  // "@ 8" with no word: an RPE (a load would have a unit; a bare "@ 225" is a weight in the file's unit)
  take(/@\s*(\d{1,4}(?:[.,]\d+)?(?:\s*[-–]\s*\d{1,2}(?:\.5)?)?)(?![\d%.])/, (m) => {
    const v = num(m[1].split(/[-–]/)[0]);
    if (!rx.rpe && v <= 10) {
      const e = effortRange(m[1], "rpe");
      if (!e) return false;
      rx.rpe = e;
      return;
    }
    if (rx.load == null && rx.pct == null && v > 10 && v <= 1500 && !/[-–]/.test(m[1])) {
      rx.load = v;
      rx.unit = unitHint;
      return;
    }
    return false;
  });

  const leftover = rest
    .replace(/\s*[,;|]\s*(?=[,;|]|$)/g, " ")
    .replace(/^[\s,;|:@\-–]+|[\s,;|:@\-–]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { rx, leftover, found };
}

/** Whether a line has something a prescription would (a sets × reps, a %, an RPE…). */
export function looksLikePrescription(text: string): boolean {
  return parsePrescription(text).found > 0;
}

/**
 * One cell or line that holds more than one prescription ("1 x 3 @ 8, then
 * 3 x 5 @ 85%" / "Top set 1x5 @8 + 3x5 @ 90% of top set"): each part, when
 * every part reads as one. Else the whole as one.
 */
export function splitPrescriptions(text: string): string[] {
  const parts = text
    .split(/\s*(?:,?\s*then\s+|\s\+\s|;\s*|,\s*(?=\d{1,2}\s*(?:x|×)))/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [text];
  const sets = parts.map((p) => parsePrescription(p).rx);
  return sets.every((r) => r.sets != null && r.reps != null) ? parts : [text];
}
