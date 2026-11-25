/**
 * Home's meetings card (coach; Nov 25 2026): the next 7 days of meetings,
 * each with its confirmation state and what changed in its plan since the
 * coach last looked (one tap to its command centre, Join once it's time), and
 * finished meetings that still need the coach (recommendations to decide or
 * apply, memories to review, speakers to name). Hidden when there's neither.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { meetingsBoardFn } from "@/lib/coaching-sessions/sessions.functions";
import {
  canJoin,
  soonWords,
  STATE_WORDS,
  type AppointmentState,
} from "@/lib/coaching-sessions/lifecycle";

const clockOf = (d: Date) => d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
const dayOf = (d: Date) => {
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  const tm = new Date(t);
  tm.setDate(t.getDate() + 1);
  if (d.toDateString() === tm.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
};

export function MeetingsDashboardCard() {
  const read = useServerFn(meetingsBoardFn);
  const q = useQuery({
    queryKey: ["meetings-board"],
    queryFn: () => read(),
    staleTime: 60_000,
    refetchInterval: 180_000,
  });
  const d = q.data;
  if (!d || (!d.upcoming.length && !d.after.length)) return null;
  const now = new Date();
  return (
    <Card className="p-4" data-meetings-card>
      <h2 className="mb-1 flex items-center gap-2 text-[16px] font-semibold">
        <CalendarClock className="h-4 w-4 text-muted-foreground" /> Meetings
      </h2>
      {d.upcoming.length ? (
        <ul className="divide-y divide-border">
          {d.upcoming.slice(0, 5).map((m) => {
            const joinable = m.meetLink && canJoin(m.at, null, now, m.meetLink);
            return (
              <li key={m.id} className="flex items-center gap-3 py-2.5" data-meeting-row={m.id}>
                <Link
                  to="/admin/meetings/$sessionId"
                  params={{ sessionId: m.id }}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-[15px] font-semibold">
                    {m.name}
                    {m.title ? (
                      <span className="font-normal text-muted-foreground"> · {m.title}</span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {m.at
                      ? soonWords(m.at, now, { clock: clockOf, day: dayOf })
                      : m.status === "live"
                        ? "Live"
                        : "Not scheduled"}
                    {m.state ? (
                      <span
                        className={cn(
                          m.state === "confirmed"
                            ? "text-success"
                            : m.state === "reschedule_requested"
                              ? "text-warning"
                              : "",
                        )}
                      >
                        {" · "}
                        {STATE_WORDS[m.state as AppointmentState]}
                      </span>
                    ) : null}
                    {m.changes ? (
                      <span className="text-warning"> · {m.changes} new in the plan</span>
                    ) : !m.reviewed ? (
                      " · plan ready"
                    ) : null}
                  </span>
                </Link>
                {joinable ? (
                  <Button asChild size="sm" className="h-9 shrink-0">
                    <a href={m.meetLink!} target="_blank" rel="noreferrer">
                      <Video className="mr-1 h-3.5 w-3.5" /> Join
                    </a>
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="outline" className="h-9 shrink-0">
                    <Link to="/admin/meetings/$sessionId" params={{ sessionId: m.id }}>
                      Prepare
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {d.after.length ? (
        <>
          <p className="mt-2 text-[12.5px] font-medium text-muted-foreground">After meetings</p>
          <ul className="divide-y divide-border">
            {d.after.slice(0, 4).map((m) => (
              <li key={m.id}>
                <Link
                  to="/admin/meetings/$sessionId"
                  params={{ sessionId: m.id }}
                  className="flex items-center gap-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium">
                      {m.name}
                      {m.title ? (
                        <span className="font-normal text-muted-foreground"> · {m.title}</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {m.reading
                        ? "Cleo is reading it"
                        : [
                            m.decide ? `${m.decide} to decide` : null,
                            m.apply ? `${m.apply} approved, not applied` : null,
                            m.memories ? `${m.memories} to remember?` : null,
                            m.speakers ? "name the speakers" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
