import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Droplet, Plus, History } from "lucide-react";
import { toast } from "sonner";
import {
  addWaterEntry, ensureWaterTarget, formatWater, listWaterForDate,
  summarizeToday, todayLocalISO,
} from "@/lib/water";

type Surface = "portal" | "member";

interface Props {
  userId: string;
  currentUserId: string;
  surface: Surface;
}

const QUICK_ADDS = [
  { label: "+250ml", ml: 250 },
  { label: "+500ml", ml: 500 },
  { label: "+1L", ml: 1000 },
];

/**
 * Shared "Water Today" card for portal + member Home dashboards. Larger,
 * tappable quick-add buttons + visible progress bar. Reads/writes the
 * same data as the Progress page water tracker.
 */
export function HomeWaterCard({ userId, currentUserId, surface }: Props) {
  const today = todayLocalISO();
  const qc = useQueryClient();

  const { data: target } = useQuery({
    queryKey: ["water-target", userId],
    enabled: !!userId,
    queryFn: () => ensureWaterTarget(userId),
    staleTime: 30_000,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["water-today", userId, today],
    enabled: !!userId,
    queryFn: () => listWaterForDate(userId, today),
    staleTime: 5_000,
  });

  const targetMl = target?.active_ml ?? 3000;
  const summary = summarizeToday(entries, targetMl);

  async function quickAdd(ml: number) {
    try {
      await addWaterEntry({ userId, amountMl: ml, source: "quick_add", createdByUserId: currentUserId });
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log water");
    }
  }

  const historyHref = surface === "portal" ? "/portal/progress" : "/m/progress";

  return (
    <Card className="border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Droplet className="h-4 w-4" />
          </div>
          <h3 className="text-base font-bold">Water Today</h3>
        </div>
        <Link
          to={historyHref}
          search={{ action: "history" } as never}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" /> Open
        </Link>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-black tabular-nums">
            {formatWater(summary.total, "L")}
            <span className="ml-1 text-sm font-medium text-muted-foreground">/ {formatWater(targetMl, "L")}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{summary.pct}% of today's target</div>
        </div>
      </div>
      <Progress value={summary.pct} className="mt-3 h-2.5" />

      <div className="mt-4 grid grid-cols-3 gap-2">
        {QUICK_ADDS.map((q) => (
          <Button
            key={q.ml}
            variant="secondary"
            className="h-12 text-sm font-bold"
            onClick={() => quickAdd(q.ml)}
          >
            <Plus className="mr-1 h-4 w-4" />{q.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}