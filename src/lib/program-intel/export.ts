/**
 * Program Intelligence exports (pure): Markdown for reading or uploading to an
 * AI, JSON with every record, CSV with every logged set, and one paste-ready
 * AI coaching prompt. Nothing is condensed away: every prescribed exercise and
 * every logged set in scope is written out, prescribed training kept apart
 * from what was actually done, and measured facts kept apart from hypotheses.
 */
import { BRAIN_SUMMARY } from "./brains";
import { ANALYSIS_METHOD } from "./methods";
import { LB_PER_KG, fmtLoad, fmtSet, round } from "./core";
import { BRAIN_LABEL, LIFTS, type Finding, type IntelRecords, type IntelReport, type RowCompare, type SetLine, type Unit } from "./types";

export const EXPORT_SCHEMA = "jfeffect.program-intelligence/v1";
export const PROMPT_VERSION = 1;

// ── Privacy-safe copies ──────────────────────────────────────────────────────

const REMOVED = "[removed for privacy]";

function nameParts(full: string | null): string[] {
  return (full ?? "")
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}'-]/gu, ""))
    .filter((p) => p.length >= 3);
}

/** Replace the athlete's name (full, first, last) anywhere in a string. */
export function scrubName(text: string | null | undefined, full: string | null): string | null {
  if (text == null) return null;
  let out = text;
  const parts = [full ?? "", ...nameParts(full)].filter((p) => p.trim().length >= 3).sort((a, b) => b.length - a.length);
  for (const p of parts) out = out.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "Athlete");
  return out;
}

/**
 * The records with what identifies the athlete taken out: their name (in
 * every text), lifestyle notes, coach file notes and everything they typed
 * (set, workout, exercise and pain notes). Training data, goals and the
 * coach's program are kept.
 */
export function privacySafeRecords(rec: IntelRecords): IntelRecords {
  const full = rec.client.full_name;
  const s = (t: string | null | undefined) => scrubName(t, full);
  const blank = (t: string | null | undefined) => (t?.trim() ? REMOVED : null);
  return {
    ...rec,
    client: { ...rec.client, id: "athlete", full_name: "Athlete", coach_notes: s(rec.client.coach_notes), goals: s(rec.client.goals), injuries: s(rec.client.injuries), training_notes: s(rec.client.training_notes), lifestyle_notes: blank(rec.client.lifestyle_notes) },
    goals: rec.goals ? { ...rec.goals, main_goal: s(rec.goals.main_goal), main_goal_other: s(rec.goals.main_goal_other), goal_target: s(rec.goals.goal_target), injuries_details: s(rec.goals.injuries_details), final_notes: blank(rec.goals.final_notes) } : null,
    preps: rec.preps.map((p) => ({ ...p, title: s(p.title), coach_notes: s(p.coach_notes) })),
    blocks: rec.blocks.map((b) => ({ ...b, name: s(b.name), coach_notes: s(b.coach_notes) })),
    days: rec.days.map((d) => ({ ...d, title: s(d.title), notes: s(d.notes) })),
    rows: rec.rows.map((r) => ({ ...r, notes: s(r.notes) })),
    results: rec.results.map((r) => ({ ...r, notes: blank(r.notes) })),
    completions: rec.completions.map((c) => ({ ...c, client_notes: blank(c.client_notes) })),
    feedback: rec.feedback.map((f) => ({ ...f, pain_note: blank(f.pain_note), client_note: blank(f.client_note) })),
    exerciseNotes: rec.exerciseNotes.map((n) => ({ ...n, content: blank(n.content) })),
    fileNotes: [],
    observations: rec.observations.map((o) => ({ ...o, statement: s(o.statement) as string, corrected_statement: s(o.corrected_statement) })),
    meets: rec.meets.map((m) => ({ ...m, meet_name: s(m.meet_name) })),
    checkins: [],
    profile: rec.profile ? { ...rec.profile, equipment_profile: rec.profile.equipment_profile ? { ...rec.profile.equipment_profile, notes: s(rec.profile.equipment_profile.notes) } : null } : rec.profile,
    unreadable: rec.unreadable,
  };
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const KIND_TAG: Record<Finding["kind"], string> = { fact: "FACT", hypothesis: "HYPOTHESIS", missing: "MISSING DATA" };
const AREA_TITLE: Record<Finding["area"], string> = {
  improved: "What improved",
  stalled: "What stalled or went backwards",
  change: "What may need changing",
  next: "For programming the next cycle",
  missing: "Missing or incomplete information",
};
const AREAS: Finding["area"][] = ["improved", "stalled", "change", "next", "missing"];

function loadIn(kg: number | null | undefined, unit: Unit): string {
  return kg == null ? "—" : fmtLoad(kg, unit);
}
function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${n}%`;
}
function mdCell(v: unknown): string {
  return String(v ?? "—").replace(/\|/g, "/").replace(/\n+/g, " ");
}
function table(head: string[], rows: unknown[][]): string {
  if (!rows.length) return "_None in this period._\n";
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n") + "\n";
}

export function prescriptionText(p: RowCompare["prescribed"], unit: Unit): string {
  const parts: string[] = [];
  parts.push(`${p.sets ?? "?"}×${p.reps ?? "?"}`);
  if (p.rpe) parts.push(`@RPE ${p.rpe}`);
  if (p.rir) parts.push(`${p.rir} RIR`);
  if (p.percentage != null) parts.push(`${p.percentage}%`);
  if (p.loadKg != null) parts.push(loadIn(p.loadKg, unit));
  if (p.tempo) parts.push(`tempo ${p.tempo}`);
  if (p.restSeconds) parts.push(`rest ${p.restSeconds}s`);
  if (p.setBlocks.length) parts.push(`[${p.setBlocks.map((b) => [b.type, b.sets != null ? `${b.sets}×${b.reps ?? "?"}` : null, b.rpe ? `@${b.rpe}` : null, b.load].filter(Boolean).join(" ")).join("; ")}]`);
  return parts.join(" ");
}

export function actualText(sets: SetLine[], unit: Unit): string {
  const logged = sets.filter((s) => s.logged);
  if (!logged.length) return "nothing logged";
  return logged.map((s) => `S${s.setIndex} ${fmtSet(s, unit)}${s.working ? "" : " (warm-up)"}${s.notes ? ` "${s.notes}"` : ""}`).join(", ");
}

// ── Markdown ─────────────────────────────────────────────────────────────────

export type ExportMeta = { privacySafe: boolean; reportId?: string | null; exportedBy?: string | null };

export function reportToMarkdown(report: IntelReport, rec: IntelRecords, meta: ExportMeta): string {
  const u = report.client.unit;
  const c = report.coverage;
  const out: string[] = [];
  out.push(`# Program Intelligence: ${report.client.name}`);
  out.push("");
  out.push(`- Scope: ${report.scope.label}${report.scope.from || report.scope.to ? ` (${report.scope.from ?? "start"} → ${report.scope.to ?? "now"})` : ""}`);
  out.push(`- Training dates in scope: ${c.firstDate ?? "—"} → ${c.lastDate ?? "—"} · today ${rec.today}`);
  out.push(`- Coaching brain: ${BRAIN_LABEL[report.brain]} (${report.brainSource === "override" ? "chosen by the coach" : "classified from the data"})`);
  out.push(`- Generated ${report.generatedAt} · data fingerprint ${report.dataHash} · report v${report.version}${meta.reportId ? ` · export ${meta.reportId}` : ""}`);
  out.push(`- Units: loads in ${u}; e1RM = Epley-style estimate from logged load × (reps + reps in reserve)${rec.settings.e1rmFormula === "brzycki" ? " (Brzycki)" : ""}`);
  if (meta.privacySafe) out.push(`- Privacy-safe export: the athlete's name and personal notes are removed.`);
  out.push("");
  out.push(`## How to read this`);
  out.push(`- **Prescribed** is what the coach programmed; **Actual** is what was logged. They are listed separately for every exercise.`);
  out.push(`- **[FACT]** is measured directly from the records (the records are named). **[HYPOTHESIS]** is an interpretation of those facts, not a proven response. **[MISSING DATA]** is what the records can't tell.`);
  out.push("");
  out.push(`## Classification`);
  out.push(`${BRAIN_SUMMARY[report.brain]}`);
  out.push(`Auto-classified as ${BRAIN_LABEL[report.classification.auto]} (powerlifting ${report.classification.scores.powerlifting}, bodybuilding ${report.classification.scores.bodybuilding}). Signals:`);
  for (const r of report.classification.reasons) out.push(`- ${r}`);
  out.push("");
  out.push(`## Data coverage`);
  out.push(
    table(
      ["Measure", "Count"],
      [
        ["Blocks / weeks", `${c.blocks} / ${c.weeks}`],
        ["Workouts planned", c.plannedDays],
        ["Due (finished / partly logged / missed)", `${c.dueDays} (${c.completedDays} / ${c.partialDays} / ${c.missedDays})`],
        ["Upcoming / undated", `${c.upcomingDays} / ${c.unscheduledDays}`],
        ["Prescribed exercises", c.prescribedRows],
        ["Prescribed sets due", c.prescribedSetsDue],
        ["Prescribed sets completed (per exercise, up to the prescribed count)", c.completedSets],
        ["Skipped sets (exercise not logged) / incomplete (exercise cut short)", `${c.skippedSets} / ${c.incompleteSets}`],
        ["Extra sets beyond the prescription / done outside the rep range", `${c.extraSets} / ${c.modifiedSets}`],
        ["Logged set records (all) / not counted (warm-up flag, no reps)", `${c.loggedSets} / ${c.nonCountedRecords}`],
        ["Working sets (done, at or above the effort floor)", c.workingSets],
        ["Sets with a load / with an RPE or RIR", `${c.setsWithLoad} / ${c.setsWithRpe}`],
        ["RPE or RIR logged on done sets", pct(c.setsWithRpePct)],
        ["Sets with bar velocity", c.setsWithVelocity],
        ["Exercises not linked to the library", c.unmappedRows],
        ["Post-workout check-outs", c.feedbackEntries],
        ["Exercise notes / coach notes", `${c.exerciseNotes} / ${c.coachNotes}`],
        ["Bodyweight entries / maxes on file / meet results", `${c.bodyweightEntries} / ${c.maxesOnFile} / ${c.meetResults}`],
        ["Couldn't read", c.unreadable.join(", ") || "nothing"],
      ],
    ),
  );
  out.push(`Every record in scope is included below; nothing is truncated.`);
  out.push("");
  for (const area of AREAS) {
    const list = report.findings.filter((f) => f.area === area);
    if (!list.length) continue;
    out.push(`## ${AREA_TITLE[area]}`);
    for (const f of list) {
      out.push(`- **[${KIND_TAG[f.kind]}]** ${f.title}. ${f.detail}`);
      for (const e of f.evidence) out.push(`  - evidence: ${e}`);
    }
    out.push("");
  }
  const memory = rec.observations.filter((o) => o.status !== "rejected");
  if (memory.length) {
    out.push(`## Athlete memory (earlier observations and decisions)`);
    for (const o of memory) {
      const state = o.status === "proposed" ? "PROPOSED, not yet reviewed" : o.status === "corrected" ? "CORRECTED by the coach" : "APPROVED by the coach";
      out.push(`- [${o.kind.toUpperCase()} · ${o.confidence === "fact" ? "FACT" : "HYPOTHESIS"} · ${state}] ${o.corrected_statement ?? o.statement} (${o.created_at.slice(0, 10)}, from ${o.source})`);
    }
    out.push("");
  }
  out.push(`## Weekly training (measured)`);
  out.push(
    table(
      ["Week", "Dates", "Phase", "Sessions done/due", "Sets done/due", "Set adherence", "Hard sets", "Avg RPE", "RPE vs target", "Tonnage", ...LIFTS.map((l) => `${l} sets / top e1RM`)],
      report.weeks.map((w) => [
        `${w.label} ${w.blockName}`,
        `${w.start ?? "?"} → ${w.end ?? "?"}`,
        w.phase,
        `${w.completedDays + w.partialDays}/${w.dueDays}`,
        `${w.completedSets}/${w.prescribedSetsDue}`,
        pct(w.setAdherencePct),
        w.hardSets,
        w.avgRpe,
        w.avgRpeDelta,
        loadIn(w.tonnageKg, u),
        ...LIFTS.map((l) => `${w.lifts[l].sets} / ${loadIn(w.lifts[l].topE1rm, u)}`),
      ]),
    ),
  );
  out.push(`## Competition lifts`);
  for (const L of report.lifts) {
    out.push(`### ${L.lift[0].toUpperCase() + L.lift.slice(1)}${L.competitionExercise ? ` (${L.competitionExercise})` : ""}`);
    out.push(
      `- e1RM (competition): ${loadIn(L.compTrend.first, u)} → ${loadIn(L.compTrend.last, u)} (${L.compTrend.changePct ?? "—"}%), peak ${loadIn(L.compTrend.peak, u)}, slope ${L.compTrend.slopePerWeek != null ? `${u === "lb" ? round(L.compTrend.slopePerWeek * LB_PER_KG, 1) : L.compTrend.slopePerWeek}${u}/week` : "—"}${L.stalled ? " · STALLED (no new best in 3 exposures)" : ""}`,
    );
    out.push(`- Frequency ${L.frequencyPerWeek ?? "—"}×/week · ${L.setsPerWeek ?? "—"} working sets/week · ${L.repsPerWeek ?? "—"} reps/week · ${loadIn(L.tonnagePerWeekKg, u)}/week`);
    out.push(`- Average load ${L.avgRelativeIntensityPct ?? "—"}% of best e1RM · RPE <7: ${L.rpeBuckets.easy}, 7–8.5: ${L.rpeBuckets.moderate}, 9+: ${L.rpeBuckets.hard}, not rated: ${L.rpeBuckets.unknown} · reps 1–3: ${L.repBuckets.r1_3}, 4–6: ${L.repBuckets.r4_6}, 7–10: ${L.repBuckets.r7_10}, 11+: ${L.repBuckets.r11p}`);
    out.push(`- RPE vs prescribed: ${L.avgRpeDelta ?? "—"} · heavy singles (≥85% e1RM): ${L.heavySingles} · back-off sets done: ${pct(L.backoffCompletionPct)} · max on file: ${loadIn(L.maxOnFileKg, u)} · best meet: ${loadIn(L.bestMeetKg, u)}`);
    if (L.exposures.length)
      out.push(table(["Date", "Week", "Exercise", "Comp", "Top set", "e1RM", "Working sets", "Back-offs", "Avg RPE", "Target RPE"], L.exposures.map((e) => [e.date, report.weeks.find((w) => w.key === e.weekKey)?.label, e.exercise, e.competition ? "yes" : "", fmtSet(e.topSet, u), loadIn(e.e1rm, u), e.workingSets, e.backoffSets, e.avgRpe, e.prescribedRpe])));
    if (L.variations.length)
      out.push(table(["Variation", "Exposures", "Weeks", "e1RM first → last", "Comp lift change over the same weeks"], L.variations.map((v) => [v.exercise, v.exposures, v.weeks.join(", "), `${loadIn(v.trend.first, u)} → ${loadIn(v.trend.last, u)}`, v.compChangeDuringPct != null ? `${v.compChangeDuringPct}% (association, not proof)` : "—"])));
  }
  out.push(`## Hard sets per muscle group (primary 1.0, secondary 0.5)`);
  out.push(table(["Muscle", "Avg sets/week", "First half → second half", "Frequency/week", "Target", "Exercises"], report.muscles.map((m) => [m.muscle, m.avgHardSetsPerWeek, `${m.firstHalfAvg ?? "—"} → ${m.secondHalfAvg ?? "—"}`, m.frequencyPerWeek, m.target ? `${m.target.mev ?? "?"}–${m.target.mrv ?? "?"} (${m.status})` : "none set", m.exercises.join(", ")])));
  out.push(`## Exercises`);
  out.push(table(["Exercise", "Lift", "Exposures", "Sets logged/due", "e1RM first → last", "Best set", "Avg RPE", "Stalled", "Blocks", "Last done"], report.exercises.map((e) => [e.name + (e.exerciseId ? "" : " (not in library)"), e.lift ?? "", e.exposures, `${e.workingSetsLogged}/${e.setsPrescribedDue}`, e.trend.first != null ? `${loadIn(e.trend.first, u)} → ${loadIn(e.trend.last, u)} (${e.trend.changePct ?? "—"}%)` : e.repsTrend ? `reps ${e.repsTrend.first} → ${e.repsTrend.last}` : "—", fmtSet(e.bestSet, u), e.avgRpe, e.stalled ? "yes" : "", e.blocks.join(" "), e.lastDate])));
  out.push(`## Blocks and how the athlete responded`);
  out.push(table(["Block", "Dates", "Focus", "Sessions", "Sets", "Hard sets/wk", "Avg RPE", "RPE vs target", ...LIFTS.map((l) => `${l} e1RM`), "Top muscles", "Pain reports"], report.blocks.map((b) => [`B${b.number} ${b.name}${b.hidden ? " (hidden)" : ""}${b.archived ? " (archived)" : ""}`, `${b.start ?? "?"} → ${b.end ?? "?"}`, b.focus ?? b.goal, pct(b.sessionAdherencePct), pct(b.setAdherencePct), b.avgHardSetsPerWeek, b.avgRpe, b.avgRpeDelta, ...LIFTS.map((l) => (b.liftChange[l].changePct != null ? `${loadIn(b.liftChange[l].fromKg, u)} → ${loadIn(b.liftChange[l].toKg, u)} (${b.liftChange[l].changePct}%)` : "—")), b.topMuscles.map((m) => `${m.muscle} ${m.setsPerWeek}`).join(", "), b.painReports])));
  out.push(`## Recovery (post-workout check-outs)`);
  out.push(`- Session RPE ${report.recovery.sessionRpeAvg ?? "—"} · rating ${report.recovery.ratingAvg ?? "—"} · fatigue ${JSON.stringify(report.recovery.fatigue)} · sleep ${JSON.stringify(report.recovery.sleep)}`);
  for (const p of report.recovery.painReports) out.push(`- Pain ${p.date ?? "?"}: ${p.area ?? "?"} level ${p.level ?? "?"}${p.note ? ` "${p.note}"` : ""}`);
  out.push(`- Bodyweight: ${report.bodyweight.entries ? `${loadIn(report.bodyweight.first, u)} → ${loadIn(report.bodyweight.last, u)} (${report.bodyweight.entries} entries)` : "no entries"}`);
  out.push("");
  out.push(`## Athlete context`);
  const g = rec.goals;
  out.push(`- Goals & Setup: ${g ? [g.main_goal, g.main_goal_other, g.goal_target && `target: ${g.goal_target}`, g.training_days_per_week && `${g.training_days_per_week} days/week`, g.workout_length_minutes && `${g.workout_length_minutes} min sessions`, g.training_experience && `experience: ${g.training_experience}`, g.training_styles?.length && `styles: ${g.training_styles.join(", ")}`, g.training_location && `location: ${g.training_location}`, g.equipment?.length && `equipment: ${g.equipment.join(", ")}`, g.injuries_has && `injuries: ${g.injuries_details ?? "yes"}`].filter(Boolean).join(" · ") : "not on file"}`);
  for (const [k, v] of [["Client goals", rec.client.goals], ["Injuries", rec.client.injuries], ["Training notes", rec.client.training_notes], ["Coach notes", rec.client.coach_notes], ["Lifestyle notes", rec.client.lifestyle_notes]] as const) if (v?.trim()) out.push(`- ${k}: ${v.trim()}`);
  for (const p of rec.preps) out.push(`- Program / meet prep: ${[p.title, p.goal_type, p.event_name, p.event_date, p.federation, p.weight_class && `${p.weight_class} class`, p.status].filter(Boolean).join(" · ")}${p.coach_notes ? ` · notes: ${p.coach_notes}` : ""}`);
  for (const m of rec.maxes) out.push(`- Max on file: ${m.lift ?? "?"} ${m.one_rm ?? m.estimated_1rm ?? "?"}${m.unit ?? ""}${m.training_max ? ` (TM ${m.training_max})` : ""}${m.tested_at ? ` tested ${m.tested_at}` : ""}${m.active === false ? " (inactive)" : ""}`);
  for (const m of rec.meets) out.push(`- Meet result: ${m.meet_date ?? "?"} ${m.meet_name ?? ""} · ${m.squat_kg ?? "?"}/${m.bench_kg ?? "?"}/${m.deadlift_kg ?? "?"} = ${m.total_kg ?? "?"}kg at ${m.bodyweight_kg ?? "?"}kg bw${m.federation ? ` (${m.federation})` : ""}`);
  for (const n of rec.fileNotes) out.push(`- Coach file note (${n.created_at?.slice(0, 10) ?? "?"}): ${[n.title, n.body].filter(Boolean).join(": ")}`);
  for (const b of rec.blocks) if (b.coach_notes?.trim()) out.push(`- Block note (${b.name}): ${b.coach_notes.trim()}`);
  out.push("");
  out.push(trainingLogMarkdown(report));
  out.push("");
  return out.join("\n");
}

/** Every workout in a report, prescribed vs actual, set by set (the part of the report that's never summarized). */
export function trainingLogMarkdown(report: IntelReport): string {
  const u = report.client.unit;
  const out: string[] = [];
  out.push(`## Full training log: prescribed vs actual`);
  out.push(`Every workout in scope, in program order. "Prescribed" is the coach's prescription; "Actual" lists each logged set (load×reps @RPE). Status: done = every prescribed set logged; partial; skipped = nothing logged on a due day.`);
  let lastWeek = "";
  for (const d of report.days) {
    if (d.weekKey !== lastWeek) {
      const w = report.weeks.find((x) => x.key === d.weekKey);
      out.push("");
      out.push(`### ${w?.label ?? d.weekKey} · ${w?.blockName ?? ""}${w?.phase ? ` · ${w.phase}` : ""}`);
      lastWeek = d.weekKey;
    }
    out.push(`#### Day ${d.dayIndex}: ${d.title} · ${d.date ?? "no date"} · ${d.status.toUpperCase()}${d.durationMin ? ` · ${d.durationMin} min` : ""}${d.sessionRating ? ` · rating ${d.sessionRating}` : ""}`);
    if (d.feedback) out.push(`- Check-out: session RPE ${d.feedback.session_rpe ?? "—"}, fatigue ${d.feedback.fatigue_feel ?? "—"}, sleep ${d.feedback.sleep_bucket ?? "—"}${d.feedback.pain ? `, PAIN ${d.feedback.pain_area ?? ""} ${d.feedback.pain_level ?? ""}${d.feedback.pain_note ? ` "${d.feedback.pain_note}"` : ""}` : ""}${d.feedback.client_note ? `, note "${d.feedback.client_note}"` : ""}`);
    if (d.clientNotes) out.push(`- Workout note: "${d.clientNotes}"`);
    for (const r of d.rows) {
      out.push(`- ${r.exercise}${r.role ? ` [${r.role}]` : ""}${r.exerciseId ? "" : " (not in library)"} · ${r.status}`);
      out.push(`  - Prescribed: ${prescriptionText(r.prescribed, u)}${r.prescribed.notes ? ` · coach note: "${r.prescribed.notes}"` : ""}`);
      out.push(`  - Actual: ${actualText(r.actual, u)}${r.warmups ? ` · ${r.warmups} logged warm-up set${r.warmups === 1 ? "" : "s"}` : ""}`);
      if (r.rpeDelta != null || r.repsHitPct != null || r.bestE1rm != null) out.push(`  - Measured: ${[r.repsHitPct != null ? `reps hit on ${r.repsHitPct}% of sets` : null, r.rpeDelta != null ? `RPE ${r.rpeDelta > 0 ? "+" : ""}${r.rpeDelta} vs target` : null, r.loadDeltaKg != null ? `load ${loadIn(Math.abs(r.loadDeltaKg), u)} ${r.loadDeltaKg >= 0 ? "over" : "under"} prescribed` : null, r.bestE1rm != null ? `best e1RM ${loadIn(r.bestE1rm, u)}` : null].filter(Boolean).join(" · ")}`);
      for (const n of r.clientNotes) out.push(`  - Athlete note: "${n}"`);
    }
  }
  return out.join("\n");
}

// ── AI coaching prompt ────────────────────────────────────────────────────────

const BRAIN_METHOD = ANALYSIS_METHOD;

export function buildAiPrompt(report: IntelReport, rec: IntelRecords, meta: ExportMeta): string {
  const brain = BRAIN_LABEL[report.brain];
  return [
    `You are an elite ${brain.toLowerCase()} coach designing ${report.client.name}'s next training cycle from their real training records.`,
    ``,
    `## Your task`,
    `1. Read the report and the full log below. Use only what the records show; do not invent results.`,
    `2. Separate clearly: FACTS (measured from the records, cite them), HYPOTHESES (your interpretations, labelled as such) and MISSING information (what you'd want to know).`,
    `3. ${BRAIN_METHOD[report.brain]}`,
    `4. Design the next program for this individual, based on how they actually responded, not a generic template: training blocks, weeks, days, exercises, sets, reps, intensity (RPE/RIR or % of e1RM), rest, the progression from week to week, and the recovery / deload strategy.`,
    `5. Prefer exercises from the athlete's own history (listed below) where they progressed; name any new exercise exactly as it is commonly known so it can be matched to the existing exercise library.`,
    `6. For every meaningful change from the previous program, explain why, citing the evidence (week, exercise, numbers) and saying whether it rests on a fact or a hypothesis.`,
    `7. Respect the athlete's stated schedule, session length, equipment and injuries.`,
    ``,
    `## Output format`,
    `- Summary of what the records show (facts) and your reading of them (hypotheses).`,
    `- The program: for each block → week → day → exercise: sets × reps @ intensity, rest, notes.`,
    `- Progression and recovery strategy.`,
    `- Changes and why (with evidence).`,
    `- What to watch / re-test, and what information is missing.`,
    ``,
    `Units: loads in ${report.client.unit}. Prompt version ${PROMPT_VERSION}.`,
    ``,
    `---`,
    ``,
    reportToMarkdown(report, rec, meta),
  ].join("\n");
}

// ── JSON ─────────────────────────────────────────────────────────────────────

export function reportToJson(report: IntelReport, rec: IntelRecords, meta: ExportMeta): string {
  const { days, ...measured } = report;
  return JSON.stringify(
    {
      schema: EXPORT_SCHEMA,
      exported: { at: new Date().toISOString(), privacySafe: meta.privacySafe, reportId: meta.reportId ?? null },
      notes: {
        prescribed_vs_actual: "Each day lists its prescribed exercises (prescribed) and every logged set (actual) separately.",
        findings: "kind = fact (measured, evidence named) | hypothesis (interpretation, not proven) | missing (not in the records).",
        units: "All loads are kilograms (kg) in this file; e1RM in kg.",
      },
      report: measured,
      prescribed_vs_actual: days,
      records: rec,
    },
    null,
    2,
  );
}

// ── CSV (raw training log) ───────────────────────────────────────────────────

export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "block_number", "block", "week", "week_label", "phase", "day_index", "day_title", "date", "day_status",
  "exercise", "exercise_id", "lift", "competition_lift", "role", "row_status",
  "prescribed_sets", "prescribed_reps", "prescribed_rpe", "prescribed_rir", "prescribed_pct", "prescribed_load_kg", "prescribed_tempo", "prescribed_rest_s", "prescribed_notes",
  "set_index", "load_type", "load_kg", "load_lb", "reps", "rpe", "rir", "e1rm_kg", "working_set", "hard_set", "logged_on", "set_notes",
] as const;

/** One line per logged set, plus one line for each prescribed exercise with nothing logged (so skipped work is visible). */
export function reportToCsv(report: IntelReport): string {
  const lines = [CSV_COLUMNS.join(",")];
  const weekOf = new Map(report.weeks.map((w) => [w.key, w]));
  for (const d of report.days) {
    const w = weekOf.get(d.weekKey);
    for (const r of d.rows) {
      const base = [w?.blockNumber, w?.blockName, w?.weekIndex, w?.label, w?.phase, d.dayIndex, d.title, d.date, d.status, r.exercise, r.exerciseId, r.lift, r.competition ? "yes" : "no", r.role, r.status, r.prescribed.sets, r.prescribed.reps, r.prescribed.rpe, r.prescribed.rir, r.prescribed.percentage, r.prescribed.loadKg, r.prescribed.tempo, r.prescribed.restSeconds, r.prescribed.notes];
      const logged = r.actual.filter((s) => s.logged);
      if (!logged.length) lines.push([...base, "", "", "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(","));
      for (const s of logged)
        lines.push([...base, s.setIndex, s.loadType, s.kg, s.kg != null ? round(s.kg * LB_PER_KG, 1) : null, s.reps, s.rpe, s.rir, s.e1rm, s.working ? "yes" : "no", s.hard ? "yes" : "no", s.completedAt, s.notes].map(csvCell).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

/** A file name that never carries the athlete's name in a privacy-safe export. */
export function exportFileName(report: IntelReport, ext: string, privacySafe: boolean): string {
  const who = privacySafe ? "athlete" : report.client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "athlete";
  const date = report.generatedAt.slice(0, 10);
  return `program-intelligence-${who}-${date}.${ext}`;
}
