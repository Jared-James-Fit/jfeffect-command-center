import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, Calendar as CalIcon } from "lucide-react";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import { useAdminCalendarSources, useGoogleCalendarStatus, KIND_META, type CalendarKind } from "@/lib/calendar-sources";
import { AdminNeedsAttentionPanel } from "@/components/calendar/needs-attention-panel";
import { cn } from "@/lib/utils";

const ALL_KINDS: CalendarKind[] = ["event", "important_date", "appointment", "pt_session"];
const GOOGLE_TOGGLE_KEY = "admin.calendar.includeGoogle";

export function AdminCalendarBoardPanel() {
  const [clientId, setClientId] = useState<string>("all");
  const [kinds, setKinds] = useState<Set<CalendarKind>>(() => new Set(ALL_KINDS));
  const [includeGoogle, setIncludeGoogle] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(GOOGLE_TOGGLE_KEY) === "1";
  });

  const { data: gcalStatus } = useGoogleCalendarStatus();
  const googleConnected = !!gcalStatus?.connected;

  function toggleGoogle() {
    setIncludeGoogle((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(GOOGLE_TOGGLE_KEY, next ? "1" : "0");
      }
      return next;
    });
  }

  const filters = useMemo(
    () => ({ clientId, kinds, includeGoogle: includeGoogle && googleConnected }),
    [clientId, kinds, includeGoogle, googleConnected],
  );
  const { items, clients, isLoading } = useAdminCalendarSources(filters);

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

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select value={clientId} onValueChange={setClientId}>
        <SelectTrigger className="h-8 w-full sm:w-[220px] text-xs">
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
        {googleConnected ? (
          <button
            type="button"
            onClick={toggleGoogle}
            title={`Toggle Google Calendar overlay${gcalStatus?.calendarName ? ` (${gcalStatus.calendarName})` : ""}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
              includeGoogle ? KIND_META.google_event.chip : "border-border text-muted-foreground opacity-50 hover:opacity-100",
            )}
          >
            <CalIcon className="h-3 w-3" /> Google
          </button>
        ) : (
          <Link
            to="/admin/calendar"
            search={{ tab: "google-calendar" } as any}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
            title="Connect Google Calendar to overlay your events"
          >
            <CalIcon className="h-3 w-3" /> Connect Google
          </Link>
        )}
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
      <PageHeader title="Calendar Board" subtitle="Month, week, day, and upcoming views across all client activity." />
      <div className="p-3 sm:p-6 md:p-8 space-y-4">
        <AdminNeedsAttentionPanel items={items} />
        <Card className="border-border bg-card p-3 sm:p-4">
          <CalendarBoard
            items={items}
            isLoading={isLoading}
            showClientName
            toolbar={toolbar}
            emptyHint={
              activeFilterCount > 0
                ? "No calendar items match your current filters. Try clearing filters or widening the date range."
                : "Nothing scheduled yet. Create an event in the Events tab or add appointments/PT sessions to populate the board."
            }
          />
        </Card>
      </div>
    </>
  );
}