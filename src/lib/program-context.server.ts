/**
 * Loads a client's program context (see program-context.ts) with the admin
 * client. Never throws: a missing program just means no context.
 */
import { attachSessions, programContextFor, type ProgramContext } from "@/lib/program-context";

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

/** `ref` = a day inside the week being reviewed; defaults to today in the client's time zone. */
export async function loadProgramContext(sb: any, clientId: string | null | undefined, ref?: string | null): Promise<ProgramContext | null> {
  if (!clientId) return null;
  try {
    const [{ data: client }, { data: blocks }] = await Promise.all([
      sb.from("clients").select("full_name, timezone").eq("id", clientId).maybeSingle(),
      sb.from("pl_blocks").select("*").eq("client_id", clientId).eq("archived", false).neq("status", "Archived"),
    ]);
    const list = (blocks ?? []) as any[];
    if (!list.length) return null;
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
        ? sb.from("pl_preps").select("id, title, status, archived, event_name, event_date, goal_type").in("id", prepIds)
        : Promise.resolve({ data: [] }),
    ]);
    const ctx = programContextFor({
      blocks: list,
      weeks: weeks.data ?? [],
      notes: notes.error ? [] : notes.data ?? [],
      preps: preps.data ?? [],
      ref: ref || todayIn(client?.timezone),
      ownerName: client?.full_name ?? null,
    });
    if (!ctx) return null;
    const weekIds = [ctx.this_week?.week_id, ctx.next_week?.week_id].filter(Boolean);
    if (!weekIds.length) return ctx;
    const { data: days } = await sb
      .from("pl_days")
      .select("week_id, day_index, title, focus, archived, deleted_at")
      .in("week_id", weekIds);
    return attachSessions(ctx, ((days ?? []) as any[]).filter((d) => !d.archived && !d.deleted_at));
  } catch {
    return null;
  }
}
