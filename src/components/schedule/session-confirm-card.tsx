/**
 * The day-before card for a call (`kind: "session_confirm"`, coaching-sessions
 * automation.server.ts; Nov 25 2026): when, how long, where or the video
 * link, read live, so a moved or cancelled call shows as it is now. The
 * client confirms in one tap (`pt_session_confirm`, their own session only),
 * or asks for another time or says they can't make it through the same
 * sheet as everywhere else (ClientSessionSheet: the session stays booked
 * until the coach answers). The coach sees whether it's confirmed. A message
 * that only carried the pre-meeting questions has no Confirm.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Check, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ClientSessionSheet, type ClientSession } from "@/components/schedule/client-session-sheet";
import { bookedDay, bookedPlace, bookedTimes } from "@/lib/session-booked";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { appointmentState, STATE_WORDS, SELF_BOOKED_VIA } from "@/lib/coaching-sessions/lifecycle";
import { cn } from "@/lib/utils";

type Row = ClientSession & {
  id: string;
  title: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  status: string | null;
  ends_at?: string | null;
  starts_at?: string | null;
  booked_via?: string | null;
  client_confirmed_at?: string | null;
  confirmation_requested_at?: string | null;
};

export function SessionConfirmCard({
  ptSessionId,
  staff,
  clientId,
  askConfirm = true,
}: {
  ptSessionId: string;
  staff: boolean;
  clientId: string;
  askConfirm?: boolean;
}) {
  const qc = useQueryClient();
  const { isImpersonating: isPov } = useClientImpersonation();
  const [sheet, setSheet] = useState<null | "view" | "move" | "cancel">(null);
  const [busy, setBusy] = useState(false);
  const key = ["session-confirm-card", ptSessionId] as const;
  const q = useQuery({
    queryKey: key,
    staleTime: 20_000,
    queryFn: async () => {
      const [{ data, error }, { data: req }] = await Promise.all([
        (supabase as any)
          .from("pt_sessions")
          .select(
            "id, title, session_type, session_date, start_time, end_time, starts_at, ends_at, timezone, location, notes, client_visible_notes, meet_link, wants_meet, status, booked_via, client_confirmed_at, confirmation_requested_at",
          )
          .eq("id", ptSessionId)
          .maybeSingle(),
        supabase
          .from("pt_session_change_requests")
          .select("id, kind")
          .eq("pt_session_id", ptSessionId)
          .eq("status", "pending")
          .limit(1),
      ]);
      if (error) throw error;
      return { row: (data as Row | null) ?? null, pending: ((req ?? []) as any[])[0] ?? null };
    },
  });
  if (q.isLoading)
    return <div className="h-24 w-[min(18rem,72vw)] jf-skeleton rounded-2xl bg-muted" />;
  const s = q.data?.row;
  if (!s) return null;
  const state = appointmentState({
    status: s.status,
    startsAt: s.starts_at ?? null,
    clientConfirmedAt: s.client_confirmed_at ?? null,
    confirmationRequestedAt: s.confirmation_requested_at ?? null,
    pendingChange: q.data?.pending?.kind ?? null,
    bookedByClient: SELF_BOOKED_VIA.has(String(s.booked_via ?? "")),
  });
  const booked = s.status === "Scheduled";
  const upcoming = !s.ends_at || Date.parse(s.ends_at) > Date.now();
  const place = bookedPlace(s);
  const title = s.title || s.session_type || "Call";
  const confirm = async () => {
    if (isPov) {
      toast("Preview only: they confirm from their own app");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("pt_session_confirm", {
        _session: ptSessionId,
      });
      if (error) throw error;
      toast.success("Confirmed");
      qc.invalidateQueries({ queryKey: key });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't confirm it");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="w-[min(18rem,72vw)] space-y-2 rounded-2xl border border-border bg-card p-3 text-foreground"
      data-session-confirm-card
      data-state={state}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            {staff
              ? "Confirmation request"
              : askConfirm && state === "awaiting_confirmation"
                ? "Can you still make it?"
                : "Your call"}
          </div>
          <div className="truncate text-sm font-semibold">{title}</div>
        </div>
      </div>
      <button
        type="button"
        disabled={staff}
        onClick={() => setSheet("view")}
        className="block w-full rounded-xl border border-border px-3 py-2 text-left disabled:cursor-default"
      >
        <div className={cn("text-sm font-medium", !booked && "text-muted-foreground line-through")}>
          {bookedDay(s.session_date)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {bookedTimes(s.start_time, s.end_time)}
          {place ? ` · ${place}` : ""}
        </div>
      </button>
      <p
        className={cn(
          "text-xs font-medium",
          state === "confirmed"
            ? "text-success"
            : state === "reschedule_requested" || state === "cancelled"
              ? "text-warning"
              : "text-muted-foreground",
        )}
        data-confirm-state
      >
        {state === "confirmed" ? (
          <span className="inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Confirmed
          </span>
        ) : (
          STATE_WORDS[state]
        )}
      </p>
      {!staff && booked && upcoming && state !== "reschedule_requested" ? (
        <div className="flex flex-col gap-1.5">
          {askConfirm && state !== "confirmed" ? (
            <Button className="h-10" onClick={confirm} loading={busy} data-confirm-call>
              Confirm
            </Button>
          ) : null}
          {s.meet_link ? (
            <a
              href={s.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary text-sm font-medium"
            >
              <Video className="h-4 w-4" /> Join video call
            </a>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" className="h-10" onClick={() => setSheet("move")}>
              Change time
            </Button>
            <Button variant="ghost" className="h-10" onClick={() => setSheet("cancel")}>
              Can't make it
            </Button>
          </div>
        </div>
      ) : null}
      {!staff ? (
        <ClientSessionSheet
          clientId={clientId}
          session={sheet ? s : null}
          initialMode={sheet ?? "view"}
          onClose={() => {
            setSheet(null);
            qc.invalidateQueries({ queryKey: key });
          }}
        />
      ) : null}
    </div>
  );
}
