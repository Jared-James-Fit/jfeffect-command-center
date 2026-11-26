/**
 * What every Cleo workflow knows about a client's goals, and how it reasons
 * about training (Nov 26 2026). One text form of the goal ledger
 * (`goalsText`) for every AI context that plans or talks about a client
 * (Cleo's client conversations and specialty docks through clientIntelText,
 * Generate Next Program and Adjust program through the Program Intelligence
 * brief, Competition Intelligence's brief, meeting prep), and one set of
 * rules (`COACHING_ANALYSIS_RULES`, `GOAL_RULES`) so they all read it the same
 * way. Pure.
 *
 * The analysis rules describe how an elite strength and physique coach
 * reasons from an athlete's own data. They name no coach and attribute no
 * method to anyone: depth of analysis, never borrowed authority.
 */
import { APPROACH_LABEL, fmtClientTarget, fmtWeight, KIND_WORD, type GoalRow, type Unit } from "./types";

export const COACHING_ANALYSIS_RULES = [
  "COACHING ANALYSIS (how to reason about this athlete; never name or attribute a method to any coach):",
  "- Their own evidence first: how THIS athlete has responded (which blocks moved which lift, at what volume, intensity and frequency, how they recover, how their meets compared with training) outranks any general rule. A general rule is a starting point only where they have no history.",
  "- Read strength from comparable work: an e1RM from an RPE 7+ set of 10 reps or fewer, a held line through a deload or taper (not strength lost), bar speed at the same load and reps against their own earlier sets. One great or awful session is a session, not a trend; two or more pointing the same way is a pattern.",
  "- Separate what's established (seen across 2+ blocks or meets) from a hypothesis (one block, one meet, a plausible cause) and say which is which. Challenge the obvious explanation: a stalled lift can be technique, specificity, fatigue, frequency, effort calibration, bodyweight or life, not just 'needs more volume'. Find why before adding work.",
  "- Volume, intensity, frequency and specificity are the levers: specificity rises toward a meet; heavy singles and competition commands belong in the last weeks; fatigue is managed so the athlete arrives fresh; volume is redistributed before it's added. For hypertrophy: hard sets close to failure, a full range with a loaded stretch, enough weekly sets per muscle for their level, progression over months, and exercises stable enough that the target muscle limits the set.",
  "- Bodyweight and nutrition: judge the trend (a least-squares line, not one weigh-in); a class is made fed and hydrated, never by dehydration; a cut costs strength faster than it costs fat past the safe pace; protein and a training-day carb intake protect performance.",
  "- Push, pull back or hold: push when the evidence says they're adapting and recovering (lines rising, RPE at a load falling, sessions done); pull back when the lower lifts drop with sleep, energy or pain flags, or loads run 1.5+ RPE over what's written; hold when the plan is working. Holding is the most common right answer: never change a working plan for the sake of change.",
  "- Time left decides what's possible: weeks to a meet or deadline, minus the taper, at the rate they've actually shown, not the rate that would be convenient.",
].join("\n");

export const GOAL_RULES = [
  "GOALS (the goal ledger; read GOALS below):",
  "- Keep three numbers apart and say which is which: the client's own target (what they said), Cleo's projection (computed from their records; an interpretation), and the coach-approved target (the only one to plan around). Never present a projection or a client's wish as approved.",
  "- Feasibility is the app's score out of 100 for where a target sits in the athlete's own projected range, with its confidence said separately. It is not a probability: never turn it into odds or a percent chance.",
  "- Plan programming, attempts, peaking, nutrition and cardio toward APPROVED targets. When an approved target and the projection disagree, say so briefly and offer the options (change the programming, change the target, or keep the plan); never quietly rewrite what the coach approved.",
  "- A goal with no number stays in words. Never invent a number, a unit or a date for one. A unit marked inferred needs the coach to confirm it before it decides anything.",
  "- Keep explanations short (a line), and expand into the reasoning only when asked.",
].join("\n");

const dayWords = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

/** One goal in a line an AI reads, the three numbers labelled. */
export function goalLine(g: GoalRow, unit: Unit): string {
  const parts: string[] = [];
  parts.push(`${g.title}${g.deadline && !/ by /.test(g.title) ? ` (${dayWords(g.deadline)})` : ""}`);
  const said = fmtClientTarget(g);
  if (said) parts.push(`${g.source_speaker === "coach" ? "coach discussed" : g.source_speaker === "unclear" ? "speaker unconfirmed, discussed" : "client said"}: ${said}${g.client_unit_source === "inferred" ? " (unit inferred, unconfirmed)" : ""}${g.tentative ? " (tentative)" : ""}`);
  if (g.status === "active") {
    if (g.approved_kg != null) parts.push(`APPROVED: ${fmtWeight(Number(g.approved_kg), unit)}${g.approved_approach ? ` (${APPROACH_LABEL[g.approved_approach]})` : ""}`);
    else if (g.approved_text) parts.push(`APPROVED: ${g.approved_text}`);
    else parts.push("approved (no number)");
  } else if (g.status === "proposed") parts.push("not reviewed by the coach yet");
  else parts.push(g.status);
  if (g.source_kind) parts.push(`source: ${g.source_kind}${g.source_at ? ` ${g.source_at.slice(0, 10)}` : ""}${g.source_speaker ? ` (${g.source_speaker})` : ""}${g.source_quote ? ` — “${g.source_quote.slice(0, 240)}”` : g.source_context ? ` — ${g.source_context.slice(0, 240)}` : ""}`);
  const f = g.feasibility;
  if (f?.projection) parts.push(`projection (interpretation): ${fmtWeight(f.projection.expectedKg, unit)} (${fmtWeight(f.projection.lowKg, unit)}–${fmtWeight(f.projection.highKg, unit)}), ${f.confidence} confidence`);
  if (f?.score != null) parts.push(`feasibility ${f.score}/100`);
  if (f?.nowKg != null && (g.kind === "lift" || g.kind === "total" || g.kind === "bodyweight")) parts.push(`now ${fmtWeight(f.nowKg, unit)}`);
  if (f?.action && f.action.kind !== "none" && f.action.kind !== "approve") parts.push(`read: ${f.action.line}`);
  if (g.recommendation_status === "dismissed" || g.recommendation_status === "maintained") parts.push(`coach decided: ${g.recommendation_status === "maintained" ? "keep the plan" : "not this advice"}`);
  if (g.outcome) parts.push(`outcome: ${g.outcome.result}${g.outcome.actualKg != null ? ` (${fmtWeight(g.outcome.actualKg, unit)})` : ""}`);
  return `- [${KIND_WORD[g.kind]}] ${parts.join(" · ")}`;
}

/** The goal ledger as text: open goals first (approved, then waiting on the coach), then recent outcomes. */
export function goalsText(goals: GoalRow[], unit: Unit, opts: { outcomes?: boolean } = {}): string | null {
  const open = goals.filter((g) => g.status === "active" || g.status === "proposed");
  const done = opts.outcomes === false ? [] : goals.filter((g) => g.status === "achieved" || g.status === "missed").slice(0, 4);
  if (!open.length && !done.length) return null;
  const order = (g: GoalRow) => (g.status === "active" ? 0 : 1);
  return [...open.sort((a, b) => order(a) - order(b)), ...done].map((g) => goalLine(g, unit)).join("\n");
}
