import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpcomingPanel } from "@/components/admin-calendar/upcoming-panel";
import { BookingLinksPage } from "@/route-pages/_authenticated/admin/booking-links";
import { GoogleCalendarPage } from "@/route-pages/_authenticated/admin/google-calendar";
import { PtCalendarPanel } from "@/components/admin-calendar/pt-calendar-panel";
import { AdminEventsPage } from "@/route-pages/_authenticated/admin/events.index";
import { AdminCalendarBoardPanel } from "@/components/admin-calendar/board-panel";
import { GoogleSyncStatusCard } from "@/components/admin-calendar/google-sync-status";

// Five tabs, one job each. Older links (?tab=pt-calendar, google-calendar,
// booking-links, availability) still land on the right one.
const TAB_VALUES = ["board", "sessions", "upcoming", "events", "setup"] as const;
type TabValue = typeof TAB_VALUES[number];
const LEGACY_TABS: Record<string, TabValue> = {
  "pt-calendar": "sessions",
  "google-calendar": "setup",
  "booking-links": "setup",
  availability: "board",
};
const LS_KEY = "admin.calendar.lastTab";

function normalizeTab(v: unknown): TabValue | undefined {
  if (typeof v !== "string") return undefined;
  if ((TAB_VALUES as readonly string[]).includes(v)) return v as TabValue;
  return LEGACY_TABS[v];
}

const searchSchema = z.object({
  tab: z.any().transform(normalizeTab).optional(),
  connected: z.string().optional(),
  error: z.string().optional(),
  q: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  link: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/calendar")({
  validateSearch: searchSchema.parse,
  component: AdminCalendarShell,
});

function AdminCalendarShell() {
  const search = useSearch({ from: "/_authenticated/admin/calendar" });
  const navigate = useNavigate({ from: "/admin/calendar" });

  // Resolve active tab: URL > localStorage > default
  let active: TabValue = "board";
  if (search.tab) {
    active = search.tab;
  } else if (typeof window !== "undefined") {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    active = normalizeTab(stored) ?? "board";
  }

  // Sync URL when missing/invalid tab so refresh + back/forward work cleanly
  useEffect(() => {
    if (search.tab !== active) {
      navigate({ search: (prev: any) => ({ ...prev, tab: active }), replace: true });
    }
  }, [active, search.tab, navigate]);

  // Persist last tab
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEY, active); } catch { /* storage blocked */ }
  }, [active]);

  function setTab(t: string) {
    if (!(TAB_VALUES as readonly string[]).includes(t)) return;
    navigate({ search: (prev: any) => ({ ...prev, tab: t as TabValue }) });
  }

  return (
    <>
      <div className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20">
        <div className="px-3 sm:px-6 md:px-8 py-2 sm:py-3 overflow-x-auto">
          <Tabs value={active} onValueChange={setTab}>
            <TabsList className="flex w-max gap-1 h-auto flex-nowrap">
              <TabsTrigger value="board">Calendar</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="setup">Setup</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {active === "board" && <AdminCalendarBoardPanel />}
      {active === "sessions" && <PtCalendarPanel />}
      {active === "upcoming" && <UpcomingPanel />}
      {active === "events" && <div className="p-3 sm:p-4 md:p-6"><AdminEventsPage embedded /></div>}
      {active === "setup" && (
        <>
          <GoogleCalendarPage />
          <div className="px-6 md:px-8 max-w-3xl"><GoogleSyncStatusCard /></div>
          <BookingLinksPage />
        </>
      )}
    </>
  );
}