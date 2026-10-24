import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowRightLeft, CalendarCheck2, CalendarPlus, CalendarX2, Check, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { listenChannel } from "@/lib/realtime-channel";
import { answerSessionRequest, withdrawSessionRequest } from "@/lib/session-requests.functions";
import {
  oneTapApprovable, replaceCandidates, sessionChipLabel, requestStatusLabel, requestTypeLabel, requestUsesCredit, requestWhen,
  suggestReplaced, type SessionRequest,
} from "@/lib/session-requests";
import { invalidatePtSessionCaches } from "@/lib/pt-session-manage";
import { DEFAULT_TZ, addDaysISO, deviceTodayISO, minutesBetweenHM } from "@/lib/schedule-time";
import { useConflictCheck } from "@/components/schedule/use-conflict-check";
import { useCreditOutlook } from "@/components/schedule/use-credit-outlook";
import { kickGoogleSync } from "@/components/schedule/session-actions-sheet";
import { cn } from "@/lib/utils";

const db = supabase as any;
const DECLINE_REASONS = ["That time's taken", "I'm away that day", "Let's chat about it first"];

type BookedRow = { id: string; title: string | null; session_date: string; start_time: string; end_time: string; status: string; timezone: string | null; uses_credit?: boolean | null };

/** "Tue, Oct 27 · 11:00 AM". */
function sessionWhen(s: { session_date: string; start_time: string }): string {
  return requestWhen({ preferred_date: s.session_date, preferred_time: s.start_time });
}

/**
 * A client's session request, as a card in the chat. The coach answers it in one tap:
 * Approve moves the booked session it's instead of ("Changing Tuesday session for this
 * day": the credit moves with it) or books it as an extra session from the client's own
 * usual one, saying where its credit comes from; clashes show before the tap. More
 * options opens the full booking dialog. The client sees where it's at and can withdraw
 * it while it's waiting.
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
  // undefined = go with the suggestion; null = an extra session; an id = move that one.
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState("");

  const key = ["session-request", requestId];
  const { data: req, isLoading } = useQuery<SessionRequest | null>({
    queryKey: key,
    queryFn: async () => (await db.from("session_requests").select("*").eq("id", requestId).maybeSingle()).data ?? null,
  });
  const pending = req?.status === "pending";
  const answering = staff && pending;
  const today = deviceTodayISO();

  const { data: session } = useQuery({
    queryKey: ["session-request-booked", req?.pt_session_id],
    enabled: !!req?.pt_session_id,
    queryFn: async () =>
      (await db.from("pt_sessions").select("id, title, session_date, start_time, location, status").eq("id", req!.pt_session_id).maybeSingle()).data,
  });
  // The client's booked sessions around the asked-for day: what it could be instead of.
  const { data: booked = [] } = useQuery<BookedRow[]>({
    queryKey: ["session-request-candidates", requestId, req?.preferred_date],
    enabled: answering,
    queryFn: async () =>
      ((await db.from("pt_sessions")
        .select("id, title, session_date, start_time, end_time, status, timezone, uses_credit")
        .eq("client_id", clientId).eq("status", "Scheduled")
        .gte("session_date", addDaysISO(req!.preferred_date, -7))
        .lte("session_date", addDaysISO(req!.preferred_date, 7))
        .order("session_date").order("start_time")).data ?? []) as BookedRow[],
  });
  // What the client said it's instead of, for their own view of the card.
  const { data: theirPick } = useQuery<BookedRow | null>({
    queryKey: ["session-request-replaces", req?.replaces_session_id],
    enabled: !staff && !!req?.replaces_session_id,
    queryFn: async () =>
      ((await db.from("pt_sessions").select("id, title, session_date, start_time, end_time, status, timezone")
        .eq("id", req!.replaces_session_id).maybeSingle()).data ?? null) as BookedRow | null,
  });
  const { data: who } = useQuery({
    queryKey: ["session-sheet-client", clientId],
    enabled: answering,
    staleTime: 60_000,
    queryFn: async () =>
      (await db.from("clients").select("id, full_name, first_name").eq("id", clientId).maybeSingle()).data as
        | { id: string; full_name: string | null; first_name: string | null }
        | null,
  });
  const { data: clientRow } = useQuery({
    queryKey: ["session-request-client", clientId],
    enabled: staff && booking,
    queryFn: async () =>
      (await db.from("clients")
        .select("id, full_name, timezone, default_session_location, package_tracking_enabled, sessions_purchased, sessions_used")
        .eq("id", clientId).maybeSingle()).data,
  });

  // A training request swaps a training session, a call a call.
  const sameKind = useMemo(
    () => (req ? booked.filter((s) => (s.uses_credit !== false) === requestUsesCredit(req.request_type)) : []),
    [req, booked],
  );
  const candidates = useMemo(() => (req ? replaceCandidates(req, sameKind, today) : []), [req, sameKind, today]);
  const suggested = useMemo(() => (req ? suggestReplaced(req, sameKind, today) : null), [req, sameKind, today]);
  const replaceId = choice === undefined ? suggested : choice;
  const replacing = candidates.find((s) => s.id === replaceId) ?? null;
  const first = who?.first_name || who?.full_name?.split(" ")[0] || "";
  const start = (req?.preferred_time ? req.preferred_time.slice(0, 5) : "") || time;
  const length = replacing
    ? Math.max(minutesBetweenHM(replacing.start_time.slice(0, 5), replacing.end_time.slice(0, 5)), 15)
    : req?.duration_minutes ?? 60;
  const endMinutes = start ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + length : 0;
  const end = start && endMinutes < 24 * 60 ? `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}` : "";
  const oneTap = !!req && (!!replacing || oneTapApprovable(req.request_type));
  const conflict = useConflictCheck({
    slots: req && start && end ? [{ key: "req", date: req.preferred_date, start, end }] : [],
    timezone: replacing?.timezone || req?.timezone || DEFAULT_TZ,
    excludeSessionIds: replacing ? [replacing.id] : [],
    enabled: answering && oneTap && !!start && !!end,
  });
  const credit = useCreditOutlook(clientId, {
    first,
    enabled: answering && !replacing && !!req && requestUsesCredit(req.request_type),
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
  const refreshSessions = () => {
    invalidatePtSessionCaches(qc, clientId);
    qc.invalidateQueries({ queryKey: ["cal-admin-pt"] });
    qc.invalidateQueries({ queryKey: ["cal-client-pt"] });
    qc.invalidateQueries({ queryKey: ["schedule-change-requests"] });
    kickGoogleSync();
  };

  if (isLoading) return <div className="h-24 w-64 animate-pulse rounded-2xl bg-secondary/40" />;
  if (!req) return null;

  const tone = req.status === "approved" ? "border-emerald-500/40 bg-emerald-500/10"
    : req.status === "pending" ? "border-primary/40 bg-primary/5"
    : "border-border bg-secondary/30";
  const StatusIcon = req.status === "approved" ? CalendarCheck2 : req.status === "pending" ? Clock : CalendarX2;
  const clashes = conflict.conflicts[0]?.items ?? [];
  const checking = conflict.checking;
  const needsTime = !req.preferred_time && !time;
  const blockedByPackage = !replacing && credit?.needsConfirm;

  const approve = async () => {
    if (!oneTap) { setBooking(true); return; }
    setBusy(true);
    try {
      const r = await answer({
        data: { action: "approve", requestId, replaceSessionId: replacing?.id ?? null, startTime: req.preferred_time ? undefined : time },
      });
      const at = requestWhen({ preferred_date: req.preferred_date, preferred_time: start });
      const told = first ? `${first} was told` : "they've been told";
      toast.success(r.outcome === "moved" ? `Moved to ${at} · ${told}` : `Booked ${at} · ${told}`, {
        description: r.outcome === "moved" ? "The credit moved with it." : r.outcome === "booked" && credit ? credit.text : undefined,
      });
      refresh();
      refreshSessions();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't approve it");
    } finally {
      setBusy(false);
    }
  };

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

  const approvedLabel = req.status === "approved" && session
    ? `${req.replaces_session_id ? "Moved to" : "Booked ·"} ${sessionWhen(session)}`
    : requestStatusLabel(req.status, staff ? "you" : "your coach");
  const chip = (on: boolean) => cn(
    "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-[0.97]",
    on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
  );

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
        {!staff && pending && theirPick && <div className="text-xs text-muted-foreground">Instead of {sessionWhen(theirPick)}</div>}
        {req.note && <div className="whitespace-pre-wrap text-xs text-foreground/80">“{req.note}”</div>}
      </div>

      {answering && !declining && (
        <div className="space-y-1.5 rounded-xl border border-border bg-background/60 p-2.5" data-request-plan>
          {replacing ? (
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-1 text-xs font-semibold">
                <ArrowRightLeft className="mr-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>Instead of</span>
                <span className="text-muted-foreground line-through decoration-muted-foreground/60">{sessionWhen(replacing)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">That session moves here. Its credit moves with it.</div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-xs font-semibold">
                <CalendarPlus className="mr-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                {oneTap ? "Extra session" : "Book it from More options"}
              </div>
              {credit && (
                <div className={cn("text-[11px]",
                  credit.tone === "none" ? "text-amber-600 dark:text-amber-300" : credit.tone === "renewal" ? "text-foreground/80" : "text-muted-foreground")}>
                  {credit.text}
                </div>
              )}
              {!requestUsesCredit(req.request_type) && <div className="text-[11px] text-muted-foreground">Doesn't use a session credit.</div>}
            </div>
          )}

          {picking && (
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Instead of">
              {candidates.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={replaceId === s.id}
                  onClick={() => { setChoice(s.id); setPicking(false); }} className={chip(replaceId === s.id)}>
                  {sessionChipLabel(s.session_date, s.start_time)}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={!replacing} onClick={() => { setChoice(null); setPicking(false); }} className={chip(!replacing)}>
                Extra session
              </button>
            </div>
          )}

          {!req.preferred_time && (
            <label className="flex items-center gap-2 text-xs">
              <span className="font-semibold">Time</span>
              <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-border bg-background px-2 text-[16px] md:text-sm" />
            </label>
          )}

          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 pt-0.5">
            {oneTap && start ? (
              checking ? (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking your calendar…</div>
              ) : !end ? (
                <div className="flex items-center gap-1.5 text-[11px] text-destructive"><AlertTriangle className="h-3 w-3" /> That runs past midnight.</div>
              ) : clashes.length ? (
                <div className="flex min-w-0 items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                  <span>Clashes with {clashes[0].title}{clashes.length > 1 ? ` and ${clashes.length - 1} more` : ""}</span>
                </div>
              ) : conflict.failed ? (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-300"><AlertTriangle className="h-3 w-3" /> Couldn't check your calendar.</div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-success"><CheckCircle2 className="h-3 w-3" /> You're free then.</div>
              )
            ) : <span />}
            {candidates.length > 0 && !picking && (
              <button type="button" onClick={() => setPicking(true)} className="text-[11px] font-semibold text-primary">
                {replacing ? "Not this one?" : "Instead of a booked one?"}
              </button>
            )}
          </div>
        </div>
      )}

      {!answering && (
        <div className={cn("flex items-center gap-1.5 text-xs font-semibold",
          req.status === "approved" ? "text-emerald-600 dark:text-emerald-400" : req.status === "pending" ? "text-primary" : "text-muted-foreground")}>
          <StatusIcon className="h-3.5 w-3.5" />
          {approvedLabel}
        </div>
      )}
      {req.status === "declined" && req.decline_reason && <div className="text-xs text-muted-foreground">{req.decline_reason}</div>}

      {answering && !declining && (
        <div className="space-y-1.5 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm"
              className={cn("h-9 font-bold", clashes.length || blockedByPackage ? "bg-amber-600 text-white hover:bg-amber-600/90" : "bg-gradient-primary")}
              disabled={busy || (oneTap && (needsTime || !end || checking))}
              onClick={approve}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : !(clashes.length || blockedByPackage) && <Check className="mr-1 h-4 w-4" />}
              {!oneTap ? "Book it…" : clashes.length || blockedByPackage ? "Approve anyway" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => setDeclining(true)}>
              <X className="mr-1 h-4 w-4" /> Decline
            </Button>
          </div>
          {oneTap && !replacing && (
            <button type="button" onClick={() => setBooking(true)} className="w-full text-center text-[11px] font-semibold text-muted-foreground hover:text-foreground">
              More options
            </button>
          )}
        </div>
      )}
      {answering && declining && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1">
            {DECLINE_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={chip(reason === r)}>
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
        <Link to="/portal/calendar" className="inline-flex text-xs font-bold text-primary">Open my calendar →</Link>
      )}

      {staff && booking && clientRow && (
        <PtSessionDialog
          open={booking}
          onOpenChange={setBooking}
          clientId={clientId}
          clients={[clientRow]}
          initialDate={req.preferred_date}
          initialTime={start || "09:00"}
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
