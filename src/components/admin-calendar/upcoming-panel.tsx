import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listUpcomingUnified, type UnifiedRow } from "@/lib/calendar-upcoming.functions";
import { markAppointmentStatus, cancelAppointment } from "@/lib/appointments.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Calendar as CalendarIcon, RefreshCw, Search, ExternalLink, Video, Copy,
  CheckCircle2, AlertTriangle, X, CalendarClock, User, Link2 as LinkIcon, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { runJob } from "@/lib/progress-jobs";
import { RescheduleDialog } from "@/components/appointments/reschedule-dialog";
import { CancelAppointmentDialog } from "@/components/appointments/cancel-dialog";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function bucket(rowStarts: string): "today" | "tomorrow" | "this_week" | "later" | "past" {
  const t = startOfDay(new Date());
  const r = new Date(rowStarts);
  if (r < t) return "past";
  const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1);
  const dayAfter = new Date(t); dayAfter.setDate(t.getDate() + 2);
  const weekEnd = new Date(t); weekEnd.setDate(t.getDate() + 7);
  if (r < tomorrow) return "today";
  if (r < dayAfter) return "tomorrow";
  if (r < weekEnd) return "this_week";
  return "later";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "Today", tomorrow: "Tomorrow", this_week: "This Week", later: "Later", past: "Recently Past",
};

export function UpcomingPanel() {
  const navigate = useNavigate({ from: "/admin/calendar" });
  const search = useSearch({ from: "/_authenticated/admin/calendar" }) as any;
  const list = useServerFn(listUpcomingUnified);
  const qc = useQueryClient();

  const q: string = search.q ?? "";
  const fSource: string = search.source ?? "all";
  const fStatus: string = search.status ?? "all";
  const fType: string = search.type ?? "all";
  const fLink: string = search.link ?? "all"; // all|linked|unlinked|google_only

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["calendar-upcoming"],
    queryFn: () => list({ data: { windowDays: 30 } }),
    staleTime: 30_000,
  });

  const rows: UnifiedRow[] = data?.rows ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fSource !== "all" && r.source !== fSource) return false;
      if (fStatus !== "all" && (r.status || "").toLowerCase() !== fStatus.toLowerCase()) return false;
      if (fType !== "all" && (r.appointment_type || "") !== fType) return false;
      if (fLink === "linked" && !r.client_id) return false;
      if (fLink === "unlinked" && (r.client_id || r.source === "google")) return false;
      if (fLink === "google_only" && r.source !== "google") return false;
      if (term) {
        const hay = `${r.title} ${r.attendee_name ?? ""} ${r.attendee_email ?? ""} ${r.attendee_phone ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, q, fSource, fStatus, fType, fLink]);

  const grouped = useMemo(() => {
    const g: Record<string, UnifiedRow[]> = { today: [], tomorrow: [], this_week: [], later: [], past: [] };
    for (const r of filtered) g[bucket(r.starts_at)].push(r);
    return g;
  }, [filtered]);

  const apptTypes = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.appointment_type).filter(Boolean))) as string[];
  }, [rows]);

  function setSearch(key: string, value: string) {
    navigate({
      search: (prev: any) => {
        const next = { ...prev };
        if (!value || value === "all" || value === "") delete next[key]; else next[key] = value;
        return next;
      },
      replace: true,
    });
  }

  function clearFilters() {
    navigate({ search: (prev: any) => ({ tab: prev?.tab ?? "upcoming" }), replace: true });
  }

  async function handleRefresh() {
    await runJob({ title: "Refresh calendar", description: "Pulling Google Calendar + appointments" }, async (h) => {
      h.setSteps([
        { label: "Check connection", done: false },
        { label: "Fetch events", done: false },
        { label: "Deduplicate", done: false },
        { label: "Refresh view", done: false },
      ]);
      h.completeStep(0);
      await refetch();
      h.completeStep(1);
      h.completeStep(2);
      qc.invalidateQueries({ queryKey: ["calendar-upcoming"] });
      h.completeStep(3);
    });
  }

  const total = filtered.length;
  const activeFilters = [fSource, fStatus, fType, fLink].filter((v) => v && v !== "all").length + (q ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Upcoming"
        subtitle="Unified view of appointments, PT sessions, and Google Calendar events."
        actions={
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />
      <div className="p-3 sm:p-6 md:p-8 space-y-4">
        {/* Filters */}
        <Card className="border-border bg-card p-3 md:p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:flex-1 sm:min-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, email, phone, title"
                value={q}
                onChange={(e) => setSearch("q", e.target.value)}
                className="pl-7 h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:contents">
            <Select value={fSource} onValueChange={(v) => setSearch("source", v)}>
              <SelectTrigger className="h-8 w-full sm:w-[140px] text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="appointment">Appointments</SelectItem>
                <SelectItem value="pt_session">PT Sessions</SelectItem>
                <SelectItem value="google">Google only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fStatus} onValueChange={(v) => setSearch("status", v)}>
              <SelectTrigger className="h-8 w-full sm:w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="Scheduled">Scheduled</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
                <SelectItem value="NoShow">No-show</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fType} onValueChange={(v) => setSearch("type", v)}>
              <SelectTrigger className="h-8 w-full sm:w-[160px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {apptTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fLink} onValueChange={(v) => setSearch("link", v)}>
              <SelectTrigger className="h-8 w-full sm:w-[150px] text-xs"><SelectValue placeholder="CRM Link" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rows</SelectItem>
                <SelectItem value="linked">CRM-linked</SelectItem>
                <SelectItem value="unlinked">Unlinked</SelectItem>
                <SelectItem value="google_only">Google-only</SelectItem>
              </SelectContent>
            </Select>
            </div>
            <div className="flex items-center justify-between gap-2 sm:ml-auto sm:contents">
            {activeFilters > 0 && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFilters}>
                <Filter className="mr-1 h-3 w-3" /> Clear ({activeFilters})
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"}</span>
            </div>
          </div>
        </Card>

        {isLoading ? (
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">Loading…</Card>
        ) : filtered.length === 0 ? (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
            <CalendarIcon className="mx-auto mb-2 h-6 w-6" />
            No upcoming events match your filters.
          </Card>
        ) : (
          <div className="space-y-6">
            {(["today","tomorrow","this_week","later","past"] as const).map((b) => {
              if (!grouped[b]?.length) return null;
              return (
                <section key={b} className="space-y-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    {BUCKET_LABELS[b]} <span className="ml-1 text-muted-foreground/60">({grouped[b].length})</span>
                  </h3>
                  <div className="space-y-2">
                    {grouped[b].map((r) => <UpcomingRow key={r.key} row={r} onChanged={() => refetch()} />)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function statusBadgeTone(s?: string | null) {
  switch ((s || "").toLowerCase()) {
    case "completed": return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    case "cancelled": return "bg-muted text-muted-foreground border-border";
    case "noshow":
    case "no_show":
    case "no-show": return "bg-rose-500/10 text-rose-300 border-rose-500/30";
    case "missed": return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    default: return "bg-primary/10 text-primary border-primary/30";
  }
}

function fmtTime(iso: string, tz?: string | null) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz || undefined });
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function UpcomingRow({ row, onChanged }: { row: UnifiedRow; onChanged: () => void }) {
  const markFn = useServerFn(markAppointmentStatus);
  const [reOpen, setReOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isAppt = row.source === "appointment";
  const isGoogleOnly = row.source === "google";

  async function markStatus(s: "Completed" | "NoShow" | "Cancelled") {
    if (!isAppt || busy) return;
    setBusy(true);
    try {
      await runJob(
        {
          title: s === "Completed" ? "Mark completed" : s === "NoShow" ? "Mark no-show" : "Update status",
          description: row.title,
        },
        async (h) => {
          h.setSteps([
            { label: "Validate appointment", done: false },
            { label: "Update status", done: false },
            { label: "Record CRM activity", done: false },
            { label: "Finalize", done: false },
          ]);
          h.completeStep(0);
          await markFn({ data: { id: row.source_id, status: s } });
          h.completeStep(1);
          h.completeStep(2);
          onChanged();
          h.completeStep(3);
        },
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  function copyMeet() {
    if (!row.meet_link) return;
    navigator.clipboard.writeText(row.meet_link).then(
      () => toast.success("Meet link copied"),
      () => toast.error("Copy failed"),
    );
  }

  const apptForDialog = isAppt
    ? {
        id: row.source_id,
        title: row.title,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        timezone: row.timezone,
        host_coach_id: row.host_coach_id,
        google_event_id: row.google_event_id,
      }
    : null;

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {row.status && <Badge variant="outline" className={statusBadgeTone(row.status)}>{row.status}</Badge>}
            {row.appointment_type && <Badge variant="outline" className="text-[10px]">{row.appointment_type}</Badge>}
            {isGoogleOnly && <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[10px]">Google only</Badge>}
            {row.source === "pt_session" && <Badge variant="outline" className="text-[10px]">PT Session</Badge>}
            {row.sync_state === "synced" && <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 text-[10px]">Synced</Badge>}
            {row.client_lead_temperature && (
              <Badge variant="outline" className="text-[10px] uppercase">{row.client_lead_temperature}</Badge>
            )}
            {!row.client_id && !isGoogleOnly && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Unlinked</Badge>
            )}
          </div>
          <div className="font-semibold truncate">{row.title}</div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{fmtDate(row.starts_at)} · {fmtTime(row.starts_at, row.timezone)}{row.ends_at ? `–${fmtTime(row.ends_at, row.timezone)}` : ""}</span>
            {row.timezone && <span>· {row.timezone}</span>}
            {row.attendee_name && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{row.attendee_name}</span>}
            {row.attendee_email && <span className="truncate">{row.attendee_email}</span>}
            {row.attendee_phone && <span>{row.attendee_phone}</span>}
            {row.host_coach_name && <span>· {row.host_coach_name}</span>}
            {row.location && <span>· {row.location}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.client_id && (
            <Link to="/admin/crm/contacts/$id" params={{ id: row.client_id }}>
              <Button size="sm" variant="outline" className="h-7 text-xs"><LinkIcon className="mr-1 h-3 w-3" /> CRM</Button>
            </Link>
          )}
          {row.client_id && row.client_is_active && (
            <Link to="/admin/clients/$id" params={{ id: row.client_id }}>
              <Button size="sm" variant="outline" className="h-7 text-xs">Client</Button>
            </Link>
          )}
          {row.meet_link && (
            <a href={row.meet_link} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="h-7 text-xs"><Video className="mr-1 h-3 w-3" /> Join</Button>
            </a>
          )}
          {row.meet_link && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copyMeet}><Copy className="mr-1 h-3 w-3" /> Copy</Button>
          )}
          {row.google_html_link && (
            <a href={row.google_html_link} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" className="h-7 text-xs"><ExternalLink className="mr-1 h-3 w-3" /> Google</Button>
            </a>
          )}
          {isAppt && row.status === "Scheduled" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReOpen(true)} disabled={busy}>
                <CalendarClock className="mr-1 h-3 w-3" /> Reschedule
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markStatus("Completed")} disabled={busy}>
                <CheckCircle2 className="mr-1 h-3 w-3" /> Complete
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markStatus("NoShow")} disabled={busy}>
                <AlertTriangle className="mr-1 h-3 w-3" /> No-show
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCancelOpen(true)} disabled={busy}>
                <X className="mr-1 h-3 w-3" /> Cancel
              </Button>
            </>
          )}
        </div>
      </div>
      {isAppt && apptForDialog && (
        <>
          <RescheduleDialog open={reOpen} onOpenChange={setReOpen} appointment={apptForDialog as any} onChanged={onChanged} />
          <CancelAppointmentDialog open={cancelOpen} onOpenChange={setCancelOpen} appointment={apptForDialog as any} onCancelled={onChanged} />
        </>
      )}
    </Card>
  );
}