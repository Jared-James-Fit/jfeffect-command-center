import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck2, CalendarPlus, CalendarX2, Check, Clock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { listenChannel } from "@/lib/realtime-channel";
import { answerSessionRequest, withdrawSessionRequest } from "@/lib/session-requests.functions";
import { requestStatusLabel, requestTypeLabel, requestWhen, type SessionRequest } from "@/lib/session-requests";
import { cn } from "@/lib/utils";

const db = supabase as any;
const DECLINE_REASONS = ["That time's taken", "I'm away that day", "Let's chat about it first"];

/**
 * A client's session request, as a card in the chat. The coach approves it (books it with
 * the normal booking dialog, prefilled) or declines it; the client sees where it's at and
 * can withdraw it while it's waiting.
 */
export function SessionRequestCard({ requestId, staff, clientId }: { requestId: string; staff: boolean; clientId: string }) {
  const qc = useQueryClient();
  const channelId = useId();
  const answer = useServerFn(answerSessionRequest);
  const withdraw = useServerFn(withdrawSessionRequest);
  const [booking, setBooking] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const key = ["session-request", requestId];
  const { data: req, isLoading } = useQuery<SessionRequest | null>({
    queryKey: key,
    queryFn: async () => (await db.from("session_requests").select("*").eq("id", requestId).maybeSingle()).data ?? null,
  });
  const { data: session } = useQuery({
    queryKey: ["session-request-booked", req?.pt_session_id],
    enabled: !!req?.pt_session_id,
    queryFn: async () =>
      (await db.from("pt_sessions").select("id, title, session_date, start_time, location, status").eq("id", req!.pt_session_id).maybeSingle()).data,
  });
  const { data: clientRow } = useQuery({
    queryKey: ["session-request-client", clientId],
    enabled: staff && booking,
    queryFn: async () =>
      (await db.from("clients")
        .select("id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used")
        .eq("id", clientId).maybeSingle()).data,
  });

  useEffect(() => {
    const ch = listenChannel(`session-request-${requestId}-${channelId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "session_requests", filter: `id=eq.${requestId}` }, () => {
        qc.invalidateQueries({ queryKey: ["session-request", requestId] });
        qc.invalidateQueries({ queryKey: ["my-session-requests"] });
        qc.invalidateQueries({ queryKey: ["pending-session-requests"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [requestId, channelId, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["my-session-requests"] });
    qc.invalidateQueries({ queryKey: ["pending-session-requests"] });
  };

  if (isLoading) return <div className="h-24 w-64 animate-pulse rounded-2xl bg-secondary/40" />;
  if (!req) return null;

  const pending = req.status === "pending";
  const tone = req.status === "approved" ? "border-emerald-500/40 bg-emerald-500/10"
    : req.status === "pending" ? "border-primary/40 bg-primary/5"
    : "border-border bg-secondary/30";
  const StatusIcon = req.status === "approved" ? CalendarCheck2 : req.status === "pending" ? Clock : CalendarX2;

  const decline = async () => {
    setBusy(true);
    try {
      await answer({ data: { action: "decline", requestId, reason: reason.trim() || undefined } });
      toast.success("Declined — they've been told to pick another time");
      setDeclining(false);
      refresh();
    } catch (e: any) { toast.error(e?.message ?? "Couldn't decline"); }
    finally { setBusy(false); }
  };

  return (
    <div className={cn("w-[min(18rem,72vw)] space-y-2 rounded-2xl border p-3 text-foreground", tone)}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <CalendarPlus className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session request</div>
          <div className="truncate text-sm font-bold">{requestTypeLabel(req.request_type)}</div>
        </div>
      </div>

      <div className="space-y-0.5 text-sm">
        <div className="font-semibold">{requestWhen(req)}</div>
        <div className="text-xs text-muted-foreground">{req.duration_minutes} min{req.alt_times ? ` · Also works: ${req.alt_times}` : ""}</div>
        {req.note && <div className="whitespace-pre-wrap text-xs text-foreground/80">“{req.note}”</div>}
      </div>

      <div className={cn("flex items-center gap-1.5 text-xs font-semibold",
        req.status === "approved" ? "text-emerald-600 dark:text-emerald-400" : req.status === "pending" ? "text-primary" : "text-muted-foreground")}>
        <StatusIcon className="h-3.5 w-3.5" />
        {req.status === "approved" && session
          ? `Booked · ${new Date(`${session.session_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
          : requestStatusLabel(req.status, staff ? "you" : "your coach")}
      </div>
      {req.status === "declined" && req.decline_reason && <div className="text-xs text-muted-foreground">{req.decline_reason}</div>}

      {staff && pending && !declining && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button size="sm" className="h-9 bg-gradient-primary font-bold" onClick={() => setBooking(true)}>
            <Check className="mr-1 h-4 w-4" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => setDeclining(true)}>
            <X className="mr-1 h-4 w-4" /> Decline
          </Button>
        </div>
      )}
      {staff && pending && declining && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1">
            {DECLINE_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", reason === r ? "border-primary bg-primary/15 text-primary" : "border-border")}>
                {r}
              </button>
            ))}
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
            placeholder="Reason (optional) — they'll see this"
            className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[16px] outline-none md:text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="ghost" className="h-9" onClick={() => { setDeclining(false); setReason(""); }}>Back</Button>
            <Button size="sm" variant="destructive" className="h-9" disabled={busy} onClick={decline}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Decline
            </Button>
          </div>
        </div>
      )}
      {!staff && pending && (
        <button type="button" disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await withdraw({ data: { requestId } }); toast.success("Request withdrawn"); refresh(); }
            catch (e: any) { toast.error(e?.message ?? "Couldn't withdraw"); }
            finally { setBusy(false); }
          }}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline">
          Withdraw request
        </button>
      )}
      {!staff && req.status === "approved" && (
        <Link to="/portal/calendar" className="inline-flex text-xs font-bold text-primary">Open my schedule →</Link>
      )}

      {staff && booking && clientRow && (
        <PtSessionDialog
          open={booking}
          onOpenChange={setBooking}
          clientId={clientId}
          clients={[clientRow]}
          initialDate={req.preferred_date}
          initialTime={req.preferred_time ? req.preferred_time.slice(0, 5) : "09:00"}
          onBooked={async (ids) => {
            await answer({ data: { action: "approve", requestId, ptSessionId: ids[0] } });
            toast.success("Approved — they've been told it's booked");
            refresh();
          }}
        />
      )}
    </div>
  );
}
