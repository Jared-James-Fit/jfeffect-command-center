/**
 * What could cost the athlete at this meet, read from the records every day
 * (pure, tested): programming that ends before the meet or has no peak, a
 * bodyweight path that doesn't reach the class, pain on a lift the meet
 * loads, recovery or adherence slipping, the forecast short of the target,
 * cardio piling up near the meet, and what information is still missing.
 * Each one is a concern with a severity and the evidence; none of them changes
 * a program, a plan or an attempt by itself. The important ones go first.
 */
import type { Concern } from "./forecast";
import type { Lift } from "./types";

export type WatchItem = Concern & {
  key: string;
  area:
    | "program"
    | "bodyweight"
    | "pain"
    | "recovery"
    | "adherence"
    | "forecast"
    | "cardio"
    | "info";
};

export type WatchInput = {
  daysOut: number;
  /** the last day the client's live programming covers (null: no dated program) */
  programEndsOn: string | null;
  /** the program could be read (a failed read never reads as "no program") */
  programRead?: boolean;
  meetDate: string;
  /** a peaking / taper / intensification block covers the final three weeks */
  peakCovered: boolean | null;
  /** 7-day average bodyweight and the class limit, kg */
  bodyweightAvg: number | null;
  /** weekly change of the trend, kg (negative = losing) */
  bodyweightTrendPerWeek: number | null;
  classLimit: number | null;
  /** places with pain that needs a look, mapped to what they load */
  pain: Array<{ place: string; lift: Lift | null; worse: boolean; score: number | null; /** a general symptom (a headache, dizziness): never "pain on a lift" */ general?: boolean }>;
  /** recent check-ins flagging poor sleep, energy or recovery (of the last three) */
  recoveryFlags: number;
  /** planned workouts done in the last four weeks, as a share (null: none planned) */
  adherence: number | null;
  expectedTotal: number | null;
  targetTotal: number | null;
  cardioMinutesPerWeek: number | null;
  missing: string[];
};

const ORDER: Record<Concern["severity"], number> = { serious: 0, concern: 1, watch: 2 };

export function watchList(x: WatchInput): WatchItem[] {
  const out: WatchItem[] = [];
  if (x.daysOut > 0 && x.programRead !== false) {
    if (!x.programEndsOn)
      out.push({
        key: "program:none",
        area: "program",
        lift: null,
        severity: "serious",
        text: "No dated program runs to the meet",
      });
    else if (x.programEndsOn < x.meetDate) {
      const gap = Math.round(
        (Date.parse(`${x.meetDate}T12:00:00Z`) - Date.parse(`${x.programEndsOn}T12:00:00Z`)) /
          86_400_000,
      );
      out.push({
        key: "program:ends",
        area: "program",
        lift: null,
        severity: gap > 14 ? "serious" : "concern",
        text: `Programming ends ${gap} days before the meet (${x.programEndsOn})`,
      });
    }
    if (x.daysOut <= 35 && x.peakCovered === false)
      out.push({
        key: "program:peak",
        area: "program",
        lift: null,
        severity: "concern",
        text: "Nothing in the final three weeks reads as a peak or taper",
      });
  }
  if (x.classLimit && x.bodyweightAvg && x.daysOut > 0) {
    const over = x.bodyweightAvg - x.classLimit;
    if (over > 0) {
      const weeks = Math.max(x.daysOut / 7, 0.5);
      const rate = over / weeks / x.bodyweightAvg;
      const losing = (x.bodyweightTrendPerWeek ?? 0) < 0;
      const severity: Concern["severity"] =
        rate > 0.01 || (x.daysOut <= 7 && over > x.classLimit * 0.005)
          ? "serious"
          : rate > 0.005 || !losing
            ? "concern"
            : "watch";
      out.push({
        key: "bodyweight:over",
        area: "bodyweight",
        lift: null,
        severity,
        text: `7-day average ${x.bodyweightAvg} kg is ${Math.round(over * 10) / 10} kg over the ${x.classLimit} kg class: ${Math.round(rate * 1000) / 10}% of bodyweight a week to make it${losing ? "" : ", and the trend isn't going down"}`,
      });
    }
  }
  for (const p of x.pain) {
    const severity: Concern["severity"] = p.worse || (p.score ?? 0) >= 7 ? "serious" : "concern";
    out.push({
      key: `pain:${p.place}`,
      area: "pain",
      lift: p.lift,
      severity,
      text: p.general
        ? `${p.place} reported${p.worse ? ", getting worse" : ""}: a symptom, not tied to a lift`
        : `${p.place} pain${p.worse ? " getting worse" : ""}${p.score != null ? ` (${p.score}/10)` : ""}${p.lift ? `: it loads the ${p.lift}` : ""}`,
    });
  }
  if (x.recoveryFlags >= 2)
    out.push({
      key: "recovery",
      area: "recovery",
      lift: null,
      severity: x.recoveryFlags >= 3 ? "serious" : "concern",
      text: `Sleep, energy or recovery flagged in ${x.recoveryFlags} of the last 3 check-ins`,
    });
  if (x.adherence != null && x.adherence < 0.75)
    out.push({
      key: "adherence",
      area: "adherence",
      lift: null,
      severity: x.adherence < 0.5 ? "serious" : "concern",
      text: `${Math.round(x.adherence * 100)}% of planned workouts done in the last four weeks`,
    });
  if (x.expectedTotal && x.targetTotal && x.expectedTotal < x.targetTotal) {
    const short = x.targetTotal - x.expectedTotal;
    out.push({
      key: "forecast:short",
      area: "forecast",
      lift: null,
      severity: short / x.targetTotal > 0.04 ? "concern" : "watch",
      text: `Expected total ${x.expectedTotal} kg is ${Math.round(short * 10) / 10} kg under the ${x.targetTotal} kg target`,
    });
  }
  if (
    x.cardioMinutesPerWeek != null &&
    x.daysOut > 0 &&
    x.daysOut <= 28 &&
    x.cardioMinutesPerWeek > 150
  )
    out.push({
      key: "cardio",
      area: "cardio",
      lift: null,
      severity: "watch",
      text: `${x.cardioMinutesPerWeek} minutes of cardio a week this close to the meet`,
    });
  for (const m of x.missing)
    out.push({
      key: `info:${m}`,
      area: "info",
      lift: null,
      severity: "watch",
      text: `Missing: ${m}`,
    });
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** Which competition lift a pain place loads (null: none in particular). */
export function liftForPlace(place: string): Lift | null {
  const p = place.toLowerCase();
  // the head, face, jaw and general symptoms (a headache, dizziness) load no lift
  if (/headache|dizz|nause|stomach|breath|heart|faint|sick|unwell|exhaust|head|face|jaw|eye|temple|skull/.test(p)) return null;
  // grip: fingers, the thumb and the hand hold the deadlift
  if (/finger|thumb|palm|knuckle|pinky|hand|grip/.test(p)) return "deadlift";
  if (/rib/.test(p)) return "bench";
  if (/shoulder|pec|chest|elbow|wrist|tricep/.test(p)) return "bench";
  if (/knee|quad|patell|adductor|groin|foot|feet|toe|heel|arch|ankle|achilles|pelvis/.test(p)) return "squat";
  if (/hamstring|lower back|low back|lumbar|si joint|glute/.test(p)) return "deadlift";
  if (/hip|back/.test(p)) return "squat";
  return null;
}

/**
 * The weight class a coach's own words name ("I'm competing as a 66kg
 * athlete", "The game plan is 66kg", "the 84+ class"), else null. Only
 * explicit class wording counts, so an attempt ("squat 105 kg") or a
 * bodyweight ("58.1 this morning") never reads as a class.
 */
export function classInWords(text: string | null | undefined): string | null {
  if (!text) return null;
  const n = "(\\d{2,3})\\s*(?:kg|kgs|kilo|kilos)?\\s*(\\+)?";
  const patterns = [
    new RegExp(`\\b(?:compet(?:e|ing)|lift(?:ing)?|enter(?:ed|ing)?|stay(?:ing)?|move|moving|drop(?:ping)?|go(?:ing)?)\\s+(?:as|at|in|to|down to|up to|into)\\s+(?:an?\\s+|the\\s+)?${n}(?=\\s*(?:kg|kgs|kilo|class|athlete|lifter|\\+|$|[^\\d.]))`, "i"),
    new RegExp(`\\b(?:game\\s+plan|plan|class)\\s+is\\s+(?:the\\s+)?${n}`, "i"),
    new RegExp(`\\b${n}\\s*(?:kg|kgs)?\\s+(?:weight\\s+)?class\\b`, "i"),
    new RegExp(`\\b${n}\\s*kg\\s+(?:athlete|lifter)\\b`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const kg = Number(m[1]);
    if (kg >= 40 && kg <= 140) return `${kg}${m[2] ? "+" : ""}`;
  }
  return null;
}

/**
 * A coach's note naming another class than the meet is entered in: the
 * engine plans at the meet's own class, and only the coach can change it
 * (the meet's details), so this says so instead of a plan at the wrong class
 * reading as an answer to the note.
 */
export function classNoteConcern(instructions: string | null | undefined, meetClass: string | null | undefined): WatchItem | null {
  const said = classInWords(instructions);
  if (!said || !meetClass) return null;
  const norm = (s: string) => s.replace(/\s|kg/gi, "");
  if (norm(said) === norm(meetClass)) return null;
  return {
    key: `class:note:${said}`,
    area: "bodyweight",
    lift: null,
    severity: "serious",
    text: `Your note says ${said} kg, but this meet is entered at ${norm(meetClass)} kg, so these numbers are still at ${norm(meetClass)} kg. Change the meet's weight class for the plan to use ${said} kg.`,
  };
}
