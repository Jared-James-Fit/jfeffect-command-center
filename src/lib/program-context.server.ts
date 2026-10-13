/**
 * Loads a client's program context (see program-context.ts) with the admin
 * client: where they are in the program, plus the per-lift training readout
 * (training-readout.ts) and their weight class vs bodyweight. Never throws: a
 * missing program just means no context.
 */
import { attachSessions, programContextFor, weightClassGap, type ProgramContext } from "@/lib/program-context";
import { buildTrainingReadout, type ReadoutDay, type ReadoutRow, type ReadoutSet } from "@/lib/training-readout";

function todayIn(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "America/Winnipeg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const toKg = (r: any): number | null => {
  const v = r.normalized_kg ?? r.actual_load_kg;
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  if (r.actual_load == null) return null;
  const n = Number(r.actual_load);
  if (!Number.isFinite(n)) return null;
  return String(r.actual_load_unit ?? "").toLowerCase().startsWith("lb") ? n / 2.2046226 : n;
};
const toSet = (r: any): ReadoutSet => ({
  row_id: r.row_id,
  set_index: r.set_index,
  kg: toKg(r),
  reps: r.actual_reps != null ? Number(r.actual_reps) : null,
  rpe: r.actual_rpe_num != null ? Number(r.actual_rpe_num) : null,
  working: r.is_working_set,
  at: r.completed_at ? String(r.completed_at).slice(0, 10) : null,
});
const SET_COLS = "row_id, set_index, normalized_kg, actual_load_kg, actual_load, actual_load_unit, actual_reps, actual_rpe_num, is_working_set, completed_at";

/**
 * `ref` = a day inside the week being reviewed (defaults to today); `asOf` =
 * the day the client answered (defaults to today), so later sessions that
 * week read as "still to come".
 */
export async function loadProgramContext(
  sb: any,
  clientId: string | null | undefined,
  ref?: string | null,
  asOf?: string | null,
): Promise<ProgramContext | null> {
  if (!clientId) return null;
  try {
    const [{ data: client }, { data: blocks }] = await Promise.all([
      sb.from("clients").select("full_name, timezone, user_id, preferred_weight_unit").eq("id", clientId).maybeSingle(),
      sb.from("pl_blocks").select("*").eq("client_id", clientId).eq("archived", false).neq("status", "Archived"),
    ]);
    const list = (blocks ?? []) as any[];
    if (!list.length) return null;
    const today = todayIn(client?.timezone);
    const ids = list.map((b) => b.id);
    const prepIds = [...new Set(list.map((b) => b.prep_id).filter(Boolean))];
    const [weeks, notes, preps] = await Promise.all([
      sb
        .from("pl_weeks")
        .select("id, block_id, week_index, start_date, end_date, manually_completed, phase, notes, archived, deleted_at")
        .in("block_id", ids),
      sb
        .from("pl_roadmap_notes")
        .select("id, block_id, week_id, ai_label, ai_summary, ai_style, coach_label, coach_summary, hidden")
        .in("block_id", ids),
      prepIds.length
        ? sb.from("pl_preps").select("id, title, status, archived, event_name, event_date, goal_type, weight_class").in("id", prepIds)
        : Promise.resolve({ data: [] }),
    ]);
    let ctx = programContextFor({
      blocks: list,
      weeks: weeks.data ?? [],
      notes: notes.error ? [] : notes.data ?? [],
      preps: preps.data ?? [],
      ref: ref || today,
      ownerName: client?.full_name ?? null,
    });
    if (!ctx) return null;
    const unit: "kg" | "lb" = client?.preferred_weight_unit === "kg" ? "kg" : "lb";

    const weekIds = [ctx.this_week?.week_id, ctx.next_week?.week_id].filter(Boolean) as string[];
    if (weekIds.length) {
      const { data: dayRows } = await sb
        .from("pl_days")
        .select("id, week_id, day_index, title, focus, scheduled_date, archived, deleted_at")
        .in("week_id", weekIds);
      const days = ((dayRows ?? []) as any[]).filter((d) => !d.archived && !d.deleted_at);
      ctx = attachSessions(ctx, days);
      // Training readout never blocks the rest of the context.
      try {
        ctx = { ...ctx, readout: await loadReadout(sb, clientId, ctx, days, asOf || today, unit) };
      } catch {
        /* no readout */
      }
    }

    if (ctx.weight_class && client?.user_id) {
      const { data: bw } = await sb
        .from("progress_bodyweight")
        .select("weight_value, weight_unit")
        .eq("user_id", client.user_id)
        .gte("logged_date", addDays(today, -6))
        .lte("logged_date", today);
      const kgs = ((bw ?? []) as any[])
        .map((r) => (String(r.weight_unit).startsWith("lb") ? Number(r.weight_value) / 2.2046226 : Number(r.weight_value)))
        .filter((v) => Number.isFinite(v) && v > 0);
      const avg = kgs.length ? kgs.reduce((a, b) => a + b, 0) / kgs.length : null;
      ctx = { ...ctx, weight_class: weightClassGap(ctx.weight_class.class, avg, unit) };
    }
    return ctx;
  } catch {
    return null;
  }
}

async function loadReadout(sb: any, clientId: string, ctx: ProgramContext, days: any[], asOf: string, unit: "kg" | "lb") {
  const dayIds = days.map((d) => d.id);
  if (!dayIds.length) return null;
  const [{ data: rowData }, { data: moved }] = await Promise.all([
    sb
      .from("pl_exercise_rows")
      .select("id, day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, percentage, purpose_label")
      .in("day_id", dayIds),
    // A session moved to another day counts on the day it's actually scheduled.
    sb.from("pl_scheduled_workouts").select("source_day_id, scheduled_date").eq("client_id", clientId).in("source_day_id", dayIds),
  ]);
  const rawRows = (rowData ?? []) as any[];
  const exIds = [...new Set(rawRows.map((r) => r.exercise_id).filter(Boolean))];
  const { data: exData } = exIds.length
    ? await sb.from("exercises").select("id, name, competition_lift_type").in("id", exIds)
    : { data: [] };
  const exById = new Map<string, any>(((exData ?? []) as any[]).map((e) => [e.id, e]));
  const rows: ReadoutRow[] = rawRows.map((r) => ({
    id: r.id,
    day_id: r.day_id,
    sort_order: r.sort_order,
    exercise_id: r.exercise_id,
    name: (r.exercise_name_override || exById.get(r.exercise_id)?.name || "Exercise").trim(),
    purpose_label: r.purpose_label,
    competition_lift_type: exById.get(r.exercise_id)?.competition_lift_type ?? null,
    sets: r.sets,
    reps_text: r.reps_text,
    rpe: r.rpe,
    percentage: r.percentage,
  }));
  const movedTo = new Map<string, string>(((moved ?? []) as any[]).map((m) => [m.source_day_id, m.scheduled_date]));
  const readoutDays: ReadoutDay[] = days.map((d) => ({
    id: d.id,
    week_id: d.week_id,
    day_index: d.day_index,
    date: movedTo.get(d.id) ?? d.scheduled_date ?? null,
  }));

  const thisWeekId = ctx.this_week?.week_id ?? null;
  const thisDayIds = new Set(readoutDays.filter((d) => d.week_id === thisWeekId).map((d) => d.id));
  const thisRowIds = rows.filter((r) => thisDayIds.has(r.day_id)).map((r) => r.id);
  // Earlier weeks of THIS block only (like-for-like); week 1 has nothing to compare to.
  const tw = ctx.this_week;
  const histTo = tw?.start ?? null;
  const histFrom = tw?.start && tw.week > 1 ? addDays(tw.start, -(tw.week - 1) * 7) : null;

  const [{ data: setData }, { data: histData }] = await Promise.all([
    thisRowIds.length
      ? sb.from("pl_row_results").select(SET_COLS).eq("client_id", clientId).in("row_id", thisRowIds)
      : Promise.resolve({ data: [] }),
    histFrom && histTo
      ? sb
          .from("pl_row_results")
          .select(SET_COLS)
          .eq("client_id", clientId)
          .gte("completed_at", `${histFrom}T00:00:00Z`)
          .lt("completed_at", `${histTo}T00:00:00Z`)
          .limit(3000)
      : Promise.resolve({ data: [] }),
  ]);
  const hist = (histData ?? []) as any[];
  const histRowIds = [...new Set(hist.map((h) => h.row_id))];
  const { data: histRowData } = histRowIds.length
    ? await sb.from("pl_exercise_rows").select("id, exercise_id, exercise_name_override").in("id", histRowIds)
    : { data: [] };
  const historyRows = ((histRowData ?? []) as any[]).map((r) => ({
    id: r.id,
    exercise_id: r.exercise_id,
    name: (r.exercise_name_override || exById.get(r.exercise_id)?.name || "").trim(),
  }));

  return buildTrainingReadout({
    thisWeekId,
    nextWeekId: ctx.next_week?.week_id ?? null,
    days: readoutDays,
    rows,
    sets: ((setData ?? []) as any[]).map(toSet),
    history: hist.map(toSet),
    historyRows,
    asOf,
    unit,
  });
}
