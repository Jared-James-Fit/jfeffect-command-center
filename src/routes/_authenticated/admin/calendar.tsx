import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpcomingPanel } from "@/components/admin-calendar/upcoming-panel";
import { PtCalendarPanel } from "@/components/admin-calendar/pt-calendar-panel";
import { AdminCalendarBoardPanel } from "@/components/admin-calendar/board-panel";
import { AdminBookingPanel } from "@/components/admin-calendar/booking-panel";

// Four tabs, one job each. Older links (?tab=setup, pt-calendar,
// google-calendar, booking-links, availability) still land on the right one;
// Events was never used (three blank test events) and ?tab=events opens the board.
const TAB_VALUES = ["board", "booking", "sessions", "upcoming"] as const;
type TabValue = typeof TAB_VALUES[number];
const LEGACY_TABS: Record<string, TabValue> = {
  "pt-calendar": "sessions",
  setup: "booking",
  "google-calendar": "booking",
  "booking-links": "booking",
  "booking-cards": "booking",
  availability: "booking",
};

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
  // yyyy-mm-dd: open the board on that day (a day tapped on the dashboard's week).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/admin/calendar")({
  validateSearch: searchSchema.parse,
  component: AdminCalendarShell,
});

function AdminCalendarShell() {
  const search = useSearch({ from: "/_authenticated/admin/calendar" });
  const navigate = useNavigate({ from: "/admin/calendar" });

  // The tab the link asks for, else the calendar board: never whichever tab was used last.
  const active: TabValue = search.tab ?? "board";

  // Sync URL when missing/invalid tab so refresh + back/forward work cleanly
  useEffect(() => {
    if (search.tab !== active) {
      navigate({ search: (prev: any) => ({ ...prev, tab: active }), replace: true });
    }
  }, [active, search.tab, navigate]);

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
              <TabsTrigger value="booking">Booking</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {active === "board" && <AdminCalendarBoardPanel key={search.date ?? "today"} initialDate={search.date ?? null} />}
      {active === "booking" && <AdminBookingPanel />}
      {active === "sessions" && <PtCalendarPanel />}
      {active === "upcoming" && <UpcomingPanel />}
    </>
  );
}