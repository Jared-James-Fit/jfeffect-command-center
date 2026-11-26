/**
 * Replays the Strength Intelligence engine (src/lib/strength-intel) on a
 * read-only snapshot of real logs and prints, per athlete and lift, the six
 * metrics and the estimate week by week, so a change to rules.ts can be judged
 * against how a coach would read the same training. The snapshot holds client
 * data: keep it outside the repository.
 *
 *   npx tsx scripts/strength-intel/replay.ts <sets.json> <snap.json> [client-id] [--weekly]
 *
 * sets.json: { rows: [{ rows: [[client_id, completed_at, normalized_lb, actual_load,
 *   actual_load_unit, entered_value, entered_unit, normalized_kg, reps, rpe, rir,
 *   set_index, day_id, sort_order, purpose_label, percentage_basis, tempo, notes,
 *   exercise_name_override, row_movement_family, exercise_id, exercise_name,
 *   equipment, competition_lift_type, is_competition_lift, exercise_movement_family,
 *   velocity, velocity_excluded, velocity_quality, velocity_uncertainty, load_type,
 *   is_bodyweight], …] }] }
 * snap.json: { meets: [...athlete_powerlifting_results], blocks: [...pl_blocks] }
 */
import { readFileSync } from "node:fs";
import { strengthRowFromResult, meetsWithDetail } from "@/lib/strength-intel/read";
import { buildStrengthIntel } from "@/lib/strength-intel/profile";
import { planningRefs } from "@/lib/strength-intel/planning";
import { phasesFromBlocks } from "@/lib/strength-intel/phases";
import { lineAt } from "@/lib/strength-intel/estimate";
import { LB_PER_KG } from "@/lib/strength-intel/rules";

const [setsPath, snapPath, only, flag] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(setsPath, "utf8")).rows[0].rows as any[][];
const snap = JSON.parse(readFileSync(snapPath, "utf8"));
const kg = (lb: number) => Math.round((lb / LB_PER_KG) * 10) / 10;

const byClient = new Map<string, any[]>();
for (const a of raw) {
  const r = {
    id: `${a[0]}-${a[1]}-${a[11]}`,
    completed_at: a[1],
    normalized_lb: a[2],
    actual_load: a[3],
    actual_load_unit: a[4],
    entered_value: a[5],
    entered_unit: a[6],
    normalized_kg: a[7],
    actual_reps: a[8],
    actual_rpe: a[9],
    actual_rir: a[10],
    set_index: a[11],
    mean_concentric_velocity_mps: a[26],
    velocity_excluded: a[27],
    velocity_quality: a[28],
    velocity_uncertainty: a[29],
    load_type: a[30],
    is_bodyweight: a[31],
    pl_exercise_rows: {
      id: null,
      day_id: a[12],
      sort_order: a[13],
      purpose_label: a[14],
      percentage_basis: a[15],
      tempo: a[16],
      notes: a[17],
      exercise_name_override: a[18],
      movement_family: a[19],
      exercise_id: a[20],
      exercises: { name: a[21], equipment: a[22], competition_lift_type: a[23], is_competition_lift: a[24], movement_family: a[25] },
    },
  };
  byClient.set(a[0], [...(byClient.get(a[0]) ?? []), strengthRowFromResult(r)]);
}

const today = "2026-11-26";
for (const [clientId, results] of byClient) {
  if (only && only !== "--weekly" && clientId !== only) continue;
  const meets = meetsWithDetail((snap.meets ?? []).filter((m: any) => m.client_id === clientId));
  const phases = phasesFromBlocks(
    (snap.blocks ?? []).filter((b: any) => b.client_id === clientId).map((b: any) => ({ ...b, phase: b.training_focus })),
  );
  const intel = buildStrengthIntel(results, meets, { today, phases });
  const refs = planningRefs(intel);
  console.log(`\n=== ${clientId.slice(0, 8)} · ${results.length} sets · ${meets.length} meets · ${phases.length} phases`);
  for (const lift of ["squat", "bench", "deadlift"] as const) {
    const l = intel.lifts[lift];
    if (!l.sessions.length && !l.meets.length) continue;
    const c = l.current;
    const cal = l.calibration;
    console.log(
      `  ${lift}${l.style ? ` (${l.style})` : ""}: comp PR ${l.competitionPR ? `${kg(l.competitionPR.value)} kg ${l.competitionPR.day}` : "—"} · training PR ${
        l.trainingPR ? `${kg(l.trainingPR.load)}×${l.trainingPR.reps} ${l.trainingPR.day}` : "—"
      } · peak e1RM ${l.peakE1rm ? `${kg(l.peakE1rm.value)} ${l.peakE1rm.day}` : "—"}`,
    );
    console.log(
      `     current ${c ? `${kg(c.value)} kg (${c.word} ${c.confidence}, ${c.state}, ${c.reason}, basis ${c.basis.kind} ${c.basis.day}, updated ${c.lastUpdate}, ${c.points} pts)` : "—"} · plan: ${
        refs.e1rm[lift] ? `${refs.e1rm[lift]!.kg} kg` : `none (${refs.why[lift]})`
      }`,
    );
    console.log(
      `     calibration: premium ${cal.premium} (${cal.premiumMeets} meets) · reps ×${cal.repFactor} (${cal.repPairs}) · consistency ${cal.consistency} (sd ${cal.scatter}) · back-offs ${cal.backoffRatio ?? "—"} (${cal.backoffSessions})${
        l.otherStyle ? ` · other stance ${l.otherStyle.style}: ${l.otherStyle.current ? kg(l.otherStyle.current.value) : "—"}` : ""
      }`,
    );
    if (flag === "--weekly" || only === "--weekly") {
      const sessions = l.sessions.filter((s) => s.day >= "2026-06-01");
      for (const s of sessions) {
        const p = lineAt(l.line, s.day)!;
        console.log(
          `       ${s.day} ${s.kind === "exact" ? "■" : "□"} ${kg(s.set.load)}×${s.set.reps}@${s.set.effort ?? "?"} → ${kg(s.e1rm)} r${s.reliability} ${s.band}${s.outlier ? ` OUTLIER ${s.outlier}` : ""} | line ${kg(p.value)} ${p.state} ${p.reason} c${p.confidence}`,
        );
      }
      for (const m of l.meets.filter((m) => m.day >= "2026-01-01")) console.log(`       ${m.day} ◆ meet ${kg(m.lb)} → line ${lineAt(l.line, m.day) ? kg(lineAt(l.line, m.day)!.value) : "—"}`);
    }
  }
  for (const v of intel.variations) {
    const r = refs.variations[v.exerciseId];
    console.log(
      `  · ${v.name} (${v.family}): ${v.sessions.length} sessions · own ${v.current ? `${kg(v.current.value)} ${v.current.word}` : "—"} · ratio ${v.ratio ? `${v.ratio.value} (${v.ratio.pairs})` : "—"} · plan ${r ? `${r.kg} ${r.metric}` : "—"}`,
    );
  }
}
