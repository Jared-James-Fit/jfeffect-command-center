/**
 * What the performance calendar and the lifetime read need besides the
 * logged sets: the client's program days (with their dates and names), the
 * workouts they finished, their check-outs and which block each day is in.
 * Read with the viewer's own login (RLS decides: the athlete, their coach,
 * an admin), paged past the response cap.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chunk, fetchAllPages } from "@/lib/supabase-paginate";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { workoutName } from "@/lib/coach-schedule";
import {
  localDay,
  type CalCheckout,
  type CalCompletion,
  type CalPlanned,
} from "@/lib/analytics/performance-calendar";

const sb: any = supabase;

export type PerformanceSources = {
  blocks: Array<{
    id: string;
    name: string;
    status: string | null;
    start: string | null;
    end: string | null;
  }>;
  planned: CalPlanned[];
  /** program day → its block (a plain object: it survives the phone's saved cache) */
  dayBlock: Record<string, string>;
  completions: CalCompletion[];
  checkouts: CalCheckout[];
};

async function loadPerformanceSources(clientId: string): Promise<PerformanceSources> {
  const [blocksRes, completions, feedback] = await Promise.all([
    sb
      .from("pl_blocks")
      .select(
        "id, name, status, start_date, end_date, archived, client_visible, source_template_block_key",
      )
      .eq("client_id", clientId),
    fetchAllPages((from: number, to: number) =>
      sb
        .from("pl_day_completions")
        .select(
          "day_id, completed_at, active_duration_seconds, elapsed_duration_seconds, logging_percentage",
        )
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from: number, to: number) =>
      sb
        .from("pl_workout_feedback")
        .select(
          "id, created_at, sleep_bucket, recovery_today, pain, pl_day_completions(completed_at)",
        )
        .eq("client_id", clientId)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (blocksRes.error) throw blocksRes.error;
  const blocks = ((blocksRes.data ?? []) as any[]).filter(isPrimaryProgramBlock);
  const live = new Map(
    blocks.map((b) => [b.id as string, b.archived !== true && b.client_visible !== false]),
  );
  const weeks: any[] = [];
  for (const ids of chunk(blocks.map((b) => b.id))) {
    const { data, error } = await sb.from("pl_weeks").select("id, block_id").in("block_id", ids);
    if (error) throw error;
    weeks.push(...(data ?? []));
  }
  const blockOfWeek = new Map(weeks.map((w) => [w.id as string, w.block_id as string]));
  const days: any[] = [];
  for (const ids of chunk(weeks.map((w) => w.id))) {
    days.push(
      ...(await fetchAllPages((from: number, to: number) =>
        sb
          .from("pl_days")
          .select(
            "id, week_id, scheduled_date, title, subtitle, day_index, is_optional, archived, deleted_at",
          )
          .in("week_id", ids)
          .order("id")
          .range(from, to),
      )),
    );
  }
  const finished = new Set((completions as any[]).map((c) => c.day_id));
  const dayBlock: Record<string, string> = {};
  const planned: CalPlanned[] = [];
  for (const d of days) {
    const block = blockOfWeek.get(d.week_id);
    if (!block) continue;
    dayBlock[d.id] = block;
    if (d.deleted_at || d.archived === true) continue;
    // a hidden or archived program only for the days that were trained (its title still names them)
    const isLive = live.get(block);
    planned.push({
      dayId: d.id,
      date: isLive || finished.has(d.id) ? (d.scheduled_date ?? "") : "",
      title: workoutName(d),
      optional: d.is_optional === true,
    });
  }
  return {
    blocks: blocks.map((b) => ({
      id: b.id,
      name: b.name ?? "Block",
      status: b.status ?? null,
      start: b.start_date ?? null,
      end: b.end_date ?? null,
    })),
    planned,
    dayBlock,
    completions: (completions as any[]).map((c) => ({
      dayId: c.day_id,
      completedAt: c.completed_at,
      activeSeconds: c.active_duration_seconds != null ? Number(c.active_duration_seconds) : null,
      elapsedSeconds:
        c.elapsed_duration_seconds != null ? Number(c.elapsed_duration_seconds) : null,
      loggingPct: c.logging_percentage != null ? Number(c.logging_percentage) : null,
    })),
    checkouts: (feedback as any[]).map((f) => ({
      day: localDay(f.pl_day_completions?.completed_at ?? f.created_at),
      sleepBucket: f.sleep_bucket ?? null,
      recovery: f.recovery_today != null ? Number(f.recovery_today) : null,
      pain: f.pain ?? null,
    })),
  };
}

export function usePerformanceSources(clientId: string, enabled = true) {
  return useQuery({
    queryKey: ["performance-sources", clientId],
    enabled: !!clientId && enabled,
    staleTime: 60_000,
    queryFn: () => loadPerformanceSources(clientId),
  });
}
