/**
 * Plan quality, shown the same way for cardio and nutrition (Nov 23 2026): the
 * score out of 100 with its band and one sentence, how sure it is, the
 * categories folded under it, and Optimize with Cleo (which only puts the ask
 * in Cleo's box: the coach reviews whatever comes back, and can always publish
 * their own plan instead). Never presented as a validated or clinical measure.
 */
import { useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CleoMark } from "@/components/summer/cleo-mark";
import { BAND_LABEL, type QualityScore } from "@/lib/plan-quality";

const CONF: Record<QualityScore["confidence"], string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence: limited data",
  insufficient: "Not enough data",
};

function barTone(score: number) {
  return score >= 85 ? "bg-success" : score >= 70 ? "bg-foreground/70" : score >= 55 ? "bg-warning" : "bg-destructive";
}

export function QualityScoreCard({
  title,
  quality,
  onOptimize,
  optimizeLabel = "Optimize with Cleo",
  compact,
  className,
}: {
  title: string;
  quality: QualityScore | null;
  onOptimize?: (ask: string) => void;
  optimizeLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!quality) return null;
  const s = quality.score;
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4", className)} data-plan-quality>
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted" aria-hidden>
          {s == null ? <Gauge className="h-5 w-5 text-muted-foreground" /> : <span className="text-lg font-semibold tabular-nums">{s}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-base font-semibold">{title}</h3>
            {quality.band && <span className="text-sm text-muted-foreground">{BAND_LABEL[quality.band]} · {s}/100</span>}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{quality.summary}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{CONF[quality.confidence]} · a coaching check from what's on file, not a clinical measure</p>
        </div>
      </div>
      {!compact && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-3 flex min-h-10 w-full cursor-pointer items-center justify-between rounded-lg px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          data-quality-toggle
        >
          {open ? "Hide the breakdown" : "See the breakdown"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      )}
      {open && (
        <ul className="mt-1 space-y-2.5" data-quality-categories>
          {quality.categories.map((c) => (
            <li key={c.key}>
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium">{c.label}</span>
                <span className="tabular-nums text-muted-foreground">{c.score == null ? "Not enough data" : c.score}</span>
              </div>
              {c.score != null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className={cn("h-full rounded-full", barTone(c.score))} style={{ width: `${c.score}%` }} />
                </div>
              )}
              {c.notes[0] && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{c.notes.join(" · ")}</p>}
            </li>
          ))}
          {quality.missing.length > 0 && <li className="text-[12px] text-muted-foreground">Would make it surer: {quality.missing.join(", ").toLowerCase()}.</li>}
        </ul>
      )}
      {onOptimize && quality.optimize && (
        <Button variant="outline" className="mt-3 h-10 w-full gap-2 sm:w-auto" onClick={() => onOptimize(quality.optimize!)} data-quality-optimize>
          <CleoMark size={16} /> {optimizeLabel}
        </Button>
      )}
    </section>
  );
}
