/**
 * The coach's overview before a call with a client (any call: an included
 * Coaching Plus call, a General Call). Pure and tested
 * (coaching-packages.test.ts): everything here is worked out from records the
 * server read with the coach's own login.
 *
 * It keeps two things apart, always: what's on file (facts, each from a
 * record: workouts done, weigh-ins, check-ins, pain reports, what the client
 * wrote) and the app's read of it (interpretations: the weight-management
 * engine's call, what the numbers suggest asking about), labelled as such so
 * a read is never mistaken for something the client said or did. Nothing is
 * a diagnosis, and nothing here is ever shown to the client.
 */

export type PrepWorkouts = { planned: number; done: number; missed: number; lastDone: string | null; avgRating: number | null };
export type PrepBodyweight = {
  unit: "kg" | "lb";
  latestKg: number | null;
  latestDate: string | null;
  avg7Kg: number | null;
  weeklyChangeKg: number | null;
  goalKg: number | null;
  goalDate: string | null;
  stale: boolean;
};
export type PrepCheckins = {
  count: number;
  latest: string | null;
  adherence: number | null;
  poorSleep: number;
  lowEnergy: number;
  stress: number;
};
export type PrepPain = { label: string; status: string; trend: string | null; reasons: string[] };
export type PrepNutrition = { phase: string | null; kcalLow: number | null; kcalHigh: number | null; since: string | null };
export type PrepReview = { date: string; actionItems: string[]; nextPriorities: string | null; shared: boolean };

export type PrepInput = {
  today: string;
  topics: string | null;
  bookingNote: string | null;
  workouts: PrepWorkouts | null;
  bodyweight: PrepBodyweight | null;
  checkins: PrepCheckins | null;
  nutrition: PrepNutrition | null;
  pain: PrepPain[];
  /** The weight-management engine's headline (an interpretation). */
  weightRead: string | null;
  previous: PrepReview | null;
  calls: { used: number; included: number; periodEnd: string } | null;
};

export type CallPrep = {
  /** What the client wrote for this call. */
  theirWords: string[];
  /** On file, each line from a record. */
  facts: string[];
  /** The app's read: interpretations, worth checking on the call. */
  reads: string[];
  /** Last call's action items and priorities, to follow up on. */
  followUp: PrepReview | null;
  /** What couldn't be read (so a gap never looks like "nothing to see"). */
  missing: string[];
};

const LB = 2.20462;

function w(kg: number, unit: "kg" | "lb"): string {
  const v = unit === "lb" ? kg * LB : kg;
  return `${v.toFixed(1)} ${unit}`;
}

function signed(kg: number, unit: "kg" | "lb"): string {
  const v = unit === "lb" ? kg * LB : kg;
  if (Math.abs(v) < 0.05) return `no change`;
  return `${v > 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)} ${unit}`;
}

export function shortDay(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** The client's own words in a booking's note ("Note from Marc: …"), else null. */
export function bookingWords(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = notes.match(/Note from [^:]{0,60}:\s*([\s\S]+)$/);
  return m ? m[1]!.trim() || null : null;
}

export function buildCallPrep(x: PrepInput): CallPrep {
  const facts: string[] = [];
  const reads: string[] = [];
  const missing: string[] = [];
  const theirWords = [x.topics, x.bookingNote && x.bookingNote !== x.topics ? x.bookingNote : null].filter(
    (t): t is string => !!t && !!t.trim(),
  );

  if (x.calls) facts.push(`Included calls: ${x.calls.used} of ${x.calls.included} booked this billing period (it ends ${shortDay(x.calls.periodEnd)}).`);

  // Training
  if (x.workouts) {
    const wk = x.workouts;
    if (wk.planned > 0) {
      facts.push(
        `Workouts, last 4 weeks: ${wk.done} of ${wk.planned} planned done${wk.missed ? `, ${wk.missed} missed` : ""}${wk.lastDone ? `. Last one ${shortDay(wk.lastDone)}` : ""}.`,
      );
    } else if (wk.done > 0) {
      facts.push(`Workouts, last 4 weeks: ${wk.done} done${wk.lastDone ? `, last one ${shortDay(wk.lastDone)}` : ""} (nothing was dated as planned).`);
    } else {
      facts.push("Workouts, last 4 weeks: none logged and none planned.");
    }
    if (wk.avgRating != null) facts.push(`Average session rating: ${wk.avgRating.toFixed(1)} of 5.`);
    if (wk.planned >= 4) {
      const share = wk.done / wk.planned;
      if (wk.missed >= 2 && share < 0.75) reads.push(`Consistency looks like the thing to ask about: ${wk.missed} planned workouts missed in 4 weeks.`);
      else if (share >= 0.9) reads.push("Training consistency looks solid; the call can go to what's next.");
    }
    if (wk.lastDone && daysBetween(wk.lastDone, x.today) >= 10) reads.push(`No workout logged in ${daysBetween(wk.lastDone, x.today)} days. Worth asking what's going on.`);
  } else missing.push("workouts");

  // Bodyweight
  if (x.bodyweight && (x.bodyweight.latestKg != null || x.bodyweight.avg7Kg != null)) {
    const b = x.bodyweight;
    const parts: string[] = [];
    if (b.latestKg != null) parts.push(`${w(b.latestKg, b.unit)} on ${shortDay(b.latestDate)}`);
    if (b.avg7Kg != null) parts.push(`7-day average ${w(b.avg7Kg, b.unit)}`);
    if (b.weeklyChangeKg != null) parts.push(`${signed(b.weeklyChangeKg, b.unit)} on the week before`);
    facts.push(`Bodyweight: ${parts.join(", ")}.`);
    if (b.goalKg != null) {
      const now = b.avg7Kg ?? b.latestKg;
      const gap = now != null ? b.goalKg - now : null;
      facts.push(
        `Goal: ${w(b.goalKg, b.unit)}${b.goalDate ? ` by ${shortDay(b.goalDate)}` : ""}${gap != null ? ` (${Math.abs(b.unit === "lb" ? gap * LB : gap).toFixed(1)} ${b.unit} ${gap < 0 ? "to lose" : "to gain"})` : ""}.`,
      );
    }
    if (b.stale) reads.push("The last weigh-in is old, so any bodyweight read is shaky. Ask them to log a few this week.");
  } else missing.push("bodyweight");

  // Nutrition
  if (x.nutrition && (x.nutrition.phase || x.nutrition.kcalLow)) {
    const n = x.nutrition;
    const kcal = n.kcalLow ? (n.kcalHigh && n.kcalHigh !== n.kcalLow ? `${n.kcalLow}–${n.kcalHigh} kcal` : `${n.kcalLow} kcal`) : null;
    facts.push(`Nutrition plan: ${[n.phase, kcal].filter(Boolean).join(", ")}${n.since ? ` since ${shortDay(n.since)}` : ""}.`);
  } else missing.push("nutrition plan");

  // Check-ins
  if (x.checkins && x.checkins.count > 0) {
    const c = x.checkins;
    facts.push(
      `Weekly check-ins: last on ${shortDay(c.latest)}${c.adherence != null ? `; nutrition consistency ${c.adherence.toFixed(1)} of 5 (last 3)` : ""}.`,
    );
    const flags = [
      c.poorSleep ? `poor sleep ${c.poorSleep}×` : null,
      c.lowEnergy ? `low energy ${c.lowEnergy}×` : null,
      c.stress ? `high stress ${c.stress}×` : null,
    ].filter(Boolean);
    if (flags.length) facts.push(`Flagged in recent check-ins: ${flags.join(", ")}.`);
    if (c.poorSleep >= 2 || c.lowEnergy >= 2) reads.push("Sleep or energy keeps coming up in check-ins. Recovery may be worth more of the call than the program.");
    if (c.latest && daysBetween(c.latest, x.today) > 10) reads.push(`No check-in for ${daysBetween(c.latest, x.today)} days.`);
  } else missing.push("weekly check-ins");

  // Pain
  for (const p of x.pain.slice(0, 3)) {
    facts.push(`Pain reported: ${p.label} (${p.status}${p.trend ? `, ${p.trend}` : ""}).`);
    if (p.reasons.length) reads.push(`${p.label} may need a look: ${p.reasons.join(", ")}. Not a diagnosis; ask how it's been.`);
  }

  if (x.weightRead) reads.push(`Bodyweight engine: ${x.weightRead}`);

  return { theirWords, facts, reads, followUp: x.previous, missing };
}

/** The message that sends a call's action items to the client (never the private notes). */
export function actionItemsMessage(o: { firstName: string | null; date: string; actionItems: string[]; nextPriorities: string | null }): string {
  const lines: string[] = [];
  lines.push(`${o.firstName ? `${o.firstName}, here` : "Here"} are your next steps from our call on ${shortDay(o.date)}:`);
  for (const a of o.actionItems) lines.push(`• ${a}`);
  if (o.nextPriorities?.trim()) {
    lines.push("");
    lines.push(`Next priorities: ${o.nextPriorities.trim()}`);
  }
  return lines.join("\n");
}
