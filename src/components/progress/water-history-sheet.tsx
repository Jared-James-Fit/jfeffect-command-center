import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatWater, listWaterHistory } from "@/lib/water";

export function WaterHistorySheet({
  open, onOpenChange, userId, targetMl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  targetMl: number;
}) {
  const { data: days = [] } = useQuery({
    queryKey: ["water-history", userId],
    enabled: open && !!userId,
    queryFn: () => listWaterHistory(userId, 30),
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    if (!days.length) return null;
    const last7 = days.slice(0, 7);
    const avg7 = Math.round(last7.reduce((s, d) => s + d.total_ml, 0) / last7.length);
    const reached = last7.filter((d) => d.total_ml >= targetMl).length;
    let streak = 0;
    for (const d of days) {
      if (d.total_ml >= targetMl) streak += 1;
      else break;
    }
    return { avg7, reachedLast7: reached, streak };
  }, [days, targetMl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Water history</DialogTitle></DialogHeader>
        {stats && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="7-day avg" value={formatWater(stats.avg7, "L")} />
            <Stat label="Hit target" value={`${stats.reachedLast7}/7`} />
            <Stat label="Streak" value={`${stats.streak}d`} />
          </div>
        )}
        <div className="mt-2 space-y-2 overflow-y-auto pr-1">
          {days.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No water logged in the last 30 days.
            </div>
          ) : (
            days.map((d) => {
              const pct = Math.min(100, Math.round((d.total_ml / targetMl) * 100));
              const reached = d.total_ml >= targetMl;
              return (
                <div key={d.date} className="rounded-md border border-border bg-card p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {format(parseISO(d.date), "EEE, MMM d")}
                    </span>
                    {reached ? (
                      <Badge variant="secondary" className="text-[10px]">Target reached</Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">In progress</span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-semibold tabular-nums">
                      {formatWater(d.total_ml, "L")} <span className="text-muted-foreground">of {formatWater(targetMl, "L")}</span>
                    </span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <Progress value={pct} className="mt-1.5 h-1.5" />
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}