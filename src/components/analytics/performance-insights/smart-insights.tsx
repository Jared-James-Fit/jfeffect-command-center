import { Card } from "@/components/ui/card";
import { Share2 } from "lucide-react";
import type { PerformanceInsight } from "@/lib/analytics/performance-insights";

export function SmartInsights({
  insights,
  onShare,
}: {
  insights: PerformanceInsight[];
  onShare: (i: PerformanceInsight) => void;
}) {
  if (!insights.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {insights.map((i) => (
        <Card key={i.id} className="flex items-start justify-between gap-3 rounded-2xl border-border/60 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">{i.emoji}</span>
              <div className="text-sm font-bold leading-snug">{i.headline}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{i.subline}</div>
          </div>
          {i.shareable && (
            <button
              type="button"
              onClick={() => onShare(i)}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted"
              aria-label="Share insight"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}