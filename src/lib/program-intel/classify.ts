/**
 * Which coaching brain reads a program: from the athlete's goals, the
 * program's structure, a meet on file and the coaches' notes. Deterministic,
 * with every signal that fired listed as a reason; the coach can override it.
 */
import { repRange } from "./core";
import type { Brain, Classification, IntelRecords } from "./types";

const PL_WORDS = /powerlift|\bmeet\b|\btotal\b|compet|federation|\bipf\b|\bcpu\b|usapl|\bsbd\b|strength sport|\bpeak/i;
const BB_WORDS = /bodybuild|hypertroph|muscle|physique|aesthetic|\bsize\b|\bbulk|\bcut\b|\bshow\b|\bstage\b|\bglute|\btone|\bbuild\b.*\bmuscle/i;
const GF_WORDS = /fitness|health|lose weight|weight loss|fat loss|general|mobility|conditioning|energy|longevity|feel better/i;

export function classifyProgram(rec: IntelRecords): Classification {
  let pl = 0;
  let bb = 0;
  let gf = 0;
  const reasons: string[] = [];

  const goalText = [rec.goals?.main_goal, rec.goals?.main_goal_other, rec.goals?.goal_target, ...(rec.goals?.training_styles ?? []), rec.client.goals].filter(Boolean).join(" · ");
  if (goalText) {
    if (PL_WORDS.test(goalText)) { pl += 0.3; reasons.push(`Goals mention powerlifting / competing ("${clip(goalText)}")`); }
    if (BB_WORDS.test(goalText)) { bb += 0.3; reasons.push(`Goals mention muscle / physique ("${clip(goalText)}")`); }
    if (GF_WORDS.test(goalText)) { gf += 0.3; reasons.push(`Goals mention general fitness / health ("${clip(goalText)}")`); }
  }
  const meet = rec.preps.find((p) => p.event_name || p.event_date || p.federation || /meet|compet/i.test(p.goal_type ?? ""));
  if (meet) { pl += 0.35; reasons.push(`A meet prep is on file (${[meet.event_name, meet.event_date, meet.federation].filter(Boolean).join(", ") || meet.title || "prep"})`); }
  if (rec.meets.length) { pl += 0.15; reasons.push(`${rec.meets.length} meet result${rec.meets.length === 1 ? "" : "s"} on file`); }

  // Program structure: where the prescribed sets go.
  const ex = new Map(rec.exercises.map((e) => [e.id, e]));
  let total = 0, comp = 0, sbd = 0, low = 0, hyper = 0, pct = 0;
  for (const r of rec.rows) {
    const sets = r.sets ?? 0;
    if (!sets) continue;
    total += sets;
    const e = ex.get(r.exercise_id ?? "");
    const fam = String(e?.movement_family ?? "").toLowerCase();
    const isComp = !!e && (e.is_competition_lift === true || !!e.competition_lift_type);
    if (isComp) comp += sets;
    if (["squat", "bench", "deadlift"].includes(fam)) sbd += sets;
    const rr = repRange(r.reps_text);
    if (rr && rr[1] <= 5) low += sets;
    if (rr && rr[0] >= 6 && !isComp) hyper += sets;
    if (r.percentage != null) pct += sets;
  }
  if (total > 0) {
    const share = (n: number) => Math.round((n / total) * 100);
    if (comp / total >= 0.25) { pl += 0.3; reasons.push(`${share(comp)}% of prescribed sets are competition lifts`); }
    else if (comp / total >= 0.1) { pl += 0.15; reasons.push(`${share(comp)}% of prescribed sets are competition lifts`); }
    if (low / total >= 0.35) { pl += 0.1; reasons.push(`${share(low)}% of sets are 5 reps or fewer`); }
    if (pct / total >= 0.15) { pl += 0.1; reasons.push(`${share(pct)}% of sets are prescribed as a % of a max`); }
    if (hyper / total >= 0.5) { bb += 0.3; reasons.push(`${share(hyper)}% of sets are 6+ reps on non-competition exercises`); }
    else if (hyper / total >= 0.3) { bb += 0.15; reasons.push(`${share(hyper)}% of sets are 6+ reps on non-competition exercises`); }
    if (sbd / total < 0.1 && comp === 0) { gf += 0.1; reasons.push(`Few squat / bench / deadlift sets (${share(sbd)}%)`); }
  }
  // The roadmap's own reading of each block (written by Cleo or the coach).
  const styles = rec.roadmapNotes.map((n) => n.ai_style).filter(Boolean) as string[];
  const styleCount = (re: RegExp) => styles.filter((s) => re.test(s)).length;
  if (styleCount(/powerlifting|meet_prep|strength/)) { pl += 0.15; reasons.push(`Roadmap reads ${styleCount(/powerlifting|meet_prep|strength/)} block(s) as strength / powerlifting`); }
  if (styleCount(/hypertrophy|bodybuilding/)) { bb += 0.15; reasons.push(`Roadmap reads ${styleCount(/hypertrophy|bodybuilding/)} block(s) as hypertrophy`); }
  if (styleCount(/general_fitness/)) { gf += 0.15; reasons.push(`Roadmap reads block(s) as general fitness`); }
  const notes = [rec.client.coach_notes, rec.client.training_notes, ...rec.blocks.map((b) => b.coach_notes), ...rec.fileNotes.map((n) => `${n.title ?? ""} ${n.body ?? ""}`)].filter(Boolean).join(" ");
  if (notes && PL_WORDS.test(notes)) { pl += 0.1; reasons.push("Coach notes mention meets / powerlifting"); }
  if (notes && BB_WORDS.test(notes)) { bb += 0.1; reasons.push("Coach notes mention physique / hypertrophy"); }

  pl = Math.min(1, Math.round(pl * 100) / 100);
  bb = Math.min(1, Math.round(bb * 100) / 100);
  let auto: Brain;
  if (pl >= 0.45 && bb >= 0.45) auto = "powerbuilding";
  else if (pl >= 0.45 && pl >= bb) auto = "powerlifting";
  else if (bb >= 0.45) auto = "bodybuilding";
  else if (pl >= 0.3 && bb >= 0.3) auto = "powerbuilding";
  else auto = pl > bb && pl >= 0.3 ? "powerlifting" : bb > pl && bb >= 0.3 ? "bodybuilding" : "general_fitness";
  if (!reasons.length) reasons.push("No goals, meet or structure signals on file: read as general fitness");
  void gf;
  return { auto, scores: { powerlifting: pl, bodybuilding: bb }, reasons };
}

function clip(s: string, n = 60) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
