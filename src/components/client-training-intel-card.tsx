import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Timer, Trophy, MessageSquare, AlertTriangle, Calendar } from "lucide-react";
import { getClientIntel, LABEL_META } from "@/lib/coach-intel";
import { formatDistanceToNow } from "date-fns";

export function ClientTrainingIntelCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["client-intel", clientId],
    queryFn: () => getClientIntel(clientId),
  });

  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">Loading intelligence…</Card>;
  if (!data) return null;

  const complianceTone =
    data.compliance_pct == null ? "text-muted-foreground" :
    data.compliance_pct >= 80 ? "text-green-500" :
    data.compliance_pct >= 60 ? "text-amber-400" : "text-red-400";

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Activity className="h-4 w-4" /> Training Intelligence
        </h3>
        <div className="flex flex-wrap gap-1 justify-end">
          {data.labels.map((l) => (
            <Badge key={l} variant="outline" className={LABEL_META[l].cls}>{LABEL_META[l].label}</Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 text-xs">
        <Stat label="Compliance (14d)" value={data.compliance_pct != null ? `${data.compliance_pct}%` : "—"} hint={`${data.completed}/${data.assigned} workouts`} cls={complianceTone} />
        <Stat label="Missed workouts" value={String(data.missed)} icon={AlertTriangle} cls={data.missed > 0 ? "text-amber-400" : ""} />
        <Stat label="Last workout" value={data.last_completed_at ? formatDistanceToNow(new Date(data.last_completed_at), { addSuffix: true }) : "—"} />
        <Stat label="Avg duration Δ" value={data.duration_delta_min != null ? `${data.duration_delta_min > 0 ? "+" : ""}${data.duration_delta_min} min` : "Not logged"} icon={Timer} />
        <Stat label="PRs (30d)" value={String(data.recent_pr_count)} icon={Trophy} cls={data.recent_pr_count > 0 ? "text-violet-400" : ""} />
        <Stat label="Client notes" value={String(data.recent_notes.length)} icon={MessageSquare} />
        <Stat label="Pain flags" value={String(data.pain_notes.length)} icon={AlertTriangle} cls={data.pain_notes.length > 0 ? "text-red-400" : ""} />
        {data.event_date && <Stat label="Event" value={data.event_name ?? "—"} hint={data.days_to_event != null ? `${data.days_to_event} days out` : ""} icon={Calendar} />}
      </div>

      {data.pain_notes.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-widest text-red-400 font-bold mb-2">Pain / discomfort flags</div>
          <div className="space-y-2">
            {data.pain_notes.slice(0, 3).map((n, i) => (
              <div key={i} className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs">
                <div className="text-muted-foreground mb-0.5">{n.day_title}{n.exercise && ` • ${n.exercise}`} • {new Date(n.date).toLocaleDateString()}</div>
                <div>{n.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recent_notes.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-2">Recent client notes</div>
          <div className="space-y-2">
            {data.recent_notes.slice(0, 4).map((n, i) => (
              <div key={i} className="rounded border border-border bg-muted/30 p-2 text-xs">
                <div className="text-muted-foreground mb-0.5">{n.day_title}{n.exercise && ` • ${n.exercise}`} • {new Date(n.date).toLocaleDateString()}</div>
                <div className="line-clamp-3">{n.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, hint, icon: Icon, cls }: { label: string; value: string; hint?: string; icon?: any; cls?: string }) {
  return (
    <div>
      <div className="text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className={`font-bold text-sm mt-0.5 ${cls ?? ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}