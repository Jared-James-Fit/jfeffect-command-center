import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { getMyClientAccount } from "@/lib/schedule.functions";
import { UpcomingScheduleCard } from "@/components/home/upcoming-schedule-card";
import { CalendarSyncCard } from "@/components/schedule/calendar-sync-card";

/**
 * The person's own week on a staff home: their client account's sessions,
 * appointments and workouts (the same card clients get), and the one-tap
 * subscription that keeps them in Google Calendar. Their staff login has to
 * be linked to that client account first; the owner links it from Team.
 */
export function MyCalendarCard() {
  const { preview } = useAuth();
  const fn = useServerFn(getMyClientAccount);
  const { data: mine, isLoading } = useQuery({
    queryKey: ["my-client-account", preview?.userId ?? null],
    queryFn: () => fn({ data: { userId: preview?.userId ?? null } }),
    staleTime: 10 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-36 w-full rounded-xl" />;
  if (!mine) {
    return (
      <Card className="flex items-start gap-3 p-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CalendarDays className="h-4 w-4" /></span>
        <span className="min-w-0 text-sm">
          <span className="block font-semibold">Your calendar goes here</span>
          <span className="block text-xs leading-snug text-muted-foreground">
            Once this login is linked to your client account, your sessions and workouts show here and sync to Google Calendar.
            The owner links it from Clients, Team.
          </span>
        </span>
      </Card>
    );
  }
  return (
    <div data-my-calendar className="space-y-2">
      <UpcomingScheduleCard clientId={mine.id} links={false} />
      {/* Their own Google subscription; the owner previewing can't set it up for them. */}
      {!preview && <CalendarSyncCard />}
    </div>
  );
}
