import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Activity, Trophy, AlertTriangle, MessageSquare, Calendar, Timer, ArrowRight, Search } from "lucide-react";
import { getCoachIntel, filterIntel, LABEL_META, type FilterKey, type ClientIntel } from "@/lib/coach-intel";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/training-intelligence")({ component: TrainingIntelPage });

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All clients" },
  { key: "attention", label: "Needs attention" },
  { key: "pr", label: "PRs" },
  { key: "missed", label: "Missed workouts" },
  { key: "pain", label: "Pain flags" },
  { key: "event", label: "Event soon" },
  { key: "low_comp", label: "Low compliance" },
];

function TrainingIntelPage() {
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [search, setSearch] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-intel"],
    queryFn: () => getCoachIntel(),
  });

  const filtered = useMemo(() => {
    let r = filterIntel(data, filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((c) => c.full_name.toLowerCase().includes(q));
    }
    // Sort: attention-worthy first, then by name
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

  const summary = useMemo(() => ({
    total: data.length,
    prs: data.reduce((s, c) => s + c.recent_pr_count, 0),
    missed: data.filter((c) => c.missed > 0).length,
    pain: data.filter((c) => c.labels.includes("pain_flag")).length,
    notes: data.reduce((s, c) => s + c.recent_notes.length, 0),
    events: data.filter((c) => c.labels.includes("event_soon")).length,
  }), [data]);

  return (
    <>
      <PageHeader title="Training Intelligence" subtitle="Who needs your attention today." />
      <div className="p-6 md:p-8 space-y-6">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <SummaryStat icon={Activity} label="Clients" value={summary.total} />
          <SummaryStat icon={Trophy}   label="PRs (30d)" value={summary.prs} tone="violet" />
          <SummaryStat icon={AlertTriangle} label="Missed workouts" value={summary.missed} tone="amber" />
          <SummaryStat icon={AlertTriangle} label="Pain flags" value={summary.pain} tone="red" />
          <SummaryStat icon={MessageSquare} label="Recent notes" value={summary.notes} />
          <SummaryStat icon={Calendar} label="Event soon" value={summary.events} tone="primary" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
              {f.label}
            </Button>
          ))}
          <div className="relative ml-auto w-56">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Search client…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            Nothing here right now. Switch filters to view more clients.
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((c) => <IntelCard key={c.client_id} c={c} />)}
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

function IntelCard({ c }: { c: ClientIntel }) {
  const initials = c.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const complianceTone =
    c.compliance_pct == null ? "text-muted-foreground" :
    c.compliance_pct >= 80 ? "text-green-500" :
    c.compliance_pct >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <Card className="p-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12">
          {c.profile_picture_url && <AvatarImage src={c.profile_picture_url} alt="" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold truncate">{c.full_name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {c.active_block_name ?? c.prep_title ?? "No active block"}
                {c.prep_goal_type && <span className="ml-1">• {c.prep_goal_type}</span>}
              </div>
            </div>
            <Link to="/admin/client-programs/$clientId" params={{ clientId: c.client_id }}>
              <Button size="sm" variant="ghost"><ArrowRight className="h-4 w-4" /></Button>
            </Link>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {c.labels.map((l) => (
              <Badge key={l} variant="outline" className={LABEL_META[l].cls}>{LABEL_META[l].label}</Badge>
            ))}
          </div>

          <div className="mt-3 grid gap-2 grid-cols-2 text-xs">
            <div>
              <div className="text-muted-foreground">Compliance (14d)</div>
              <div className={`font-bold ${complianceTone}`}>
                {c.compliance_pct != null ? `${c.compliance_pct}%` : "—"}
                <span className="ml-1 text-muted-foreground font-normal">{c.completed}/{c.assigned}</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Last workout</div>
              <div className="font-bold">
                {c.last_completed_at ? formatDistanceToNow(new Date(c.last_completed_at), { addSuffix: true }) : "—"}
              </div>
            </div>
            {c.duration_delta_min != null && (
              <div>
                <div className="text-muted-foreground flex items-center gap-1"><Timer className="h-3 w-3" /> Avg duration Δ</div>
                <div className="font-bold">{c.duration_delta_min > 0 ? `+${c.duration_delta_min}` : c.duration_delta_min} min</div>
              </div>
            )}
            {c.event_date && (
              <div>
                <div className="text-muted-foreground">Event</div>
                <div className="font-bold">{c.event_name ?? "—"}{c.days_to_event != null && ` • ${c.days_to_event}d`}</div>
              </div>
            )}
            {c.recent_pr_count > 0 && (
              <div>
                <div className="text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" /> PRs (30d)</div>
                <div className="font-bold text-violet-400">{c.recent_pr_count}</div>
              </div>
            )}
            {c.recent_notes.length > 0 && (
              <div>
                <div className="text-muted-foreground flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Notes</div>
                <div className="font-bold">{c.recent_notes.length}</div>
              </div>
            )}
          </div>

          {(c.pain_notes[0] || c.recent_notes[0]) && (
            <div className={`mt-3 rounded border p-2 text-xs ${c.pain_notes[0] ? "border-red-500/30 bg-red-500/5" : "border-border bg-muted/30"}`}>
              <div className="text-muted-foreground mb-0.5">
                {(c.pain_notes[0] ?? c.recent_notes[0]).day_title}
                {(c.pain_notes[0] ?? c.recent_notes[0]).exercise && ` • ${(c.pain_notes[0] ?? c.recent_notes[0]).exercise}`}
              </div>
              <div className="line-clamp-2">{(c.pain_notes[0] ?? c.recent_notes[0]).note}</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}