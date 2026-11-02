/**
 * Which programming framework (brain) fits an athlete: from their goals, a
 * meet on file, how the program actually spends its sets, the coach's notes
 * and the roadmap's own reading of each block. Deterministic, every signal
 * that fired listed as a reason; the coach can always override it.
 *
 * A program is never called bodybuilding just because it has hypertrophy
 * accessories: where the main barbell lifts lead each session in strength rep
 * ranges and the accessories are hypertrophy work, it's powerbuilding.
 */
import { repRange } from "./core";
import type { Brain, Classification, IntelRecords } from "./types";

const PL_WORDS = /powerlift|\bmeet\b|\btotal\b|compet|federation|\bipf\b|\bcpu\b|usapl|\bsbd\b|strength sport|\bpeak/i;
const BB_WORDS = /bodybuild|hypertroph|muscle|physique|aesthetic|\bsize\b|\bbulk|\bshow\b|\bstage\b|\bglute|\btone|\bbuild\b.*\bmuscle/i;
const STRENGTH_WORDS = /\bstrength\b|\bstronger\b|\bstrong\b/i;
const GF_WORDS = /fitness|health|lose weight|weight loss|fat loss|body fat|recomp|general|mobility|energy|longevity|feel better/i;
const HYBRID_WORDS = /hybrid|athlet|sport|conditioning|endurance|run(ning)?\b|hyrox|crossfit|marathon|speed|agility|jump|vertical/i;
const CONDITIONING_EX = /sprint|run\b|running|jog|row(ing)? erg|erg\b|bike|assault|airdyne|ski erg|sled|prowler|burpee|box jump|broad jump|jump|bound|plyo|med(icine)? ball|carry|farmer|conditioning|interval|emom|amrap|circuit|skipping|jump rope/i;

export function classifyProgram(rec: IntelRecords): Classification {
  let pl = 0;
  let bb = 0;
  let st = 0;
  let gf = 0;
  let hy = 0;
  const reasons: string[] = [];

  const goalText = [rec.goals?.main_goal, rec.goals?.main_goal_other, rec.goals?.goal_target, ...(rec.goals?.training_styles ?? []), rec.client.goals].filter(Boolean).join(" · ");
  if (goalText) {
    if (PL_WORDS.test(goalText)) { pl += 0.3; reasons.push(`Goals mention powerlifting / competing ("${clip(goalText)}")`); }
    if (BB_WORDS.test(goalText)) { bb += 0.25; reasons.push(`Goals mention muscle / physique ("${clip(goalText)}")`); }
    if (STRENGTH_WORDS.test(goalText)) { st += 0.2; reasons.push(`Goals mention strength ("${clip(goalText)}")`); }
    if (GF_WORDS.test(goalText)) { gf += 0.25; reasons.push(`Goals mention general fitness / body composition ("${clip(goalText)}")`); }
    if (HYBRID_WORDS.test(goalText)) { hy += 0.3; reasons.push(`Goals mention sport / conditioning ("${clip(goalText)}")`); }
  }
  if (rec.client.is_powerlifter) { pl += 0.15; reasons.push("Marked as a powerlifter on their client profile"); }
  const meet = rec.preps.find((p) => p.event_name || p.event_date || p.federation || /meet|compet/i.test(p.goal_type ?? ""));
  if (meet) { pl += 0.35; reasons.push(`A meet prep is on file (${[meet.event_name, meet.event_date, meet.federation].filter(Boolean).join(", ") || meet.title || "prep"})`); }
  if (rec.meets.length) { pl += 0.15; reasons.push(`${rec.meets.length} meet result${rec.meets.length === 1 ? "" : "s"} on file`); }

  // Where the prescribed sets go.
  const ex = new Map(rec.exercises.map((e) => [e.id, e]));
  let total = 0, comp = 0, sbdMain = 0, mainStrength = 0, low = 0, hyperAcc = 0, pct = 0, cond = 0;
  const firstRowOfDay = new Map<string, string>();
  for (const r of [...rec.rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) if (!firstRowOfDay.has(r.day_id)) firstRowOfDay.set(r.day_id, r.id);
  const leadIds = new Set(firstRowOfDay.values());
  let daysLedByBarbell = 0;
  for (const r of rec.rows) {
    const sets = r.sets ?? 0;
    if (!sets) continue;
    total += sets;
    const e = ex.get(r.exercise_id ?? "");
    const name = `${e?.name ?? r.exercise_name_override ?? ""}`;
    const fam = String(e?.movement_family ?? "").toLowerCase();
    const isComp = !!e && (e.is_competition_lift === true || !!e.competition_lift_type);
    const rr = repRange(r.reps_text);
    if (isComp) comp += sets;
    if (["squat", "bench", "deadlift"].includes(fam)) {
      sbdMain += sets;
      if (rr && rr[0] <= 6 && rr[1] <= 8) mainStrength += sets;
    }
    if (rr && rr[1] <= 5) low += sets;
    if (rr && rr[0] >= 6 && !["squat", "bench", "deadlift"].includes(fam)) hyperAcc += sets;
    if (r.percentage != null) pct += sets;
    if (CONDITIONING_EX.test(name) || r.measurement_type === "time" || r.measurement_type === "distance") cond += sets;
    if (leadIds.has(r.id) && ["squat", "bench", "deadlift"].includes(fam) && rr && rr[0] <= 6 && rr[1] <= 8) daysLedByBarbell++;
  }
  const dayCount = firstRowOfDay.size;
  if (total > 0) {
    const share = (n: number) => Math.round((n / total) * 100);
    if (comp / total >= 0.25) { pl += 0.3; reasons.push(`${share(comp)}% of prescribed sets are competition lifts`); }
    else if (comp / total >= 0.1) { pl += 0.15; st += 0.1; reasons.push(`${share(comp)}% of prescribed sets are competition lifts`); }
    if (low / total >= 0.35) { pl += 0.1; st += 0.1; reasons.push(`${share(low)}% of sets are 5 reps or fewer`); }
    if (pct / total >= 0.15) { pl += 0.1; reasons.push(`${share(pct)}% of sets are prescribed as a % of a max`); }
    if (mainStrength / total >= 0.15) { st += 0.25; reasons.push(`${share(mainStrength)}% of sets are squat / bench / deadlift patterns in strength rep ranges (≤8)`); }
    if (dayCount && daysLedByBarbell / dayCount >= 0.5) { st += 0.2; reasons.push(`${daysLedByBarbell} of ${dayCount} workouts open with a squat / bench / deadlift pattern in a strength rep range`); }
    if (hyperAcc / total >= 0.5) { bb += 0.3; reasons.push(`${share(hyperAcc)}% of sets are 6+ reps on accessories`); }
    else if (hyperAcc / total >= 0.3) { bb += 0.2; reasons.push(`${share(hyperAcc)}% of sets are 6+ reps on accessories`); }
    if (cond / total >= 0.2) { hy += 0.3; reasons.push(`${share(cond)}% of sets are conditioning / athletic work`); }
    else if (cond / total >= 0.1) { hy += 0.1; gf += 0.1; reasons.push(`${share(cond)}% of sets are conditioning work`); }
    if (sbdMain / total < 0.1 && comp === 0) { gf += 0.1; reasons.push(`Few squat / bench / deadlift sets (${share(sbdMain)}%)`); }
  }
  // The coach's own names for the program and the roadmap's reading of each block.
  const names = rec.blocks.map((b) => [b.name, b.training_focus, b.goal].filter(Boolean).join(" ")).join(" · ");
  if (/strength\s*(\+|&|and)\s*hypertroph|power\s*build|hypertroph\w*\s*(\+|&|and)\s*strength/i.test(names)) { st += 0.25; bb += 0.15; reasons.push(`Program named as strength + hypertrophy ("${clip(names)}")`); }
  else {
    if (/hypertroph|bodybuild/i.test(names)) { bb += 0.1; reasons.push(`Program focus reads hypertrophy ("${clip(names)}")`); }
    if (/strength|power/i.test(names)) { st += 0.1; reasons.push(`Program focus reads strength ("${clip(names)}")`); }
  }
  const styles = rec.roadmapNotes.map((n) => n.ai_style).filter(Boolean) as string[];
  const styleCount = (re: RegExp) => styles.filter((s) => re.test(s)).length;
  if (styleCount(/powerlifting|meet_prep/)) { pl += 0.15; reasons.push(`Roadmap reads ${styleCount(/powerlifting|meet_prep/)} block(s) as powerlifting`); }
  if (styleCount(/^strength$/)) { st += 0.15; reasons.push(`Roadmap reads ${styleCount(/^strength$/)} block(s) as strength`); }
  if (styleCount(/hypertrophy|bodybuilding/)) { bb += 0.15; reasons.push(`Roadmap reads ${styleCount(/hypertrophy|bodybuilding/)} block(s) as hypertrophy`); }
  if (styleCount(/general_fitness/)) { gf += 0.15; reasons.push(`Roadmap reads block(s) as general fitness`); }
  const notes = [rec.client.coach_notes, rec.client.training_notes, ...rec.blocks.map((b) => b.coach_notes), ...rec.fileNotes.map((n) => `${n.title ?? ""} ${n.body ?? ""}`)].filter(Boolean).join(" ");
  if (notes && PL_WORDS.test(notes)) { pl += 0.1; reasons.push("Coach notes mention meets / powerlifting"); }
  if (notes && BB_WORDS.test(notes)) { bb += 0.1; reasons.push("Coach notes mention physique / hypertrophy"); }

  const r2 = (n: number) => Math.min(1, Math.round(n * 100) / 100);
  pl = r2(pl);
  bb = r2(bb);
  st = r2(st);
  gf = r2(gf);
  hy = r2(hy);
  // Strength work aimed at a platform is powerlifting; strength work without one is general strength.
  const strengthy = Math.max(pl, st);
  const competing = pl >= 0.45 && (!!meet || rec.meets.length > 0 || /powerlift|compet|meet/i.test(goalText) || !!rec.client.is_powerlifter);
  let auto: Brain;
  if (hy >= 0.45 && hy >= Math.max(pl, bb, st)) auto = "hybrid";
  else if (competing && bb < 0.45) auto = "powerlifting";
  else if (strengthy >= 0.4 && bb >= 0.35) auto = competing ? "powerlifting" : "powerbuilding";
  else if (competing) auto = "powerlifting";
  else if (bb >= 0.45 && bb >= strengthy) auto = "bodybuilding";
  else if (st >= 0.4) auto = "general_strength";
  else if (bb >= 0.3 && bb > gf) auto = "bodybuilding";
  else auto = "general_fitness";
  if (!reasons.length) reasons.push("No goals, meet or structure signals on file: read as general fitness");
  return { auto, scores: { powerlifting: pl, bodybuilding: bb, strength: st, general: gf, hybrid: hy }, reasons };
}

function clip(s: string, n = 60) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
