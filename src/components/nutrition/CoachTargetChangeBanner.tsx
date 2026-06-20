import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getCoachTargetChangeForMe,
  acknowledgeCoachTargetChange,
} from "@/lib/nutrition-targets/member-targets.functions";

type Row = {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  goal: string | null;
  created_at: string;
  input_snapshot?: { note?: string | null } | null;
};

function Delta({ label, prev, next, unit = "" }: { label: string; prev: number | null | undefined; next: number | null | undefined; unit?: string }) {
  if (next == null) return null;
  const diff = prev == null ? null : Number(next) - Number(prev);
  const sign = diff == null || diff === 0 ? "" : diff > 0 ? "+" : "";
  const tone = diff == null || diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1.5">
        {prev != null && (
          <>
            <span className="text-sm text-muted-foreground line-through">{prev}{unit}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </>
        )}
        <span className="text-base font-semibold tabular-nums">{next}{unit}</span>
        {diff != null && diff !== 0 && (
          <span className={`text-xs font-medium tabular-nums ${tone}`}>({sign}{diff}{unit})</span>
        )}
      </div>
    </div>
  );
}

export function CoachTargetChangeBanner() {
  const fetchChange = useServerFn(getCoachTargetChangeForMe);
  const ackFn = useServerFn(acknowledgeCoachTargetChange);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["coach-target-change"],
    queryFn: () => fetchChange(),
    staleTime: 60_000,
    retry: false,
  });

  const ack = useMutation({
    mutationFn: () => ackFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach-target-change"] });
    },
  });

  if (!data?.current) return null;
  const current = data.current as Row;
  const previous = (data.previous ?? null) as Row | null;
  const note = current.input_snapshot?.note ?? null;
  const createdAtLabel = (() => {
    if (!current.created_at) return "";
    const d = new Date(current.created_at);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "";
    }
  })();

  return (
    <Card className="border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/15 p-2 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold">Your coach updated your targets</p>
            <p className="text-xs text-muted-foreground">
              {createdAtLabel}
              {current.goal ? `${createdAtLabel ? " · " : ""}goal: ${current.goal}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Delta label="Calories" prev={previous?.calories} next={current.calories} />
            <Delta label="Protein" prev={previous?.protein_g} next={current.protein_g} unit="g" />
            <Delta label="Carbs" prev={previous?.carbs_g} next={current.carbs_g} unit="g" />
            <Delta label="Fat" prev={previous?.fat_g} next={current.fat_g} unit="g" />
          </div>
          {note && (
            <p className="rounded-md bg-background/60 p-2 text-xs italic text-muted-foreground">
              &ldquo;{note}&rdquo;
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => ack.mutate()}
          disabled={ack.isPending}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}