import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, Calendar as CalIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { useAdminCalendarSources, useGoogleCalendarStatus, KIND_META, type CalendarKind, type CalendarItem } from "@/lib/calendar-sources";
import { AdminNeedsAttentionPanel } from "@/components/calendar/needs-attention-panel";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SessionActionsSheet, type ActionSession } from "@/components/schedule/session-actions-sheet";
import { ChangeRequestsCard } from "@/components/schedule/change-requests-card";
import { cn } from "@/lib/utils";

const ALL_KINDS: CalendarKind[] = ["event", "important_date", "appointment", "pt_session"];
const GOOGLE_TOGGLE_KEY = "admin.calendar.includeGoogle";

function readGooglePref(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(GOOGLE_TOGGLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AdminCalendarBoardPanel() {
  const [clientId, setClientId] = useState<string>("all");
  const [kinds, setKinds] = useState<Set<CalendarKind>>(() => new Set(ALL_KINDS));
  // Default: coaching app only. Google is one tap away and the choice sticks.
  const [includeGoogle, setIncludeGoogle] = useState<boolean>(readGooglePref);
  const [booking, setBooking] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [acting, setActing] = useState<{ session: ActionSession; clientName: string | null } | null>(null);

  const { data: gcalStatus } = useGoogleCalendarStatus();
  const googleConnected = !!gcalStatus?.connected;

  function chooseSource(google: boolean) {
    setIncludeGoogle(google);
    try {
      window.localStorage.setItem(GOOGLE_TOGGLE_KEY, google ? "1" : "0");
    } catch {
      /* private mode: the choice just won't persist */
    }
  }

  const filters = useMemo(() => {
    const k = new Set(kinds);
    if (includeGoogle && googleConnected) k.add("google_event");
    return { clientId, kinds: k, includeGoogle: includeGoogle && googleConnected };
  }, [clientId, kinds, includeGoogle, googleConnected]);
  const { items, clients, isLoading } = useAdminCalendarSources(filters);

  const { data: bookingClients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used")
        .eq("archived", false)
        .order("full_name");
      return data ?? [];
    },
  });

  function toggleKind(k: CalendarKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }
  function clearFilters() {
    setClientId("all");
    setKinds(new Set(ALL_KINDS));
  }
  const activeFilterCount =
    (clientId !== "all" ? 1 : 0) + (kinds.size !== ALL_KINDS.length ? 1 : 0);

  // The full editor needs the whole row (notes, visibility, template), not the calendar's slice.
  async function openEditor(s: ActionSession) {
    const { data } = await supabase.from("pt_sessions").select("*").eq("id", s.id).maybeSingle();
    setEditing(data ?? s);
  }

  // Tapping a PT session goes straight to its actions (move, done, no-show, cancel).
  function onItemSelect(item: CalendarItem): boolean {
    if (item.kind !== "pt_session" || !item.raw) return false;
    setActing({ session: item.raw as ActionSession, clientName: item.clientName ?? null });
    return true;
  }

  const sourceSwitch = (
    <div className="inline-flex h-9 shrink-0 rounded-full border border-border bg-background/60 p-0.5 text-xs font-bold" role="radiogroup" aria-label="What to show">
      <button
        type="button"
        role="radio"
        aria-checked={!includeGoogle}
        onClick={() => chooseSource(false)}
        className={cn("rounded-full px-3", !includeGoogle ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
      >
        Coaching
      </button>
      {googleConnected ? (
        <button
          type="button"
          role="radio"
          aria-checked={includeGoogle}
          onClick={() => chooseSource(true)}
          title={gcalStatus?.calendarName ? `Adds ${gcalStatus.calendarName} and your main Google calendar` : undefined}
          className={cn("inline-flex items-center gap-1 rounded-full px-3", includeGoogle ? "bg-sky-500 text-white" : "text-muted-foreground")}
        >
          <CalIcon className="h-3 w-3" /> + Google
        </button>
      ) : (
        <Link
          to="/admin/calendar"
          search={{ tab: "setup" } as any}
          className="inline-flex items-center gap-1 rounded-full px-3 text-muted-foreground hover:text-foreground"
        >
          <CalIcon className="h-3 w-3" /> Connect Google
        </Link>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {sourceSwitch}
      <Select value={clientId} onValueChange={setClientId}>
        <SelectTrigger className="h-9 w-full sm:w-[200px] text-xs">
          <SelectValue placeholder="All clients" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All clients</SelectItem>
          {clients.map((c: any) => (
            <SelectItem key={c.id} value={c.id}>{c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-1.5">
        {ALL_KINDS.map((k) => {
          const active = kinds.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
                active ? KIND_META[k].chip : "border-border text-muted-foreground opacity-50 hover:opacity-100",
              )}
            >
              {KIND_META[k].label}
            </button>
          );
        })}
      </div>
      {activeFilterCount > 0 && (
        <Button size="sm" variant="ghost" className="h-8 text-xs sm:ml-auto" onClick={clearFilters}>
          <Filter className="mr-1 h-3 w-3" /> Clear ({activeFilterCount})
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Calendar" subtitle="Tap a day to book. Tap a session to move or close it out. Synced with Google Calendar." />
      <div className="p-3 sm:p-6 md:p-8 space-y-4">
        <ChangeRequestsCard onEdit={openEditor} />
        <AdminNeedsAttentionPanel items={items} />
        <Card className="border-border bg-card p-3 sm:p-4">
          <CalendarBoard
            items={items}
            isLoading={isLoading}
            showClientName
            toolbar={toolbar}
            onCreate={(date) => setBooking({ date })}
            onItemSelect={onItemSelect}
            emptyHint={
              activeFilterCount > 0
                ? "No calendar items match your current filters. Try clearing filters or widening the date range."
                : "Nothing scheduled yet. Tap Book to add a session."
            }
          />
        </Card>
      </div>

      <PtSessionDialog
        open={!!booking || !!editing}
        onOpenChange={(o) => { if (!o) { setBooking(null); setEditing(null); } }}
        clients={bookingClients as any}
        initial={editing ?? undefined}
        clientId={editing?.client_id}
        initialDate={booking?.date ?? null}
      />
      <SessionActionsSheet
        session={acting?.session ?? null}
        clientName={acting?.clientName}
        open={!!acting}
        onOpenChange={(o) => { if (!o) setActing(null); }}
        onEdit={openEditor}
      />
    </>
  );
}
