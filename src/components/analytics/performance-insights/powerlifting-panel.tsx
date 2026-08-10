import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import type { CompLiftStat, CompLift } from "@/lib/analytics/performance-insights";
import type { DisplayUnit } from "@/lib/workout-units";

const LIFT_LABEL: Record<CompLift, string> = {
  squat: "Squat", bench: "Bench", deadlift: "Deadlift",
};
const LIFT_EMOJI: Record<CompLift, string> = {
  squat: "🏋️", bench: "💺", deadlift: "🧲",
};

export function PowerliftingPanel({
  lifts,
  onShare,
  fmtTon,
  conv,
  displayUnit,
}: {
  lifts: CompLiftStat[];
  onShare: (lift: CompLiftStat) => void;
  fmtTon: (lb: number) => string;
  conv: (lb: number) => number;
  displayUnit: DisplayUnit;
}) {
  if (!lifts.length) {
    return (
      <Card className="rounded-2xl border-dashed p-6 text-center text-sm text-muted-foreground">
        No competition lift data in this window yet.
      </Card>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {lifts.map((l) => (
        <Card key={l.lift} className="rounded-2xl border-border/60 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {LIFT_EMOJI[l.lift]} {LIFT_LABEL[l.lift]}
              </div>
              <div className="mt-1 text-2xl font-black">
                {l.top_set ? `${conv(l.top_set.load)} ${displayUnit} × ${l.top_set.reps}` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">Top set this window</div>
            </div>
            <button
              type="button"
              onClick={() => onShare(l)}
              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted"
              aria-label={`Share ${LIFT_LABEL[l.lift]}`}
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Weekly volume" value={fmtTon(l.weekly_volume)} />
            <Metric label="Weekly sets" value={String(l.weekly_sets)} />
            <Metric label="Block tonnage" value={fmtTon(l.block_tonnage)} />
            <Metric label="Avg intensity" value={l.avg_intensity_pct != null ? `${l.avg_intensity_pct}%` : "—"} />
            <Metric label="Avg RPE" value={l.avg_rpe != null ? String(l.avg_rpe) : "—"} />
          </div>
          {l.e1rm_trend.length >= 2 && (
            <div className="mt-3 h-24">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={l.e1rm_trend.map((p) => ({ ...p, est_1rm: conv(p.est_1rm), label: format(new Date(p.date), "MMM d") }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9 }} width={30} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="est_1rm" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {l.variations.length > 1 && (
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Variations</div>
              <ul className="mt-1 space-y-1 text-xs">
                {l.variations.map((v) => (
                  <li key={v.name} className="flex items-center justify-between gap-2">
                    <span className="truncate">{v.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{v.sets} · {fmtTon(v.tonnage)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}