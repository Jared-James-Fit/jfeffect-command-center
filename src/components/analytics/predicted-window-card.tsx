import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Target } from "lucide-react";
import { epley1RM } from "@/lib/analytics/e1rm";
import { predictBestWindow, type BlockWeekSignal } from "@/lib/analytics/predicted-window";

interface Props {
  clientId: string;
  currentBlockId: string | null;
}

/**
 * Predicted Best Performance Window.
 *
 * Uses week-by-week signals from the current block and prior blocks
 * (via pl_row_results.week_index + est 1RM) to point the client at
 * the most likely peak week. Hides gracefully when there isn't enough
 * history.
 */
export function PredictedWindowCard({ clientId, currentBlockId }: Props) {
  const { data } = useQuery({
    queryKey: ["predicted-window", clientId, currentBlockId],
    enabled: !!clientId && !!currentBlockId,
    staleTime: 60_000,
    queryFn: async () => {
      // All blocks with metadata
      const { data: blocks } = await supabase
        .from("pl_blocks")
        .select("id, sort_order, weeks, start_date")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true });
      const blockList = (blocks ?? []) as any[];
      if (!blockList.length) return null;

      const currentIdx = blockList.findIndex((b) => b.id === currentBlockId);
      if (currentIdx === -1) return null;
      const priorBlockIds = blockList.slice(0, currentIdx).map((b) => b.id);

      async function weekSignals(blockId: string): Promise<BlockWeekSignal[]> {
        const { data: rows } = await (supabase as any)
          .from("pl_row_results")
          .select("week_index, actual_load, actual_reps, actual_rpe")
          .eq("block_id", blockId);
        const byWeek = new Map<number, { e1rms: number[]; rpes: number[]; count: number }>();
        for (const r of (rows ?? []) as any[]) {
          const w = Number(r.week_index ?? 0);
          if (!w) continue;
          const load = Number(r.actual_load ?? 0);
          const reps = Number(r.actual_reps ?? 0);
          if (load <= 0 || reps <= 0) continue;
          const e = epley1RM(load, reps);
          if (!byWeek.has(w)) byWeek.set(w, { e1rms: [], rpes: [], count: 0 });
          const b = byWeek.get(w)!;
          b.e1rms.push(e);
          if (r.actual_rpe != null) {
            const n = Number(r.actual_rpe);
            if (Number.isFinite(n)) b.rpes.push(n);
          }
          b.count++;
        }
        return [...byWeek.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([week_index, v]) => ({
            block_id: blockId,
            week_index,
            avg_e1rm: v.e1rms.length ? v.e1rms.reduce((s, n) => s + n, 0) / v.e1rms.length : null,
            avg_rpe: v.rpes.length ? v.rpes.reduce((s, n) => s + n, 0) / v.rpes.length : null,
            workouts: v.count,
          }));
      }

      const currentWeeks = await weekSignals(currentBlockId!);
      const priors = await Promise.all(priorBlockIds.map(weekSignals));
      return predictBestWindow(currentWeeks, priors);
    },
  });

  if (!data) return null;

  return (
    <section aria-label="Predicted best window">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
          <Target className="h-5 w-5 text-primary" />
          Best Performance Window
        </h2>
      </div>
      <Card className="border-primary/30 bg-primary/5 p-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">Week</span>
            <span className="text-2xl font-black leading-none">{data.week}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-black text-foreground">Predicted peak week</div>
            <div className="text-xs text-muted-foreground">{data.rationale}</div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              {data.confidence} confidence
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}