import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Pencil, CheckCircle2, Ban, CircleOff, MoreHorizontal, Undo2, Wallet, Trash2,
  AlertTriangle, SlidersHorizontal, CalendarClock, StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import {
  AdjustPtCreditDialog, CancelPtSessionDialog, DeletePtSessionDialog, NoShowPtDialog,
} from "@/components/pt-session-manage-dialogs";
import { setPtSessionStatus } from "@/lib/pt-pack.functions";
import { getPtSessionCreditEvents } from "@/lib/pt-session-manage.functions";
import { sessionStatusLabel, statusForDate } from "@/lib/session-credit";
import { useCoachNotes } from "@/lib/session-coach-notes";
import {
  creditImpact, creditToneClasses, duplicateKey, invalidatePtSessionCaches, isNeedsReview,
  todayISOLocal, type PtLedgerEvent,
} from "@/lib/pt-session-manage";
import { SESSION_TYPES, statusTone, fmtTimeRange } from "@/lib/pt-sessions";
import { useAuth } from "@/lib/auth";
import { SessionActionsSheet } from "@/components/schedule/session-actions-sheet";
import { listenChannel } from "@/lib/realtime-channel";

type TabKey = "upcoming" | "review" | "completed" | "cancelled" | "noshow" | "all";

function fmtSessionDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

export function PtCalendarPanel() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<TabKey>("upcoming");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ client: "all", type: "all", location: "", from: "", to: "" });
  const [noShowFor, setNoShowFor] = useState<any>(null);
  const [deleteFor, setDeleteFor] = useState<any>(null);
  const [cancelFor, setCancelFor] = useState<any>(null);
  const [adjustFor, setAdjustFor] = useState<any>(null);
  const [actFor, setActFor] = useState<any>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used").eq("archived", false).order("full_name");
      return data ?? [];
    },
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["pt-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("*, clients(id, full_name)")
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Keep the list live across tabs/devices (targeted invalidation, no polling).
  useEffect(() => {
    const ch = listenChannel("pt-calendar-sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_sessions" }, () => {
        qc.invalidateQueries({ queryKey: ["pt-sessions"] });
        qc.invalidateQueries({ queryKey: ["pt-session-events"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // The coach's own notes (why a session was cancelled, moved or missed).
  const { data: coachNotes } = useCoachNotes(null);

  // Credit events for visible sessions → credit impact chips + history.
  const sessionIds = useMemo(() => sessions.map((s: any) => s.id).slice(0, 300), [sessions]);
  const { data: creditEvents = [] } = useQuery<PtLedgerEvent[]>({
    queryKey: ["pt-session-events", sessionIds],
    enabled: sessionIds.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const res = await getPtSessionCreditEvents({ data: { sessionIds } });
      return (res.events ?? []) as PtLedgerEvent[];
    },
  });
  const eventsBySession = useMemo(() => {
    const map: Record<string, PtLedgerEvent[]> = {};
    for (const e of creditEvents) {
      if (!e.pt_session_id) continue;
      (map[e.pt_session_id] ??= []).push(e);
    }
    return map;
  }, [creditEvents]);

  const today = todayISOLocal();

  const filteredBase = useMemo(() => sessions.filter((s) => {
    if (filters.client !== "all" && s.client_id !== filters.client) return false;
    if (filters.type !== "all" && s.session_type !== filters.type) return false;
    if (filters.location && !s.location?.toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.from && s.session_date < filters.from) return false;
    if (filters.to && s.session_date > filters.to) return false;
    return true;
  }), [sessions, filters]);

  const groups = useMemo(() => {
    const byDateTime = (a: any, b: any) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time);
    const byDateTimeDesc = (a: any, b: any) => (b.session_date + b.start_time).localeCompare(a.session_date + a.start_time);
    const upcoming = filteredBase.filter((s) => s.status === "Scheduled" && s.session_date >= today).sort(byDateTime);
    const review = filteredBase.filter((s) => isNeedsReview(s, today)).sort(byDateTime);
    const completed = filteredBase.filter((s) => s.status === "Completed").sort(byDateTimeDesc);
    const cancelled = filteredBase.filter((s) => s.status === "Cancelled").sort(byDateTimeDesc);
    const noshow = filteredBase.filter((s) => s.status === "Missed").sort(byDateTimeDesc);
    const all = [...filteredBase].sort(byDateTimeDesc);
    return { upcoming, review, completed, cancelled, noshow, all };
  }, [filteredBase, today]);

  const visible = groups[tab];

  // Duplicate detection: same client + date + start time + location (non-cancelled).
  const dupKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      if (s.status === "Cancelled") continue;
      const k = duplicateKey(s);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [sessions]);

  const activeFilterCount =
    (filters.client !== "all" ? 1 : 0) + (filters.type !== "all" ? 1 : 0) +
    (filters.location ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0);

  const changeStatus = async (s: any, status: string, okMsg: string) => {
    try {
      await setPtSessionStatus({ data: { sessionId: s.id, status: status as any } });
      toast.success(okMsg);
      invalidatePtSessionCaches(qc, s.client_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    }
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setOpen(true);
  };

  const sessionRow = (s: any) => {
    const events = eventsBySession[s.id] ?? [];
    const impact = creditImpact(s.status, events);
    const isDup = dupKeys.has(duplicateKey(s));
    const scheduled = s.status === "Scheduled";
    return (
      <li key={s.id} className="py-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={`${statusTone(s.status)} shrink-0`}>
            {sessionStatusLabel(s.status)}
          </Badge>
          {isNeedsReview(s, today) && (
            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">Waiting on you</Badge>
          )}
          {isDup && (
            <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
              <AlertTriangle className="mr-1 h-3 w-3" /> Possible duplicate
            </Badge>
          )}
          <span className="text-sm font-semibold break-words">{s.title}</span>
          <Badge variant="outline" className={`${creditToneClasses(impact.tone)} shrink-0`}>
            {impact.label}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground break-words">
          {s.clients && (
            <ClientNameLink clientId={s.clients.id} className="font-semibold text-primary hover:underline">
              {s.clients.full_name}
            </ClientNameLink>
          )}
          {" · "}{fmtSessionDate(s.session_date)} · {fmtTimeRange(s.start_time, s.end_time)}
          {s.location ? ` · ${s.location}` : ""}
          {s.session_type ? ` · ${s.session_type === "Custom Session" ? s.custom_type || s.session_type : s.session_type}` : ""}
        </div>
        {coachNotes?.get(s.id) && (
          <div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-200">
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{coachNotes.get(s.id)}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setActFor(s)}>
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> {scheduled ? "Reschedule · cancel" : "Change"}
          </Button>
          {scheduled && s.session_date < today && (
            <Button
              size="sm" variant="outline"
              className="border-success/40 text-success hover:bg-success/10"
              onClick={() => changeStatus(s, "Completed", "Done · 1 credit used")}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> It happened
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <MoreHorizontal className="mr-1.5 h-4 w-4" /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => openEdit(s)}>
                <CalendarClock className="mr-2 h-4 w-4" /> Edit / Reschedule / History
              </DropdownMenuItem>
              {scheduled && (
                <>
                  <DropdownMenuItem onClick={() => setCancelFor(s)}>
                    <CircleOff className="mr-2 h-4 w-4" /> Cancel · bank the credit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setNoShowFor(s)}>
                    <Ban className="mr-2 h-4 w-4" /> Late cancel / no-show
                  </DropdownMenuItem>
                </>
              )}
              {(s.status === "Completed" || s.status === "Missed") && (
                <DropdownMenuItem onClick={() => changeStatus(s, "Cancelled", "Credit banked · it goes back to the client")}>
                  <Undo2 className="mr-2 h-4 w-4" /> {s.status === "Completed" ? "Didn't happen · bank the credit" : "Don't count it · bank the credit"}
                </DropdownMenuItem>
              )}
              {s.status === "Cancelled" && (
                <DropdownMenuItem
                  onClick={() => {
                    const next = statusForDate(s.session_date, today);
                    void changeStatus(s, next, next === "Completed" ? "Back on · it counts as done (1 credit used)" : "Booked again · holds 1 credit");
                  }}
                >
                  <Undo2 className="mr-2 h-4 w-4" /> Book it again
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem onClick={() => setAdjustFor(s)}>
                  <Wallet className="mr-2 h-4 w-4" /> Adjust Sessions
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteFor(s)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete Session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Sessions" subtitle="Every 1:1 session in one list: book, move, close out." actions={
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Quick Book
        </Button>
      } />
      <div className="p-3 sm:p-6 md:p-8 space-y-4">
        <>
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabsList className="flex w-full flex-wrap h-auto gap-1 sm:w-max">
                <TabsTrigger value="upcoming">Upcoming ({groups.upcoming.length})</TabsTrigger>
                <TabsTrigger value="review" className={groups.review.length > 0 ? "text-warning" : ""}>
                  Waiting on you ({groups.review.length})
                </TabsTrigger>
                <TabsTrigger value="completed">Done ({groups.completed.length})</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled ({groups.cancelled.length})</TabsTrigger>
                <TabsTrigger value="noshow">Missed ({groups.noshow.length})</TabsTrigger>
                <TabsTrigger value="all">All ({groups.all.length})</TabsTrigger>
              </TabsList>
            </Tabs>

            <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline">
                  <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                  Filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Card className="mt-2 border-border bg-card p-3 sm:p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
                  <Select value={filters.client} onValueChange={(v) => setFilters({ ...filters, client: v })}>
                    <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All clients</SelectItem>
                      {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filters.type} onValueChange={(v) => setFilters({ ...filters, type: v })}>
                    <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {SESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Location contains…" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
                  <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                  <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
                </Card>
              </CollapsibleContent>
            </Collapsible>

            <Card className="border-border bg-card p-3 sm:p-4">
              {visible.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  {tab === "upcoming" && "No upcoming sessions."}
                  {tab === "review" && "Nothing waiting for review."}
                  {tab === "completed" && "No completed sessions."}
                  {tab === "cancelled" && "No cancelled sessions."}
                  {tab === "noshow" && "No no-shows recorded."}
                  {tab === "all" && "No sessions match those filters."}
                </div>
              ) : (
                <ul className="divide-y divide-border">{visible.map(sessionRow)}</ul>
              )}
            </Card>
        </>
      </div>

      <PtSessionDialog open={open} onOpenChange={setOpen} clients={clients} initial={editing ?? undefined} />
      <SessionActionsSheet
        session={actFor}
        clientName={actFor?.clients?.full_name}
        open={!!actFor}
        onOpenChange={(o) => { if (!o) setActFor(null); }}
        onEdit={(x) => openEdit(sessions.find((r: any) => r.id === x.id) ?? x)}
      />
      <NoShowPtDialog open={!!noShowFor} onOpenChange={(o) => { if (!o) setNoShowFor(null); }} session={noShowFor} />
      <CancelPtSessionDialog
        open={!!cancelFor}
        onOpenChange={(o) => { if (!o) setCancelFor(null); }}
        session={cancelFor}
        hasReservation={cancelFor ? creditImpact(cancelFor.status, eventsBySession[cancelFor.id] ?? []).tone === "primary" : false}
      />
      <DeletePtSessionDialog
        open={!!deleteFor}
        onOpenChange={(o) => { if (!o) setDeleteFor(null); }}
        session={deleteFor}
        impactLabel={deleteFor ? creditImpact(deleteFor.status, eventsBySession[deleteFor.id] ?? []).label : undefined}
      />
      {isAdmin && adjustFor && (
        <AdjustPtCreditDialog
          open={!!adjustFor}
          onOpenChange={(o) => { if (!o) setAdjustFor(null); }}
          clientId={adjustFor.client_id}
          session={adjustFor}
        />
      )}
    </>
  );
}