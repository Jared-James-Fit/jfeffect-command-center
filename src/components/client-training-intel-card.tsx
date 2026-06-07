import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Timer, Trophy, MessageSquare, AlertTriangle, Calendar, ClipboardList } from "lucide-react";
import { getClientIntel, LABEL_META, listFollowups } from "@/lib/coach-intel";
import { formatDistanceToNow } from "date-fns";
import {
  ClientQuickLinks, ReviewAlertButton, PainFlagActions, OpenWorkoutLink,
  FollowupDialog, FollowupRow, MarkAllClientReviewed, highlightPainHtml,
} from "@/components/intel-actions";

export function ClientTrainingIntelCard({ clientId }: { clientId: string }) {
  const [followupOpen, setFollowupOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["client-intel", clientId],
    queryFn: () => getClientIntel(clientId),
  });
  const { data: followups = [] } = useQuery({
    queryKey: ["followups", clientId],
    queryFn: () => listFollowups(clientId),
  });

  if (isLoading) return <Card className="p-4 text-sm text-muted-foreground">Loading intelligence…</Card>;
  if (!data) return null;

  const complianceTone =
    data.compliance_pct == null ? "text-muted-foreground" :
    data.compliance_pct >= 80 ? "text-green-500" :
    data.compliance_pct >= 60 ? "text-amber-400" : "text-red-400";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Activity className="h-4 w-4" /> Training Intelligence
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <ClientQuickLinks c={{ client_id: clientId, full_name: data.full_name }} />
          <Button size="sm" variant="ghost" onClick={() => setFollowupOpen(true)}>
            <ClipboardList className="mr-1 h-3.5 w-3.5" /> New follow-up
          </Button>
          <MarkAllClientReviewed c={data} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {data.labels.map((l) => (
          <Badge key={l} variant="outline" className={LABEL_META[l].cls}>{LABEL_META[l].label}</Badge>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 text-xs">
        <Stat label="Compliance (14d)" value={data.compliance_pct != null ? `${data.compliance_pct}%` : "—"} hint={`${data.completed}/${data.assigned} workouts`} cls={complianceTone} />
        <Stat label="Missed workouts" value={String(data.missed)} icon={AlertTriangle} cls={data.missed > 0 ? "text-amber-400" : ""} />
        <Stat label="Last workout" value={data.last_completed_at ? formatDistanceToNow(new Date(data.last_completed_at), { addSuffix: true }) : "—"} />
        <Stat label="Avg duration Δ" value={data.duration_delta_min != null ? `${data.duration_delta_min > 0 ? "+" : ""}${data.duration_delta_min} min` : "Not logged"} icon={Timer} />
        <Stat label="PRs (30d)" value={String(data.recent_prs.length)} icon={Trophy} cls={data.recent_prs.length > 0 ? "text-violet-400" : ""} />
        <Stat label="Client notes" value={String(data.recent_notes.length)} icon={MessageSquare} />
        <Stat label="Pain flags" value={String(data.pain_flags.length)} icon={AlertTriangle} cls={data.pain_flags.length > 0 ? "text-red-400" : ""} />
        {data.event_date && <Stat label="Event" value={data.event_name ?? "—"} hint={data.days_to_event != null ? `${data.days_to_event} days out` : ""} icon={Calendar} />}
      </div>

      <div className="text-[10px] text-muted-foreground">
        {data.last_reviewed_at ? `Last reviewed ${formatDistanceToNow(new Date(data.last_reviewed_at), { addSuffix: true })}` : "Never reviewed"}
      </div>

      {data.pain_flags.length > 0 && (
        <Section title="Pain / discomfort" tone="red">
          {data.pain_flags.map((p) => (
            <div key={p.id} className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs space-y-1">
              <div className="text-muted-foreground">
                {p.day_title ?? "Workout"}{p.exercise && ` • ${p.exercise}`}{p.note_date && ` • ${new Date(p.note_date).toLocaleDateString()}`}
              </div>
              <div>{highlightPainHtml(p.note_text)}</div>
              {p.matched_keywords?.length > 0 && (
                <div className="text-[10px] text-muted-foreground">Triggered by: {p.matched_keywords.join(", ")}</div>
              )}
              <PainFlagActions flag={p} clientId={clientId} />
            </div>
          ))}
        </Section>
      )}

      {data.missed_days.length > 0 && (
        <Section title={`Missed ${data.missed_days.length} workout${data.missed_days.length > 1 ? "s" : ""}`} tone="amber">
          {data.missed_days.slice(0, 5).map((m) => (
            <div key={m.day_id} className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium">{m.title}</div>
                <div className="text-muted-foreground">Scheduled {m.scheduled_date}</div>
              </div>
              <div className="flex items-center gap-1">
                <OpenWorkoutLink dayId={m.day_id} label="Open" />
                <ReviewAlertButton clientId={clientId} alertKey={m.alert_key} alertKind="missed" label="" />
              </div>
            </div>
          ))}
        </Section>
      )}

      {data.recent_prs.length > 0 && (
        <Section title="Recent PRs" tone="violet">
          {data.recent_prs.slice(0, 5).map((p) => (
            <div key={p.alert_key} className="flex items-center justify-between gap-2 rounded border border-violet-500/30 bg-violet-500/5 p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.exercise} — {p.actual_load} × {p.actual_reps}</div>
                <div className="text-muted-foreground">est 1RM {p.est_1rm} (was {p.baseline}) • {new Date(p.date).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-1">
                <OpenWorkoutLink dayId={p.day_id} label="Open" />
                <ReviewAlertButton clientId={clientId} alertKey={p.alert_key} alertKind="pr" label="" />
              </div>
            </div>
          ))}
        </Section>
      )}

      {data.recent_notes.length > 0 && (
        <Section title="Recent notes">
          {data.recent_notes.slice(0, 5).map((n) => (
            <div key={n.alert_key} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="text-muted-foreground truncate">
                  {n.day_title}{n.exercise && ` • ${n.exercise}`} • {new Date(n.date).toLocaleDateString()}
                </div>
                <ReviewAlertButton clientId={clientId} alertKey={n.alert_key} alertKind="note" label="" />
              </div>
              <div className="mt-1 line-clamp-3">{n.note}</div>
              {n.day_id && <OpenWorkoutLink dayId={n.day_id} label="Open workout" />}
            </div>
          ))}
        </Section>
      )}

      {followups.length > 0 && (
        <Section title="Follow-ups" tone="amber">
          {followups.map((f) => <FollowupRow key={f.id} f={f} />)}
        </Section>
      )}

      <FollowupDialog open={followupOpen} onOpenChange={setFollowupOpen} clientId={clientId} />
    </Card>
  );
}

function Section({ title, tone, children }: { title: string; tone?: "red" | "amber" | "violet"; children: React.ReactNode }) {
  const cls = tone === "red" ? "text-red-400" : tone === "amber" ? "text-amber-400" : tone === "violet" ? "text-violet-400" : "text-muted-foreground";
  return (
    <div className="space-y-2">
      <div className={`text-[10px] uppercase tracking-widest font-bold ${cls}`}>{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
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
