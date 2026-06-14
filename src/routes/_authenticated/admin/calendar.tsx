import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { UpcomingPanel } from "@/components/admin-calendar/upcoming-panel";
import { BookingLinksPage } from "./booking-links";
import { GoogleCalendarPage } from "./google-calendar";
import { PtCalendarPanel } from "@/components/admin-calendar/pt-calendar-panel";
import { AdminEventsPage } from "./events.index";
import { AdminCalendarBoardPanel } from "@/components/admin-calendar/board-panel";

const TAB_VALUES = ["board", "upcoming", "events", "availability", "booking-links", "pt-calendar", "google-calendar"] as const;
type TabValue = typeof TAB_VALUES[number];
const LS_KEY = "admin.calendar.lastTab";

const searchSchema = z.object({
  tab: z.enum(TAB_VALUES).optional().catch(undefined),
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
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored && (TAB_VALUES as readonly string[]).includes(stored)) {
      active = stored as TabValue;
    }
  }

  // Sync URL when missing/invalid tab so refresh + back/forward work cleanly
  useEffect(() => {
    if (search.tab !== active) {
      navigate({ search: (prev: any) => ({ ...prev, tab: active }), replace: true });
    }
  }, [active, search.tab, navigate]);

  // Persist last tab
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, active);
    }
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
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="availability">Availability</TabsTrigger>
              <TabsTrigger value="booking-links" className="whitespace-nowrap">Booking Links</TabsTrigger>
              <TabsTrigger value="pt-calendar" className="whitespace-nowrap">PT Calendar</TabsTrigger>
              <TabsTrigger value="google-calendar" className="whitespace-nowrap">Google Calendar</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {active === "board" && <AdminCalendarBoardPanel />}
      {active === "upcoming" && <UpcomingPanel />}
      {active === "events" && <div className="p-3 sm:p-4 md:p-6"><AdminEventsPage embedded /></div>}
      {active === "availability" && <AvailabilityPlaceholder />}
      {active === "booking-links" && <BookingLinksPage />}
      {active === "pt-calendar" && <PtCalendarPanel />}
      {active === "google-calendar" && <GoogleCalendarPage />}
    </>
  );
}

function AvailabilityPlaceholder() {
  return (
    <>
      <PageHeader title="Availability" subtitle="Manage your weekly hours, blackouts, and buffers." />
      <div className="p-6 md:p-8">
        <Card className="border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Availability management will be added in the next calendar update.
        </Card>
      </div>
    </>
  );
}