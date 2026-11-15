/**
 * The coach's morning push for missing program data (program-gaps.ts): run by
 * pg_cron `program-gaps-tick` through /api/public/hooks/program-gaps-tick.
 * Every coaching client's gaps, read as the server (`program_gaps()` lets the
 * service role in as an admin), and one `program_gaps_due` push for each
 * client with a gap on a workout in the next ALERT_DAYS, to their coach and
 * the admins, at most once a client a day (`sourceId` = today + the workout).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProgramGaps, EMPTY_PROGRAM_GAPS, gapsToAlert, type ProgramGapsData } from "@/lib/program-gaps";

export async function runProgramGapsAlerts(admin: SupabaseClient): Promise<{ clients: number; alerted: number; sent: number }> {
  const { data, error } = await (admin as any).rpc("program_gaps", {});
  if (error) throw error;
  const gaps = buildProgramGaps((data as ProgramGapsData | null) ?? EMPTY_PROGRAM_GAPS);
  const due = gapsToAlert(gaps);
  const { notifyAppEvent } = await import("@/lib/push/app-events.server");
  let sent = 0;
  for (const d of due) {
    const r = await notifyAppEvent(admin, "program_gaps_due", { clientId: d.clientId, sourceId: d.sourceId });
    sent += r.sent;
  }
  return { clients: gaps.length, alerted: due.length, sent };
}
