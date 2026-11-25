/**
 * The next meeting with a client, in one line, where the coach already is
 * (coach only; Nov 25 2026): the top of the client's profile and the top of
 * their chat. Title, when, confirmation state, then Prepare (the command
 * centre), Join (from 15 minutes before) and Manage (move or cancel, the
 * session sheet). With nothing booked it shows only follow-ups still open
 * from the last meeting, and nothing at all when there's neither.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, MessagesSquare, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { nextMeetingFn } from "@/lib/coaching-sessions/sessions.functions";
import {
  canJoin,
  soonWords,
  STATE_WORDS,
  type AppointmentState,
} from "@/lib/coaching-sessions/lifecycle";
import {
  SessionActionsSheet,
  type ActionSession,
} from "@/components/schedule/session-actions-sheet";

export const nextMeetingKey = (clientId: string) => ["next-meeting", clientId] as const;

const clockOf = (d: Date) => d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
const dayOf = (d: Date) => {
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  const tm = new Date(t);
  tm.setDate(t.getDate() + 1);
  if (d.toDateString() === tm.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
};

const STATE_TONE: Partial<Record<AppointmentState, string>> = {
  confirmed: "text-success",
  reschedule_requested: "text-warning",
  awaiting_confirmation: "text-muted-foreground",
};

export function MeetingStrip({
  clientId,
  variant = "profile",
  className,
}: {
  clientId: string;
  variant?: "profile" | "chat";
  className?: string;
}) {
  const read = useServerFn(nextMeetingFn);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: nextMeetingKey(clientId),
    queryFn: () => read({ data: { clientId } }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const [manage, setManage] = useState(false);
  const pt = useQuery({
    queryKey: ["meeting-pt-session", q.data?.call?.id],
    enabled: manage && !!q.data?.call?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select(
          "id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id",
        )
        .eq("id", q.data!.call!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as ActionSession | null) ?? null;
    },
  });
  const d = q.data;
  if (!d || (!d.call && !d.meeting && !d.openAfter)) return null;
  const call = d.call;
  const now = new Date();
  const joinable = call ? canJoin(call.startsAt, call.endsAt, now, call.meetLink) : false;
  const prepareTo = d.meeting
    ? { to: "/admin/meetings/$sessionId" as const, params: { sessionId: d.meeting.id } }
    : call
      ? { to: "/admin/meetings/by-booking/$ptSessionId" as const, params: { ptSessionId: call.id } }
      : null;
  const compact = variant === "chat";

  if (!call && !d.meeting)
    return (
      <Link
        to="/admin/clients/$id"
        params={{ id: clientId }}
        search={{ tab: "meetings" } as any}
        className={cn(
          "flex items-center gap-2 px-3 text-[13px]",
          compact
            ? "shrink-0 border-b border-border bg-card/60 py-1.5 sm:px-4"
            : "rounded-xl border border-border py-2",
          className,
        )}
        data-meeting-strip="after"
      >
        <MessagesSquare className="h-4 w-4 text-muted-foreground" />
        <span>
          {d.openAfter} follow-up{d.openAfter === 1 ? "" : "s"} from your last meeting
        </span>
      </Link>
    );

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3",
        compact
          ? "shrink-0 border-b border-border bg-card/60 py-1.5 sm:px-4"
          : "rounded-xl border border-border py-2",
        className,
      )}
      data-meeting-strip={variant}
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium", compact ? "text-[13px]" : "text-[14px]")}>
          {d.meeting?.title || call?.title || "Meeting"}
          {call?.startsAt ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {soonWords(call.startsAt, now, { clock: clockOf, day: dayOf }, call.endsAt)}
            </span>
          ) : d.meeting?.status === "live" ? (
            <span className="font-normal text-success"> · Live</span>
          ) : null}
        </p>
        {call || d.meeting?.changes ? (
          <p className="truncate text-[12px] text-muted-foreground">
            {call ? (
              <span className={STATE_TONE[call.state as AppointmentState]}>
                {STATE_WORDS[call.state as AppointmentState]}
              </span>
            ) : null}
            {d.meeting?.changes ? (
              <span className="text-warning">
                {call ? " · " : ""}
                {d.meeting.changes} new in the plan
              </span>
            ) : null}
            {d.openAfter ? ` · ${d.openAfter} open from last time` : ""}
          </p>
        ) : null}
      </div>
      {joinable && call?.meetLink ? (
        <Button asChild size="sm" className="h-8 shrink-0" data-meeting-join>
          <a href={call.meetLink} target="_blank" rel="noreferrer">
            <Video className="mr-1 h-3.5 w-3.5" /> Join
          </a>
        </Button>
      ) : null}
      {prepareTo ? (
        <Button
          asChild
          size="sm"
          variant={joinable ? "outline" : "default"}
          className="h-8 shrink-0"
          data-meeting-prepare
        >
          <Link {...prepareTo}>{d.meeting?.status === "live" ? "Open" : "Prepare"}</Link>
        </Button>
      ) : null}
      {call && !compact ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 px-2"
          onClick={() => setManage(true)}
          data-meeting-manage
        >
          Manage
        </Button>
      ) : null}
      {call ? (
        <SessionActionsSheet
          session={manage ? (pt.data ?? null) : null}
          open={manage && !!pt.data}
          onOpenChange={(o) => {
            setManage(o);
            if (!o) qc.invalidateQueries({ queryKey: nextMeetingKey(clientId) });
          }}
        />
      ) : null}
    </div>
  );
}
