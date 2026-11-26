/**
 * The one read behind every strength number outside the analytics page (the
 * logger, the coach's quick view, the builder's preview, Generate Next
 * Program, Cleo, Missing program data): a year of their squat, bench and
 * deadlift sets (the competition lifts and their barbell variations), their
 * meets with attempts and equipment, their blocks' phases, their weigh-ins
 * (weight cuts) and pain reports, read with whatever session it's given (the
 * signed-in person's in the app, so RLS decides; a server's own client after
 * its own access check). Every read throws on error: a failed read is never
 * a "no history" answer.
 */
import { meetsFromRows, type MeetResult } from "@/lib/analytics/competition-strength";
import { fetchAllPages } from "@/lib/supabase-paginate";
import { resultLoadLb } from "@/lib/result-load";
import { STRENGTH_RULES as R, dayMs, DAY_MS, LB_PER_KG } from "./rules";
import { buildStrengthIntel, type StrengthIntel } from "./profile";
import { cutPhases, phasesFromBlocks } from "./phases";
import type { PhaseSpan } from "./estimate";

const FAMILIES = ["squat", "bench", "deadlift"];

/** The pl_row_results columns the engine reads (with the row and the exercise behind each set). */
export const STRENGTH_RESULT_SELECT =
  "id, set_index, actual_load, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_reps, actual_rpe, actual_rir, mean_concentric_velocity_mps, velocity_excluded, velocity_quality, velocity_uncertainty, completed_at, load_type, is_bodyweight, pl_exercise_rows!inner(id, day_id, sort_order, purpose_label, percentage_basis, tempo, notes, exercise_name_override, movement_family, exercise_id, exercises!inner(name, equipment, competition_lift_type, is_competition_lift, movement_family))";

/** One pl_row_results row (STRENGTH_RESULT_SELECT) in getClientResults' shape: load in lb. */
export function strengthRowFromResult(r: any): any {
  const ex = r.pl_exercise_rows?.exercises ?? {};
  const row = r.pl_exercise_rows ?? {};
  const loadLb = resultLoadLb(r);
  const assisted = r.load_type === "assisted";
  const bodyweight = r.load_type === "bodyweight" || (r.load_type == null && r.is_bodyweight === true);
  return {
    id: r.id,
    date: r.completed_at,
    load: assisted ? 0 : loadLb,
    counts_load: loadLb > 0 && !assisted && !bodyweight,
    reps: Number(r.actual_reps) || 0,
    rpe: r.actual_rpe ?? null,
    rir: r.actual_rir ?? null,
    set_index: r.set_index ?? null,
    row_id: row.id ?? null,
    day_id: row.day_id ?? null,
    row_order: row.sort_order ?? 0,
    purpose_label: row.purpose_label ?? null,
    percentage_basis: row.percentage_basis ?? null,
    tempo: row.tempo ?? null,
    row_notes: row.notes ?? null,
    name_override: row.exercise_name_override ?? null,
    movement_family: row.movement_family ?? null,
    exercise_id: row.exercise_id ?? null,
    exercise_name: ex.name ?? row.exercise_name_override ?? "Exercise",
    equipment: ex.equipment ?? null,
    competition_lift_type: ex.competition_lift_type ?? null,
    is_competition_lift: ex.is_competition_lift === true,
    exercise_movement_family: ex.movement_family ?? null,
    velocity_mps: !r.velocity_excluded && r.mean_concentric_velocity_mps != null ? Number(r.mean_concentric_velocity_mps) : null,
    velocity_quality: r.velocity_quality ?? null,
    velocity_uncertainty: r.velocity_uncertainty ?? null,
  };
}

/** Meet rows with what the engine needs (equipment, attempts) carried onto meetsFromRows' results. */
export function meetsWithDetail(rows: any[]): MeetResult[] {
  const base = meetsFromRows(rows ?? []);
  return base.map((m) => {
    const row = (rows ?? []).find((r) => String(r.meet_date).slice(0, 10) === m.date && (r.meet_name ?? null) === m.name);
    let attempts = row?.attempts ?? null;
    if (typeof attempts === "string") {
      try {
        attempts = JSON.parse(attempts);
      } catch {
        attempts = null;
      }
    }
    return { ...m, equipment: row?.equipment ?? null, attempts } as MeetResult;
  });
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export type StrengthReadInputs = {
  results: any[];
  meets: MeetResult[];
  phases: PhaseSpan[];
  pains: Array<{ day: string; region: string | null; score: number | null }>;
};

/** Everything the engine reads for one client, with the session given. */
export async function fetchStrengthInputs(db: any, clientId: string, opts: { days?: number } = {}): Promise<StrengthReadInputs> {
  const days = opts.days ?? R.READ_DAYS;
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const sinceDay = since.slice(0, 10);
  const [raw, athlete, blocks, client, pains] = await Promise.all([
    fetchAllPages(
      (from, to) =>
        db
          .from("pl_row_results")
          .select(STRENGTH_RESULT_SELECT)
          .eq("client_id", clientId)
          .gte("completed_at", since)
          .not("actual_reps", "is", null)
          .not("completed_at", "is", null)
          .in("pl_exercise_rows.exercises.movement_family", FAMILIES)
          .order("completed_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { maxRows: 8000 },
    ),
    db.from("powerlifting_athletes").select("id").eq("client_id", clientId).maybeSingle(),
    db.from("pl_blocks").select("start_date, end_date, block_type, name, training_focus").eq("client_id", clientId).not("start_date", "is", null),
    db.from("clients").select("user_id").eq("id", clientId).maybeSingle(),
    db.from("pain_reports").select("reported_on, region, score").eq("client_id", clientId).gte("reported_on", sinceDay),
  ]);
  if (athlete.error) throw athlete.error;
  if (blocks.error) throw blocks.error;
  if (client.error) throw client.error;
  if (pains.error) throw pains.error;
  const athleteId = (athlete.data as any)?.id ?? null;
  const meetQ = db
    .from("athlete_powerlifting_results")
    .select("meet_date, meet_name, squat_kg, bench_kg, deadlift_kg, bodyweight_kg, equipment, attempts")
    .order("meet_date", { ascending: false })
    .limit(60);
  const meetRes = await (athleteId ? meetQ.or(`client_id.eq.${clientId},athlete_id.eq.${athleteId}`) : meetQ.eq("client_id", clientId));
  if (meetRes.error) throw meetRes.error;
  let weighIns: Array<{ day: string; kg: number }> = [];
  const userId = (client.data as any)?.user_id ?? null;
  if (userId) {
    const bw = await db
      .from("progress_bodyweight")
      .select("logged_date, weight_value, weight_unit")
      .eq("user_id", userId)
      .gte("logged_date", sinceDay)
      .order("logged_date", { ascending: true })
      .limit(1000);
    // weigh-ins only shape the read (a cut): one that can't be read never stops it
    if (!bw.error)
      weighIns = (bw.data ?? []).map((w: any) => ({
        day: String(w.logged_date).slice(0, 10),
        kg: String(w.weight_unit ?? "kg").toLowerCase().startsWith("lb") ? Number(w.weight_value) / LB_PER_KG : Number(w.weight_value),
      }));
  }
  const phases = [
    ...phasesFromBlocks(((blocks.data ?? []) as any[]).map((b) => ({ ...b, phase: b.training_focus }))),
    ...cutPhases(weighIns),
  ];
  return {
    results: (raw ?? []).map(strengthRowFromResult),
    meets: meetsWithDetail((meetRes.data ?? []) as any[]),
    phases,
    pains: ((pains.data ?? []) as any[]).map((p) => ({ day: String(p.reported_on).slice(0, 10), region: p.region ?? null, score: p.score ?? null })),
  };
}

/** The strength read for one client today (or on a past day: what it said then). */
export async function fetchStrengthIntel(db: any, clientId: string, opts: { today?: string } = {}): Promise<StrengthIntel> {
  const inputs = await fetchStrengthInputs(db, clientId);
  return strengthIntelFrom(inputs, opts.today ?? today());
}

export function strengthIntelFrom(inputs: StrengthReadInputs, day: string): StrengthIntel {
  return buildStrengthIntel(inputs.results, inputs.meets, { today: day, phases: inputs.phases, pains: inputs.pains });
}

export const isFamily = (s: string) => FAMILIES.includes(s);
export const daysAgo = (d: string, from: string) => Math.round((dayMs(from) - dayMs(d)) / DAY_MS);
