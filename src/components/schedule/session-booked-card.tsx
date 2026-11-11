import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck2, ChevronRight, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ClientSessionSheet, type ClientSession } from "@/components/schedule/client-session-sheet";
import { bookedDay, bookedPlace, bookedTimes } from "@/lib/session-booked";
import { sessionStatusLabel } from "@/lib/session-credit";
import { cn } from "@/lib/utils";

const COLLAPSED = 4;

type BookedRow = ClientSession & {
  id: string;
  title: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string | null;
  ends_at?: string | null;
  wants_meet?: boolean | null;
};

/**
 * "You're booked in" (`kind: "session_booked"`, session-booked.server.ts):
 * the sessions the coach booked, read live, so one moved or cancelled since
 * shows as it is now. The client taps one for its details (ClientSessionSheet:
 * where, the video link, Change time); a video session has Join right here.
 */
export function SessionBookedCard({ ids, staff, clientId }: { ids: string[]; staff: boolean; clientId: string }) {
  const [open, setOpen] = useState<BookedRow | null>(null);
  const [all, setAll] = useState(false);
  const { data: rows, isLoading } = useQuery<BookedRow[]>({
    queryKey: ["session-booked-card", ...ids],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pt_sessions")
        .select("id, title, session_type, session_date, start_time, end_time, starts_at, ends_at, timezone, location, notes, client_visible_notes, meet_link, wants_meet, status")
        .in("id", ids);
      const byId = new Map(((data ?? []) as BookedRow[]).map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id)).filter((r): r is BookedRow => !!r)
        .sort((a, b) => `${a.session_date} ${a.start_time}`.localeCompare(`${b.session_date} ${b.start_time}`));
    },
  });

  if (isLoading) return <div className="h-24 w-[min(18rem,72vw)] animate-pulse rounded-2xl bg-muted" />;
  const sessions = rows ?? [];
  const shown = all ? sessions : sessions.slice(0, COLLAPSED);
  const one = sessions.length === 1 ? sessions[0] : null;
  const titles = new Set(sessions.map((s) => s.title || s.session_type || ""));
  // One kind of session: named once up top, so each row has room for where.
  const sameTitle = titles.size === 1 ? [...titles][0] : "";
  const heading = one
    ? one.title || one.session_type || "Session"
    : `${sameTitle ? `${sameTitle} · ` : ""}${sessions.length} sessions`;

  return (
    <div className="w-[min(18rem,72vw)] space-y-2 rounded-2xl border border-border bg-card p-3 text-foreground" data-session-booked-card>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground">
          <CalendarCheck2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{staff ? "Booked · they've been told" : "You're booked in"}</div>
          <div className="truncate text-sm font-semibold">{sessions.length ? heading : "No longer booked"}</div>
        </div>
      </div>

      {shown.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {shown.map((s) => {
            const booked = s.status === "Scheduled";
            const upcoming = !s.ends_at || Date.parse(s.ends_at) > Date.now();
            const place = bookedPlace(s);
            const join = booked && upcoming && s.meet_link ? s.meet_link : null;
            const row = (
              <>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium", !booked && "text-muted-foreground line-through decoration-muted-foreground/60")}>
                    {bookedDay(s.session_date)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {bookedTimes(s.start_time, s.end_time)}{!one && !sameTitle && s.title ? ` · ${s.title}` : ""}{place ? ` · ${place}` : ""}
                  </div>
                </div>
                {!booked && s.status && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {sessionStatusLabel(s.status)}
                  </span>
                )}
                {booked && !staff && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </>
            );
            return (
              <li key={s.id}>
                {staff ? (
                  <div className="flex min-h-11 items-center gap-2 px-3 py-2">{row}</div>
                ) : (
                  <button type="button" onClick={() => setOpen(s)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left active:bg-muted/60">
                    {row}
                  </button>
                )}
                {join && (
                  <a
                    href={join}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-3 mb-2 flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-sm font-medium text-foreground"
                  >
                    <Video className="h-4 w-4" /> Join video call
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sessions.length > COLLAPSED && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full py-1 text-center text-xs font-medium text-muted-foreground">
          {all ? "Show less" : `Show all ${sessions.length}`}
        </button>
      )}

      {!staff && <ClientSessionSheet clientId={clientId} session={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
