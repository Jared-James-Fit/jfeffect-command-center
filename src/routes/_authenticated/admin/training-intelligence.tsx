import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Activity, Trophy, AlertTriangle, MessageSquare, Calendar, Timer, Search, ClipboardList, TrendingDown } from "lucide-react";
import { getCoachIntel, filterIntel, LABEL_META, type FilterKey, type ClientIntel, listFollowups } from "@/lib/coach-intel";
import { formatDistanceToNow } from "date-fns";
import {
  ClientQuickLinks, ReviewAlertButton, PainFlagActions, OpenWorkoutLink,
  FollowupRow, FollowupDialog, MarkAllClientReviewed, highlightPainHtml,
} from "@/components/intel-actions";

export const Route = createFileRoute("/_authenticated/admin/training-intelligence")({ component: TrainingIntelPage });

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "followup", label: "Needs follow-up" },
  { key: "pain", label: "Pain flags" },
  { key: "missed", label: "Missed workouts" },
  { key: "low_comp", label: "Low compliance" },
  { key: "pr", label: "PRs" },
  { key: "event", label: "Event soon" },
  { key: "powerlifting", label: "Powerlifting" },
  { key: "bodybuilding", label: "Bodybuilding" },
];

function TrainingIntelPage() {
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [search, setSearch] = useState("");
  const { data = [], isLoading } = useQuery({ queryKey: ["coach-intel"], queryFn: () => getCoachIntel() });
  const { data: followups = [] } = useQuery({ queryKey: ["followups"], queryFn: () => listFollowups() });

  const filtered = useMemo(() => {
    let r = filterIntel(data, filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((c) => c.full_name.toLowerCase().includes(q));
    }
    const score = (c: ClientIntel) =>
      (c.labels.includes("pain_flag") ? 100 : 0) +
      (c.labels.includes("inactive") ? 60 : 0) +
      (c.labels.includes("low_compliance") ? 40 : 0) +
      (c.labels.includes("needs_followup") ? 30 : 0) +
      (c.labels.includes("event_soon") ? 25 : 0) +
      (c.labels.includes("needs_review") ? 10 : 0) -
      (c.labels.includes("on_track") ? 20 : 0);
    return [...r].sort((a, b) => score(b) - score(a) || a.full_name.localeCompare(b.full_name));
  }, [data, filter, search]);

  const sections = useMemo(() => ({
    followup: data.filter((c) => c.open_followups.length > 0 || c.missed >= 2),
    pain:     data.filter((c) => c.pain_flags.length > 0),
    missed:   data.filter((c) => c.missed > 0 || (c.compliance_pct != null && c.compliance_pct < 60)),
    prs:      data.filter((c) => c.recent_prs.length > 0),
    event:    data.filter((c) => c.labels.includes("event_soon")),
    notes:    data.filter((c) => c.recent_notes.length > 0 && c.pain_flags.length === 0),
  }), [data]);

  const summary = useMemo(() => ({
    total: data.length,
    prs: data.reduce((s, c) => s + c.recent_prs.length, 0),
    missed: data.filter((c) => c.missed > 0).length,
    pain: data.filter((c) => c.pain_flags.length > 0).length,
    notes: data.reduce((s, c) => s + c.recent_notes.length, 0),
    events: data.filter((c) => c.labels.includes("event_soon")).length,
    followups: followups.filter((f) => f.status === "open").length,
  }), [data, followups]);

  return (
    <>
      <PageHeader title="Training Intelligence" subtitle="Action dashboard — see issue, take action, mark reviewed." />
      <div className="p-6 md:p-8 space-y-6">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
          <SummaryStat icon={Activity} label="Clients" value={summary.total} />
          <SummaryStat icon={ClipboardList} label="Open follow-ups" value={summary.followups} tone="amber" />
          <SummaryStat icon={AlertTriangle} label="Pain flags" value={summary.pain} tone="red" />
          <SummaryStat icon={TrendingDown} label="Missed workouts" value={summary.missed} tone="amber" />
          <SummaryStat icon={Trophy} label="PRs (30d)" value={summary.prs} tone="violet" />
          <SummaryStat icon={MessageSquare} label="Notes to review" value={summary.notes} />
          <SummaryStat icon={Calendar} label="Event soon" value={summary.events} tone="primary" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>{f.label}</Button>
          ))}
          <div className="relative ml-auto w-56">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filter !== "all" ? (
          filtered.length === 0 ? <EmptyCard /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((c) => <ClientActionCard key={c.client_id} c={c} />)}
            </div>
          )
        ) : (
          <div className="space-y-8">
            <Section title="Needs follow-up" icon={ClipboardList} clients={sections.followup} variant="followup" allFollowups={followups} />
            <Section title="Pain / discomfort flags" icon={AlertTriangle} clients={sections.pain} variant="pain" />
            <Section title="Missed workouts & low compliance" icon={TrendingDown} clients={sections.missed} variant="missed" />
            <Section title="PRs & milestones" icon={Trophy} clients={sections.prs} variant="pr" />
            <Section title="Event approaching" icon={Calendar} clients={sections.event} variant="event" />
            <Section title="Recent notes to review" icon={MessageSquare} clients={sections.notes} variant="notes" />
          </div>
        )}
      </div>
    </>
  );
}

function SummaryStat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "amber" | "red" | "violet" | "primary" }) {
  const cls =
    tone === "amber" ? "bg-amber-500/15 text-amber-400" :
    tone === "red"   ? "bg-red-500/15 text-red-400" :
    tone === "violet"? "bg-violet-500/15 text-violet-400" :
    tone === "primary"? "bg-primary/15 text-primary" :
    "bg-secondary text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-black">{value}</div>
        </div>
        <div className={`grid h-9 w-9 place-items-center rounded-md ${cls}`}><Icon className="h-4 w-4" /></div>
      </div>
    </Card>
  );
}

function EmptyCard() {
  return <Card className="p-10 text-center text-sm text-muted-foreground">Nothing here. Try another filter.</Card>;
}

function Section({ title, icon: Icon, clients, variant, allFollowups }: { title: string; icon: any; clients: ClientIntel[]; variant: "followup"|"pain"|"missed"|"pr"|"event"|"notes"; allFollowups?: any[] }) {
  if (clients.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
        <Badge variant="outline">{clients.length}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {clients.map((c) => <ClientActionCard key={c.client_id} c={c} focus={variant} allFollowups={allFollowups} />)}
      </div>
    </div>
  );
}

function ClientHeader({ c }: { c: ClientIntel }) {
  const initials = c.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const grouped = c.missed_days.length + c.recent_prs.length + c.recent_notes.length + c.pain_flags.length + c.open_followups.length;
  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-12 w-12">
        {c.profile_picture_url && <AvatarImage src={c.profile_picture_url} alt="" />}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to="/admin/client-programs/$clientId" params={{ clientId: c.client_id }} className="font-bold hover:underline truncate block">{c.full_name}</Link>
            <div className="text-xs text-muted-foreground truncate">
              {c.active_block_name ?? c.prep_title ?? "No active block"}
              {c.prep_goal_type && <span className="ml-1">• {c.prep_goal_type}</span>}
              {grouped > 1 && <span className="ml-1">• {grouped} updates needing review</span>}
            </div>
          </div>
          <ClientQuickLinks c={c} compact />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {c.labels.map((l) => (
            <Badge key={l} variant="outline" className={LABEL_META[l].cls}>{LABEL_META[l].label}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientActionCard({ c, focus, allFollowups }: { c: ClientIntel; focus?: "followup"|"pain"|"missed"|"pr"|"event"|"notes"; allFollowups?: any[] }) {
  const [followupOpen, setFollowupOpen] = useState(false);
  const complianceTone =
    c.compliance_pct == null ? "text-muted-foreground" :
    c.compliance_pct >= 80 ? "text-green-500" :
    c.compliance_pct >= 60 ? "text-amber-400" : "text-red-400";
  const myFollowups = (allFollowups ?? c.open_followups).filter((f: any) => f.client_id === c.client_id && f.status === "open");

  return (
    <Card className="p-4 space-y-3">
      <ClientHeader c={c} />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Compliance (14d)" value={c.compliance_pct != null ? `${c.compliance_pct}%` : "—"} hint={`${c.completed}/${c.assigned}`} cls={complianceTone} />
        <Stat label="Last workout" value={c.last_completed_at ? formatDistanceToNow(new Date(c.last_completed_at), { addSuffix: true }) : "—"} />
        {c.duration_delta_min != null && (
          <Stat icon={Timer} label="Avg duration Δ" value={`${c.duration_delta_min > 0 ? "+" : ""}${c.duration_delta_min} min`} />
        )}
        {c.event_date && <Stat icon={Calendar} label="Event" value={c.event_name ?? "—"} hint={c.days_to_event != null ? `${c.days_to_event}d` : ""} />}
      </div>

      {/* Pain flags */}
      {(focus === "pain" || c.pain_flags.length > 0) && c.pain_flags.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-red-400 font-bold">Pain / discomfort</div>
          {c.pain_flags.slice(0, 3).map((p) => (
            <div key={p.id} className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs space-y-1">
              <div className="text-muted-foreground">
                {p.day_title ?? "Workout"}{p.exercise && ` • ${p.exercise}`}
                {p.note_date && ` • ${new Date(p.note_date).toLocaleDateString()}`}
              </div>
              <div>{highlightPainHtml(p.note_text)}</div>
              {p.matched_keywords?.length > 0 && (
                <div className="text-[10px] text-muted-foreground">Triggered by: {p.matched_keywords.join(", ")}</div>
              )}
              <PainFlagActions flag={p} clientId={c.client_id} />
            </div>
          ))}
        </div>
      )}

      {/* Missed workouts */}
      {(focus === "missed" || focus === "followup") && c.missed_days.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">
            Missed {c.missed_days.length} workout{c.missed_days.length > 1 ? "s" : ""}
          </div>
          {c.missed_days.slice(0, 3).map((m) => (
            <div key={m.day_id} className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium">{m.title}</div>
                <div className="text-muted-foreground">Scheduled {m.scheduled_date}</div>
              </div>
              <div className="flex items-center gap-1">
                <OpenWorkoutLink dayId={m.day_id} label="Open" />
                <ReviewAlertButton clientId={c.client_id} alertKey={m.alert_key} alertKind="missed" label="" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PR events */}
      {focus === "pr" && c.recent_prs.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-violet-400 font-bold">PRs (30d)</div>
          {c.recent_prs.slice(0, 4).map((p) => (
            <div key={p.alert_key} className="flex items-center justify-between gap-2 rounded border border-violet-500/30 bg-violet-500/5 p-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {p.exercise} — {p.actual_load} × {p.actual_reps}
                </div>
                <div className="text-muted-foreground">est 1RM {p.est_1rm} (was {p.baseline}) • {new Date(p.date).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-1">
                <OpenWorkoutLink dayId={p.day_id} label="Open" />
                <ReviewAlertButton clientId={c.client_id} alertKey={p.alert_key} alertKind="pr" label="" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {(focus === "notes" || focus === undefined) && c.recent_notes.length > 0 && c.pain_flags.length === 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Recent notes</div>
          {c.recent_notes.slice(0, 3).map((n) => (
            <div key={n.alert_key} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="text-muted-foreground truncate">
                  {n.day_title}{n.exercise && ` • ${n.exercise}`} • {new Date(n.date).toLocaleDateString()}
                </div>
                <ReviewAlertButton clientId={c.client_id} alertKey={n.alert_key} alertKind="note" label="" />
              </div>
              <div className="mt-1 line-clamp-3">{n.note}</div>
              {n.day_id && <OpenWorkoutLink dayId={n.day_id} label="Open workout" />}
            </div>
          ))}
        </div>
      )}

      {/* Open follow-ups */}
      {(focus === "followup" || myFollowups.length > 0) && myFollowups.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Open follow-ups</div>
          {myFollowups.slice(0, 3).map((f: any) => <FollowupRow key={f.id} f={f} />)}
        </div>
      )}

      {/* Event */}
      {focus === "event" && c.event_date && (
        <div className="rounded border border-primary/30 bg-primary/5 p-2 text-xs">
          <div className="font-bold">{c.event_name ?? "Event"}</div>
          <div className="text-muted-foreground">{c.event_date}{c.days_to_event != null && ` • ${c.days_to_event} days out`}</div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div className="text-[10px] text-muted-foreground">
          {c.last_reviewed_at ? `Last reviewed ${formatDistanceToNow(new Date(c.last_reviewed_at), { addSuffix: true })}` : "Never reviewed"}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setFollowupOpen(true)}>
            <ClipboardList className="mr-1 h-3.5 w-3.5" /> New follow-up
          </Button>
          <MarkAllClientReviewed c={c} />
        </div>
      </div>

      <FollowupDialog open={followupOpen} onOpenChange={setFollowupOpen} clientId={c.client_id} />
    </Card>
  );
}

function Stat({ icon: Icon, label, value, hint, cls }: { icon?: any; label: string; value: string; hint?: string; cls?: string }) {
  return (
    <div>
      <div className="text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className={`font-bold text-sm mt-0.5 ${cls ?? ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
