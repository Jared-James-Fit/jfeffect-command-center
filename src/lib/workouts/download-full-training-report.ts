import { supabase } from "@/integrations/supabase/client";
import { getBlockTree } from "@/lib/pl-programs";

/**
 * Build every client-visible block + weeks/days/exercises + completions +
 * logged sets + client-authored notes, then hand it to the shared full
 * training report PDF renderer. Used by both the client Workouts screen and
 * the admin/coach client quick-actions menu so both surfaces produce the
 * same complete report.
 */
export async function downloadFullTrainingReportForClient(opts: {
  clientId: string;
  clientDisplayName?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { clientId, clientDisplayName } = opts;

  const { data: blocks, error: blocksErr } = await supabase
    .from("pl_blocks")
    .select("*")
    .eq("client_id", clientId)
    .eq("client_visible", true)
    .neq("status", "Archived")
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (blocksErr) throw blocksErr;

  const blockRows = (blocks ?? []) as any[];
  if (!blockRows.length) return { ok: false, reason: "No blocks to download yet." };

  const trees = await Promise.all(
    blockRows.map(async (b) => ({ block: b, tree: await getBlockTree(b.id) })),
  );

  const allDayIds: string[] = [];
  const allRowIds: string[] = [];
  for (const { tree } of trees) {
    for (const d of tree?.days ?? []) allDayIds.push(d.id);
    for (const r of tree?.rows ?? []) allRowIds.push(r.id);
  }

  const [completionsRes, resultsRes] = await Promise.all([
    allDayIds.length
      ? supabase
          .from("pl_day_completions")
          .select(
            "day_id, started_at, in_progress_at, completed_at, client_notes, actual_duration_min, logging_percentage, logged_sets_count",
          )
          .in("day_id", allDayIds)
          .eq("client_id", clientId)
      : Promise.resolve({ data: [] as any[], error: null } as any),
    allRowIds.length
      ? supabase
          .from("pl_row_results")
          .select(
            "row_id, set_index, actual_reps, actual_load, actual_load_lb, actual_load_kg, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_rpe, actual_rpe_num, actual_rir, completed_duration_seconds, notes",
          )
          .in("row_id", allRowIds)
          .eq("client_id", clientId)
      : Promise.resolve({ data: [] as any[], error: null } as any),
  ]);
  if ((completionsRes as any).error) throw (completionsRes as any).error;
  if ((resultsRes as any).error) throw (resultsRes as any).error;

  const notesRes: any = allDayIds.length
    ? await supabase
        .from("pl_exercise_notes")
        .select("day_id, row_id, exercise_name, content, status, created_at, updated_at")
        .in("day_id", allDayIds)
        .eq("client_id", clientId)
        .order("updated_at", { ascending: true })
    : { data: [] as any[] };
  if (notesRes?.error) throw notesRes.error;
  const notesByDay = new Map<string, any[]>();
  for (const n of (notesRes.data ?? []) as any[]) {
    const list = notesByDay.get(n.day_id) ?? [];
    list.push(n);
    notesByDay.set(n.day_id, list);
  }

  const completionByDay = new Map<string, any>();
  for (const c of (completionsRes.data ?? []) as any[]) {
    const prev = completionByDay.get(c.day_id);
    if (!prev || (c.completed_at && !prev.completed_at)) {
      completionByDay.set(c.day_id, c);
    }
  }
  const resultsByRow = new Map<string, any[]>();
  for (const r of (resultsRes.data ?? []) as any[]) {
    const list = resultsByRow.get(r.row_id) ?? [];
    list.push(r);
    resultsByRow.set(r.row_id, list);
  }

  const { downloadFullTrainingReportPdf } = await import("@/lib/workouts/workout-pdf");

  downloadFullTrainingReportPdf({
    client_name: clientDisplayName ?? null,
    generated_at: new Date(),
    blocks: trees.map(({ block, tree }) => {
      const weeksSorted = (tree?.weeks ?? [])
        .slice()
        .sort((a: any, b: any) => (a.week_index ?? 0) - (b.week_index ?? 0));
      const daysByWeek = new Map<string, any[]>();
      for (const d of tree?.days ?? []) {
        const list = daysByWeek.get(d.week_id) ?? [];
        list.push(d);
        daysByWeek.set(d.week_id, list);
      }
      const rowsByDay = new Map<string, any[]>();
      for (const r of tree?.rows ?? []) {
        const list = rowsByDay.get(r.day_id) ?? [];
        list.push(r);
        rowsByDay.set(r.day_id, list);
      }
      return {
        block_name: block?.name ?? null,
        block_status: block?.status ?? null,
        block_start: block?.start_date ?? null,
        block_end: block?.end_date ?? null,
        weeks: weeksSorted.map((w: any) => ({
          id: w.id,
          week_index: w.week_index,
          notes: w.notes ?? null,
          days: (daysByWeek.get(w.id) ?? [])
            .slice()
            .sort((a: any, b: any) => (a.day_index ?? 0) - (b.day_index ?? 0))
            .map((d: any) => {
              const c = completionByDay.get(d.id);
              return {
                id: d.id,
                day_index: d.day_index,
                title: d.title ?? null,
                notes: d.notes ?? null,
                notes_client_visible: d.notes_client_visible ?? null,
                scheduled_date: d.scheduled_date ?? null,
                started_at: c?.started_at ?? null,
                in_progress_at: c?.in_progress_at ?? null,
                completed_at: c?.completed_at ?? null,
                completion_note: c?.client_notes ?? null,
                rows: (rowsByDay.get(d.id) ?? []).map((r: any) => ({
                  ...r,
                  logged_sets: resultsByRow.get(r.id) ?? [],
                })),
                client_exercise_notes: notesByDay.get(d.id) ?? [],
              };
            }),
        })),
      };
    }),
  });

  return { ok: true };
}