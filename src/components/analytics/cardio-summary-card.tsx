import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Heart } from "lucide-react";
import { differenceInCalendarWeeks, format } from "date-fns";

interface Props {
  clientId: string;
  rangeStart: Date;
  rangeEnd: Date;
  rangeLabel: string;
}

/**
 * Compact cardio summary card.
 * Uses only cardio_completions + cardio_targets. Hides when no active target
 * AND no completions exist in the range.
 */
export function CardioSummaryCard({ clientId, rangeStart, rangeEnd, rangeLabel }: Props) {
  const startStr = format(rangeStart, "yyyy-MM-dd");
  const endStr = format(rangeEnd, "yyyy-MM-dd");

  const { data } = useQuery({
    queryKey: ["cardio-summary", clientId, startStr, endStr],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const [completionsRes, targetsRes] = await Promise.all([
        (supabase as any)
          .from("cardio_completions")
          .select("completed, duration_minutes, completed_date")
          .eq("client_id", clientId)
          .gte("completed_date", startStr)
          .lte("completed_date", endStr),
        (supabase as any)
          .from("cardio_targets")
          .select("frequency_per_week, status, enabled, start_date, end_date")
          .eq("client_id", clientId)
          .neq("status", "Archived"),
      ]);

      const completions = (completionsRes.data ?? []) as any[];
      const done = completions.filter((c) => c.completed !== false);
      const totalMin = done.reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0);

      // Prescribed = sum of active targets' frequency_per_week * weeks in range
      const weeks = Math.max(1, differenceInCalendarWeeks(rangeEnd, rangeStart) + 1);
      const activeTargets = ((targetsRes.data ?? []) as any[]).filter(
        (t) => (t.enabled ?? true) && t.status !== "Archived",
      );
      const prescribed = activeTargets.reduce(
        (s, t) => s + (Number(t.frequency_per_week) || 0) * weeks,
        0,
      );

      return {
        completed: done.length,
        prescribed,
        totalMin: Math.round(totalMin),
        hasTargets: activeTargets.length > 0,
      };
    },
  });

  if (!data) return null;
  if (!data.hasTargets && data.completed === 0) return null;

  const adherence = data.prescribed > 0
    ? Math.min(100, Math.round((data.completed / data.prescribed) * 100))
    : null;

  return (
    <section aria-label="Cardio">
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-black uppercase tracking-wider text-foreground">
          <Heart className="h-5 w-5 shrink-0 text-primary" />
          <span className="truncate">Cardio</span>
        </h2>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rangeLabel}</span>
      </div>
      <Card className="border-border/80 bg-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell label="Completed" value={String(data.completed)} />
          <Cell label="Prescribed" value={data.prescribed > 0 ? String(data.prescribed) : "—"} />
          <Cell label="Adherence" value={adherence != null ? `${adherence}%` : "—"} highlight={adherence != null} />
          <Cell label="Total Minutes" value={data.totalMin > 0 ? String(data.totalMin) : "—"} />
        </div>
      </Card>
    </section>
  );
}

function Cell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-black ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}