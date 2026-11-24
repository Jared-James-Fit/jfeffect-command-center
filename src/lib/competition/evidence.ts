/**
 * The evidence Cleo reasons from, numbered so every proposal can cite it
 * (pure, tested in competition-proposals.test.ts). Each item is one thing on
 * file, said as it is: a training day's top set with its effort and bar
 * speed, a meet with its attempts, how training has turned into meet lifts,
 * warm-up habits, bodyweight, pain, recovery, the program, each competitor's
 * meets and training. A proposal that cites an id that isn't here is set
 * aside (proposals.ts), so nothing Cleo argues can rest on something the app
 * doesn't have.
 */
import type { Brief } from "./brief";
import { attemptPatternWords } from "./competitor";
import { liftAt } from "./meet-stats";
import { addDays } from "./milestones";
import type { Lift, MeetRecord } from "./types";

export type EvidenceKind =
  | "training"
  | "line"
  | "meet"
  | "conversion"
  | "attempt_history"
  | "warmup"
  | "bodyweight"
  | "pain"
  | "recovery"
  | "program"
  | "cardio"
  | "competitor_meet"
  | "competitor_training"
  | "competitor_read"
  | "field";

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  text: string;
  lift?: Lift | null;
  date?: string | null;
  /** the competitor it's about (competition_competitors.id) */
  competitorId?: string | null;
};

const CODE: Record<Lift, string> = { squat: "SQ", bench: "BP", deadlift: "DL" };
const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

const triple = (t: Array<number | null> | undefined) =>
  (t ?? [])
    .map((x) => (x == null ? "–" : x < 0 ? `${-x}x` : `${x}`))
    .join("/");

export function meetLine(m: MeetRecord): string {
  const parts = [
    `${m.date} ${m.name ?? "Meet"}${m.federation ? ` (${m.federation})` : ""}`,
    m.bodyweight ? `${m.bodyweight} kg bodyweight${m.weightClass ? ` in ${m.weightClass}` : ""}` : null,
  ].filter(Boolean);
  const a = m.attempts;
  const lifts = a
    ? `squat ${triple(a.s)}, bench ${triple(a.b)}, deadlift ${triple(a.d)} (x = missed)`
    : `squat ${m.squat ?? "–"}, bench ${m.bench ?? "–"}, deadlift ${m.deadlift ?? "–"}`;
  return `${parts.join(", ")}: ${lifts}; total ${m.total ?? "none"}${m.place ? `, place ${m.place}` : ""}${m.equipment && !/raw/i.test(m.equipment) ? `, ${m.equipment}` : ""}`;
}

export function buildEvidence(b: Brief): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const today = b.today;
  const twelve = addDays(today, -84);

  // training days per lift, newest first
  for (const lift of LIFTS) {
    const days = (b.inputs.sessions[lift] ?? []).filter((d) => d.day >= twelve).slice(0, 12);
    days.forEach((d, i) =>
      out.push({
        id: `T-${CODE[lift]}${i + 1}`,
        kind: "training",
        lift,
        date: d.day,
        text: `${d.day} ${lift}: ${d.kg} kg × ${d.reps}${d.rpe != null ? ` @ RPE ${d.rpe}` : " (no RPE)"}${d.velocity != null ? `, ${d.velocity} m/s` : ""}; estimate ${d.e1rm} kg (${d.confidence} confidence); heaviest that day ${d.heaviestKg} kg`,
      }),
    );
    const f = b.forecast.lifts[lift];
    if (f)
      out.push({
        id: `L-${CODE[lift]}`,
        kind: "line",
        lift,
        text: `The engine's ${lift}: ${f.range.conservative}/${f.range.expected}/${f.range.high} kg (${f.confidence}, from ${f.source}); ${f.basis.join("; ")}`,
      });
    const conv = b.inputs.conversion.filter((c) => c.lift === lift);
    if (conv.length)
      out.push({
        id: `CV-${CODE[lift]}`,
        kind: "conversion",
        lift,
        text: `${lift} training line 3 weeks out against the meet: ${conv
          .map((c) => `${c.meetDate} ${c.trainingKg}→${c.meetKg} kg`)
          .join("; ")}`,
      });
    const w = b.inputs.warmups[lift];
    if (w && w.sessions)
      out.push({
        id: `W-${CODE[lift]}`,
        kind: "warmup",
        lift,
        text: `${lift} warm-ups in training: ${w.sessions} logged sessions, a median ${w.medianSets ?? "?"} sets, last warm-up a median ${w.lastPct != null ? Math.round(w.lastPct * 100) : "?"}% of the first working set`,
      });
  }

  // meets, newest first
  b.inputs.meets.slice(0, 10).forEach((m, i) =>
    out.push({ id: `M${i + 1}`, kind: "meet", date: m.date, text: meetLine(m) }),
  );
  const ah = attemptPatternWords(b.inputs.history);
  if (ah.length || b.profile.patterns.length)
    out.push({
      id: "AH",
      kind: "attempt_history",
      text: [...ah, ...b.profile.patterns.map((p) => `${p.text} (${p.evidence})`)].join("; "),
    });

  if (b.inputs.bodyweightAvg != null || b.inputs.classLimit != null)
    out.push({
      id: "BW",
      kind: "bodyweight",
      text: `7-day average ${b.inputs.bodyweightAvg ?? "unknown"} kg${b.inputs.bodyweightTrendPerWeek != null ? `, ${b.inputs.bodyweightTrendPerWeek > 0 ? "+" : ""}${b.inputs.bodyweightTrendPerWeek} kg a week` : ""}; class limit ${b.inputs.classLimit ?? "not set"}${b.inputs.bodyweightAvg != null && b.inputs.classLimit != null ? `; ${Math.round((b.inputs.bodyweightAvg - b.inputs.classLimit) * 10) / 10} kg over the limit` : ""}`,
    });
  const wf = b.inputs.watchFacts;
  (wf.pain ?? []).forEach((p, i) =>
    out.push({
      id: `P${i + 1}`,
      kind: "pain",
      lift: p.lift,
      text: `Pain: ${p.place}${p.score != null ? ` ${p.score}/10` : ""}${p.worse ? ", getting worse" : ""}${p.lift ? ` (loads the ${p.lift})` : ""}`,
    }),
  );
  if (wf.recoveryFlags)
    out.push({
      id: "R",
      kind: "recovery",
      text: `Sleep, stress or energy flagged in ${wf.recoveryFlags} of the last 3 weekly check-ins`,
    });
  out.push({
    id: "PRG",
    kind: "program",
    text: !wf.programRead
      ? "The program couldn't be read"
      : wf.programEndsOn
        ? `Programmed to ${wf.programEndsOn}; ${wf.peakCovered ? "a peak or taper block covers the final three weeks" : "nothing reads as a peak or taper in the final three weeks"}`
        : "No live program on file",
  });
  if (wf.cardioMinutesPerWeek)
    out.push({ id: "CA", kind: "cardio", text: `Cardio ${wf.cardioMinutesPerWeek} min a week` });

  // the field
  b.competitors.slice(0, 10).forEach((c, ci) => {
    const n = ci + 1;
    const p = c.read.projection;
    out.push({
      id: `C${n}`,
      kind: "competitor_read",
      competitorId: c.id,
      text: `${c.name} (${c.status}${c.identity !== "matched" ? `, identity ${c.identity}` : ""}): engine ${p ? `${p.conservative}/${p.expected}/${p.high} kg` : "no projection"}; ${c.read.basis.join("; ")}${attemptPatternWords(c.read.stats).length ? `; ${attemptPatternWords(c.read.stats).join("; ")}` : ""}`,
    });
    c.read.recentMeets.slice(0, 4).forEach((m, i) =>
      out.push({
        id: `C${n}-M${i + 1}`,
        kind: "competitor_meet",
        competitorId: c.id,
        date: m.date,
        text: `${c.name}: ${meetLine(m)}`,
      }),
    );
    c.read.observationsUsed.slice(0, 6).forEach((o, i) =>
      out.push({
        id: `C${n}-O${i + 1}`,
        kind: "competitor_training",
        competitorId: c.id,
        lift: o.lift,
        date: o.date,
        text: `${c.name} ${o.date}: ${o.exercise} ${o.loadKg} kg × ${o.reps}${o.rpe != null ? ` @ ${o.rpe}` : ""}${o.velocity ? `, ${o.velocity} m/s` : ""} (${o.standard}, from ${o.source}${o.technique ? `, ${o.technique}` : ""})`,
      }),
    );
  });
  for (const alt of b.classOptions ?? [])
    out.push({
      id: `ALT-${alt.weightClass.replace(/[^0-9+]/g, "")}`,
      kind: "field",
      text: `The ${alt.weightClass} kg class (${alt.reason}): ${alt.lifters
        .map((l) => `${l.name} ${l.total} kg (${l.date})`)
        .join("; ")}${alt.ourPlace != null ? `; our expected total would place about ${alt.ourPlace}` : ""}`,
    });
  if (b.landscape.ranked.length)
    out.push({
      id: "FIELD",
      kind: "field",
      text: `Win ${b.landscape.toWin ?? "–"} kg, podium ${b.landscape.toPodium ?? "–"} kg, projected place ${b.landscape.place ? `${b.landscape.place.expected} (${b.landscape.place.best}–${b.landscape.place.worst})` : "–"}`,
    });
  return out;
}

/** The lifts in one meet that a proposal can line up against (a helper for the UI). */
export function meetLifts(m: MeetRecord): Record<Lift, number | null> {
  return { squat: liftAt(m, "squat"), bench: liftAt(m, "bench"), deadlift: liftAt(m, "deadlift") };
}
