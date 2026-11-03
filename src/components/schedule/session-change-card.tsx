import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowRightLeft, CalendarCheck2, CalendarClock, CalendarX2, Check, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listenChannel } from "@/lib/realtime-channel";
import { answerSessionChange, withdrawSessionChange } from "@/lib/schedule.functions";
import { requestWhen } from "@/lib/session-requests";
import { invalidatePtSessionCaches } from "@/lib/pt-session-manage";
import { DEFAULT_TZ, minutesBetweenHM } from "@/lib/schedule-time";
import { useConflictCheck } from "@/components/schedule/use-conflict-check";
import { SessionActionsSheet, kickGoogleSync, type ActionSession } from "@/components/schedule/session-actions-sheet";
import { cn } from "@/lib/utils";

const db = supabase as any;
const DECLINE_REASONS = ["That time's taken", "Let's keep it as booked", "Let's chat about it first"];

type ChangeRequestRow = {
  id: string;
  pt_session_id: string;
  client_id: string;
  kind: "move" | "cancel";
  proposed_date: string | null;
  proposed_start: string | null;
  preferred_times: string | null;
  note: string | null;
  status: "pending" | "done" | "declined" | "withdrawn";
  resolution: string | null;
};

/** "Tue, Nov 3 · 11:00 AM". */
function when(date: string, time: string): string {
  return requestWhen({ preferred_date: date, preferred_time: time });
}

/**
 * A client's "Change time" / "Can't make it" request, as a card in the chat
 * (the client's own message carries it: `kind: "session_change"`). The coach
 * answers right there: Approve moves the session to the exact time asked for
 * (same length, its credit and Google event follow), Decline keeps it booked,
 * Other time opens the session's move form; a "can't make it" opens the
 * session's options (bank the credit or count it). The client sees where it's
 * at and can take it back while it's waiting.
 */
export function SessionChangeCard({ requestId, staff, clientId }: { requestId: string; staff: boolean; clientId: string }) {
  const qc = useQueryClient();
  const channelId = useId();
  const answer = useServerFn(answerSessionChange);
  const withdraw = useServerFn(withdrawSessionChange);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "menu" | "move">(null);

  const key = ["session-change", requestId];
  const { data: req, isLoading } = useQuery<ChangeRequestRow | null>({
    queryKey: key,
    queryFn: async () => (await db.from("pt_session_change_requests").select("*").eq("id", requestId).maybeSingle()).data ?? null,
  });
  const sessionKey = ["session-change-session", req?.pt_session_id];
  const { data: session } = useQuery<ActionSession | null>({
    queryKey: sessionKey,
    enabled: !!req?.pt_session_id,
    queryFn: async () =>
      ((await db.from("pt_sessions")
        .select("id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id")
        .eq("id", req!.pt_session_id).maybeSingle()).data ?? null) as ActionSession | null,
  });

  const pending = req?.status === "pending";
  const answering = staff && pending;
  const proposed = req?.kind === "move" && req.proposed_date && req.proposed_start
    ? { date: req.proposed_date, start: req.proposed_start.slice(0, 5) }
    : null;
  const length = session ? minutesBetweenHM(session.start_time.slice(0, 5), session.end_time.slice(0, 5)) : 60;
  const endMin = proposed ? Number(proposed.start.slice(0, 2)) * 60 + Number(proposed.start.slice(3, 5)) + (length > 0 ? length : 60) : 0;
  const end = proposed && endMin < 24 * 60
    ? `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`
    : "";
  const conflict = useConflictCheck({
    slots: answering && proposed && end ? [{ key: "change", date: proposed.date, start: proposed.start, end }] : [],
    timezone: session?.timezone || DEFAULT_TZ,
    excludeSessionIds: session ? [session.id] : [],
    enabled: answering && !!proposed && !!session && !!end,
  });

  useEffect(() => {
    const ch = listenChannel(`session-change-${requestId}-${channelId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pt_session_change_requests", filter: `id=eq.${requestId}` }, () => {
        qc.invalidateQueries({ queryKey: ["session-change", requestId] });
        qc.invalidateQueries({ queryKey: ["session-change-session"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [requestId, channelId, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["session-change-session"] });
    qc.invalidateQueries({ queryKey: ["schedule-change-requests"] });
    qc.invalidateQueries({ queryKey: ["session-change-request"] });
    qc.invalidateQueries({ queryKey: ["my-session-requests"] });
    qc.invalidateQueries({ queryKey: ["cal-admin-pt"] });
    qc.invalidateQueries({ queryKey: ["cal-client-pt"] });
    invalidatePtSessionCaches(qc, clientId);
  };

  if (isLoading) return <div className="h-24 w-64 animate-pulse rounded-2xl bg-secondary/40" />;
  if (!req) return null;

  const clashes = conflict.conflicts[0]?.items ?? [];
  const title = session?.title || session?.session_type || "session";
  const tone = req.status === "done" ? "border-emerald-500/40 bg-emerald-500/10"
    : pending ? "border-primary/40 bg-primary/5"
    : "border-border bg-secondary/30";
  const StatusIcon = req.status === "done" ? CalendarCheck2 : pending ? Clock : CalendarX2;
  const statusText = pending
    ? `Waiting for ${staff ? "you" : "your coach"}`
    : req.status === "done"
      ? req.resolution === "moved" && session ? `Moved to ${when(session.session_date, session.start_time)}` : "Answered"
      : req.status === "declined"
        ? `Kept as booked${req.resolution && req.resolution !== "declined" ? ` · ${req.resolution}` : ""}`
        : "Withdrawn";

  const run = async (action: "approve" | "decline") => {
    setBusy(true);
    try {
      await answer({ data: action === "approve" ? { action, requestId } : { action, requestId, reason: reason.trim() || undefined } });
      toast.success(action === "approve"
        ? `Moved to ${proposed ? when(proposed.date, proposed.start) : "the new time"} · they've been told`
        : "Kept as booked · they've been told");
      setDeclining(false);
      refresh();
      if (action === "approve") kickGoogleSync();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't answer it");
    } finally {
      setBusy(false);
    }
  };

  const chip = (on: boolean) => cn(
    "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-[0.97]",
    on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
  );

  return (
    <div className={cn("w-[min(18rem,72vw)] space-y-2 rounded-2xl border p-3 text-foreground", tone)} data-session-change-card>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          {req.kind === "move" ? <ArrowRightLeft className="h-4 w-4" /> : <CalendarX2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {req.kind === "move" ? "Change time" : "Can't make it"}
          </div>
          <div className="truncate text-sm font-bold">{title}</div>
        </div>
      </div>

      {session && (
        <div className="space-y-0.5 text-sm">
          {pending && req.kind === "move" && proposed ? (
            <>
              <div className="text-xs text-muted-foreground line-through decoration-muted-foreground/60">{when(session.session_date, session.start_time)}</div>
              <div className="font-semibold">{when(proposed.date, proposed.start)}</div>
            </>
          ) : pending ? (
            <div className="font-semibold">{when(session.session_date, session.start_time)}</div>
          ) : null}
          {req.preferred_times && (
            <div className="text-xs text-muted-foreground">{proposed ? "Also works" : "Better times"}: {req.preferred_times}</div>
          )}
          {req.note && <div className="whitespace-pre-wrap text-xs text-foreground/80">“{req.note}”</div>}
        </div>
      )}

      {answering && !declining && proposed && (
        conflict.checking ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking your calendar…</div>
        ) : !end ? (
          <div className="flex items-center gap-1.5 text-[11px] text-destructive"><AlertTriangle className="h-3 w-3" /> That runs past midnight.</div>
        ) : clashes.length ? (
          <div className="flex items-start gap-1.5 text-[11px] text-destructive">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>Clashes with {clashes[0].title}{clashes.length > 1 ? ` and ${clashes.length - 1} more` : ""}</span>
          </div>
        ) : conflict.failed ? (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-300"><AlertTriangle className="h-3 w-3" /> Couldn't check your calendar.</div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-success"><CheckCircle2 className="h-3 w-3" /> You're free then.</div>
        )
      )}

      {!answering && (
        <div className={cn("flex items-center gap-1.5 text-xs font-semibold",
          req.status === "done" ? "text-emerald-600 dark:text-emerald-400" : pending ? "text-primary" : "text-muted-foreground")}>
          <StatusIcon className="h-3.5 w-3.5" />
          {statusText}
        </div>
      )}

      {answering && !declining && (
        <div className="space-y-1.5 pt-1">
          {req.kind === "move" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {proposed ? (
                  <Button size="sm"
                    className={cn("h-9 font-semibold", clashes.length ? "bg-amber-600 text-white hover:bg-amber-600/90" : "bg-primary")}
                    disabled={busy || !session || !end || conflict.checking}
                    onClick={() => run("approve")}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : !clashes.length && <Check className="mr-1 h-4 w-4" />}
                    {clashes.length ? "Approve anyway" : "Approve"}
                  </Button>
                ) : (
                  <Button size="sm" className="h-9 bg-primary font-semibold" disabled={!session} onClick={() => setSheet("move")}>
                    <CalendarClock className="mr-1 h-4 w-4" /> Pick a time
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => setDeclining(true)}>
                  <X className="mr-1 h-4 w-4" /> Decline
                </Button>
              </div>
              {proposed && (
                <button type="button" disabled={!session} onClick={() => setSheet("move")}
                  className="w-full text-center text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                  Other time
                </button>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className="h-9 bg-primary font-semibold" disabled={!session} onClick={() => setSheet("menu")}>
                Bank or count
              </Button>
              <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => setDeclining(true)}>
                Keep booked
              </Button>
            </div>
          )}
        </div>
      )}

      {answering && declining && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1">
            {DECLINE_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={chip(reason === r)}>{r}</button>
            ))}
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
            placeholder="Reason (optional) — they'll see this"
            className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[16px] outline-none md:text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="ghost" className="h-9" onClick={() => { setDeclining(false); setReason(""); }}>Back</Button>
            <Button size="sm" variant="destructive" className="h-9" disabled={busy} onClick={() => run("decline")}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {req.kind === "move" ? "Decline" : "Keep booked"}
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
      {!staff && req.status === "done" && (
        <Link to="/portal/calendar" className="inline-flex text-xs font-bold text-primary">Open my calendar →</Link>
      )}

      {staff && session && (
        <SessionActionsSheet
          session={sheet ? session : null}
          open={!!sheet}
          onOpenChange={(o) => { if (!o) { setSheet(null); refresh(); } }}
          initialMode={sheet === "move" ? "move" : "menu"}
        />
      )}
    </div>
  );
}
