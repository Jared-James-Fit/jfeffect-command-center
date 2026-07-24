import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { CoachExtras as CE } from "@/lib/analytics/performance-insights";

export function CoachExtrasCard({ extras }: { extras: CE }) {
  return (
    <Card className="rounded-2xl border-border/60 p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Coach rollups
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Cell
          label="Adherence"
          value={extras.adherence_pct != null ? `${extras.adherence_pct}%` : "—"}
          progress={extras.adherence_pct ?? undefined}
        />
        <Cell label="Missed volume" value={`${extras.missed_volume_sets} sets`} />
        <Cell label="Balance score" value={`${extras.balance_score}/100`} progress={extras.balance_score} />
      </div>
      {/* TODO: client-vs-client comparisons — deferred per spec. */}
    </Card>
  );
}

function Cell({ label, value, progress }: { label: string; value: string; progress?: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
      {progress != null && <Progress value={progress} className="mt-2 h-1.5" />}
    </div>
  );
}