/**
 * The post-meet comparison (pure, tested): what was forecast against what was
 * lifted, the planned attempts against the ones taken, and what it says for
 * next time, from the numbers alone. The forecast compared is the one the coach
 * last confirmed (the confirmation, else the game plan), never one rewritten
 * after the fact: history is never edited to look right.
 */
import type { Brief } from "./brief";
import type { AttemptTriple, Lift, Range } from "./types";

export type MeetResults = {
  squat: number | null;
  bench: number | null;
  deadlift: number | null;
  total: number | null;
  place: string | null;
  bodyweight: number | null;
  attempts: { s: AttemptTriple; b: AttemptTriple; d: AttemptTriple } | null;
  source: "manual" | "opl" | "meet_log";
};

const KEY: Record<Lift, "s" | "b" | "d"> = { squat: "s", bench: "b", deadlift: "d" };
const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export type DebriefRead = {
  lifts: Array<{
    lift: Lift;
    forecast: Range | null;
    actual: number | null;
    withinRange: boolean | null;
    errorPct: number | null;
    plannedOpener: number | null;
    actualOpener: number | null;
    made: number | null;
    taken: number | null;
  }>;
  total: {
    forecast: Range | null;
    actual: number | null;
    withinRange: boolean | null;
    errorPct: number | null;
  };
  findings: string[];
};

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;

export function readDebrief(
  plan: Pick<Brief, "forecast" | "attempts"> | null,
  results: MeetResults,
): DebriefRead {
  const findings: string[] = [];
  const lifts = LIFTS.map((lift) => {
    const forecast = plan?.forecast.lifts[lift]?.range ?? null;
    const actual = results[lift];
    const t = results.attempts?.[KEY[lift]] ?? null;
    const taken = t ? t.filter((x) => x != null && x !== 0).length : null;
    const made = t ? t.filter((x) => x != null && x > 0).length : null;
    const actualOpener = t?.[0] != null ? Math.abs(t[0]) : null;
    const plannedOpener = plan?.attempts.lifts[lift]?.opener ?? null;
    const within =
      forecast && actual ? actual >= forecast.conservative && actual <= forecast.high : null;
    return {
      lift,
      forecast,
      actual,
      withinRange: within,
      errorPct: forecast && actual ? pct(actual, forecast.expected) : null,
      plannedOpener,
      actualOpener,
      made,
      taken,
    };
  });
  const tf = plan?.forecast.total ?? null;
  const total = {
    forecast: tf,
    actual: results.total,
    withinRange:
      tf && results.total ? results.total >= tf.conservative && results.total <= tf.high : null,
    errorPct: tf && results.total ? pct(results.total, tf.expected) : null,
  };
  if (total.errorPct != null) {
    findings.push(
      total.withinRange
        ? `Total ${results.total} kg landed inside the forecast (${tf!.conservative}–${tf!.high}), ${total.errorPct >= 0 ? "+" : ""}${total.errorPct}% against expected`
        : `Total ${results.total} kg was ${total.errorPct > 0 ? "over" : "under"} the forecast range (${tf!.conservative}–${tf!.high})`,
    );
  } else if (results.total == null) findings.push("No total: a lift had no made attempt");
  for (const l of lifts) {
    if (l.made != null && l.taken)
      findings.push(`${l.lift[0].toUpperCase()}${l.lift.slice(1)}: ${l.made} of ${l.taken} made`);
    if (
      l.plannedOpener != null &&
      l.actualOpener != null &&
      Math.abs(l.actualOpener - l.plannedOpener) >= 2.5
    ) {
      findings.push(
        `${l.lift[0].toUpperCase()}${l.lift.slice(1)} opened at ${l.actualOpener} kg against the planned ${l.plannedOpener} kg`,
      );
    }
    if (results.attempts && (results.attempts[KEY[l.lift]][0] ?? 0) < 0)
      findings.push(`Missed the ${l.lift} opener`);
  }
  return { lifts, total, findings };
}

/** Results read from a stored meet row or the meet-day log (the best made attempt per lift). */
export function resultsFromLog(
  log: Array<{ entrant: string; lift: Lift; attempt: number; kg: number | null; result: string }>,
  bodyweight: number | null,
): MeetResults | null {
  const ours = log.filter((r) => r.entrant === "us" && r.attempt <= 3);
  if (!ours.length) return null;
  const attempts = {
    s: [null, null, null],
    b: [null, null, null],
    d: [null, null, null],
  } as MeetResults["attempts"] & object;
  for (const r of ours) {
    if (r.kg == null || r.result === "pending") continue;
    attempts[KEY[r.lift]][r.attempt - 1] = r.result === "good" ? r.kg : -r.kg;
  }
  const best = (t: AttemptTriple) => {
    const made = t.filter((x): x is number => x != null && x > 0);
    return made.length ? Math.max(...made) : null;
  };
  const s = best(attempts.s),
    b = best(attempts.b),
    d = best(attempts.d);
  return {
    squat: s,
    bench: b,
    deadlift: d,
    total: s != null && b != null && d != null ? s + b + d : null,
    place: null,
    bodyweight,
    attempts,
    source: "meet_log",
  };
}
