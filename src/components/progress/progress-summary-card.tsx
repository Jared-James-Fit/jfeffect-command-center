import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Scale, Ruler, TrendingDown, TrendingUp, Minus, ArrowRight } from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { listBodyweight, listSubmissions, listMeasurements } from "@/lib/progress";

/**
 * Progress Snapshot card for client + member home dashboards.
 * Shows current bodyweight, 7-day change, latest progress photo date,
 * and latest measurement date — with one CTA to the Progress page.
 * Keeps Home focused; all logging happens on the Progress page itself.
 */
export type ProgressSummaryAction = "photo" | "weight" | "measure" | "history";

export function ProgressSummaryCard({
  userId,
  currentUserId,
  viewerRole,
  progressHref,
  title = "Progress Snapshot",
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  progressHref:
    | { kind: "portal" }
    | { kind: "member" }
    | { kind: "admin-client"; clientId: string };
  title?: string;
}) {
  void currentUserId; void viewerRole;

  const { data: bw = [] } = useQuery({
    queryKey: ["progress-bw", userId],
    enabled: !!userId,
    queryFn: () => listBodyweight(userId),
    staleTime: 30_000,
  });
  const { data: photos = [] } = useQuery({
    queryKey: ["progress-subs-photo", userId],
    enabled: !!userId,
    queryFn: () => listSubmissions({ userId, type: "photo" }),
    staleTime: 30_000,
  });
  const { data: meas = [] } = useQuery({
    queryKey: ["progress-meas", userId],
    enabled: !!userId,
    queryFn: () => listMeasurements(userId),
    staleTime: 30_000,
  });

  // Most recent weight & 7-day delta (in the latest entry's unit).
  const sorted = [...bw].sort((a, b) => a.logged_date.localeCompare(b.logged_date));
  const latest = sorted[sorted.length - 1] ?? null;
  const unit = latest?.weight_unit ?? "lb";
  const currentWeight = latest ? `${latest.weight_value} ${unit}` : "—";
  const weekChange = (() => {
    if (!latest || sorted.length < 2) return null;
    const target = new Date(latest.logged_date);
    target.setDate(target.getDate() - 7);
    let prev: typeof sorted[number] | null = null;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (new Date(sorted[i].logged_date) <= target) { prev = sorted[i]; break; }
      prev = sorted[i];
    }
    if (!prev) return null;
    const toLatest = prev.weight_unit === unit
      ? Number(prev.weight_value)
      : prev.weight_unit === "kg"
        ? Number(prev.weight_value) * 2.20462
        : Number(prev.weight_value) / 2.20462;
    return +(Number(latest.weight_value) - toLatest).toFixed(1);
  })();

  const latestPhoto = photos[0]?.submission_date ?? null;
  const latestMeas = meas[0]?.measured_date ?? null;

  const fmtAgo = (d: string | null) => {
    if (!d) return "Not yet";
    try {
      const days = differenceInDays(new Date(), parseISO(d));
      if (days <= 0) return "Today";
      if (days === 1) return "Yesterday";
      if (days < 30) return `${days}d ago`;
      return format(parseISO(d), "MMM d");
    } catch { return d; }
  };

  const TrendIcon = weekChange == null ? Minus : weekChange < 0 ? TrendingDown : weekChange > 0 ? TrendingUp : Minus;
  const trendTone = weekChange == null ? "text-muted-foreground" : weekChange <= 0 ? "text-emerald-500" : "text-amber-500";

  const ctaClass = "mt-4 h-12 w-full font-bold uppercase tracking-wide";
  const cta = (
    <Button className={ctaClass}>
      View Progress <ArrowRight className="ml-1.5 h-4 w-4" />
    </Button>
  );

  const ViewCta = () => {
    if (progressHref.kind === "portal") return <Link to="/portal/progress">{cta}</Link>;
    if (progressHref.kind === "member") return <Link to="/m/progress">{cta}</Link>;
    return (
      <Link to="/admin/clients/$id/progress" params={{ id: progressHref.clientId }}>{cta}</Link>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest">{title}</span>
        </div>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat
            icon={Scale}
            label="Current weight"
            value={currentWeight}
          />
          <Stat
            icon={TrendIcon}
            label="7-day change"
            value={weekChange == null
              ? "—"
              : `${weekChange > 0 ? "+" : ""}${weekChange} ${unit}`}
            tone={trendTone}
          />
          <Stat
            icon={Camera}
            label="Latest photo"
            value={fmtAgo(latestPhoto)}
          />
          <Stat
            icon={Ruler}
            label="Latest measurement"
            value={fmtAgo(latestMeas)}
          />
        </div>
        <ViewCta />
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon, label, value, tone,
}: { icon: any; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone ?? ""}`} />
        {label}
      </div>
      <div className={`mt-1 text-base font-bold leading-tight ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

