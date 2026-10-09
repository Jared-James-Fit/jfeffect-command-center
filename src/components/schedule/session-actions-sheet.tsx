import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban, CalendarClock, CheckCircle2, CircleOff, Clock, MapPin, MessageSquare, Pencil, ChevronLeft, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NoShowPtDialog } from "@/components/pt-session-manage-dialogs";
import { setPtSessionStatus } from "@/lib/pt-pack.functions";
import { invalidatePtSessionCaches } from "@/lib/pt-session-manage";
import { statusTone } from "@/lib/pt-sessions";
import { sendMessage } from "@/lib/messages";
import { useAuth } from "@/lib/auth";
import { kickScheduleSync, textClientSessionChange } from "@/lib/schedule.functions";
import { isLastMinute } from "@/lib/pt-session-reminders";
import { addMinutesHM, fmtWallClock, minutesBetweenHM, wallTimeToUtc, DEFAULT_TZ } from "@/lib/schedule-time";
import { ConflictNotice, useConflictCheck } from "@/components/schedule/use-conflict-check";
import { cn } from "@/lib/utils";

export type ActionSession = {
  id: string;
  client_id: string;
  title: string | null;
  session_type?: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  timezone: string | null;
  location: string | null;
  status: string;
  uses_credit?: boolean | null;
  google_event_id?: string | null;
};

export type ChangeRequest = {
  id: string;
  pt_session_id: string;
  client_id: string;
  kind: "move" | "cancel";
  preferred_times: string | null;
  note: string | null;
  status: string;
  created_at: string;
};

type Mode = "menu" | "move" | "cancel" | "decline";

const DURATIONS = [30, 45, 60, 90];

export function dayLabel(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
}

export function whenLabel(dateISO: string, startHM: string): string {
  return `${dayLabel(dateISO)} at ${fmtWallClock(startHM)}`;
}

/** Fire-and-forget: push this change to Google now instead of on the next 5-minute tick. */
export function kickGoogleSync() {
  void kickScheduleSync().catch(() => {});
}

/**
 * The coach's one place to act on a session: move it, mark it done, no-show,
 * cancel, answer the client's change request, or open the full editor. Every
 * change can tell the client in the app (and by text when it's within 48 hours).
 */
export function SessionActionsSheet({
  session,
  clientName,
  open,
  onOpenChange,
  initialMode = "menu",
  onEdit,
}: {
  session: ActionSession | null;
  clientName?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialMode?: Mode;
  onEdit?: (s: ActionSession) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);

  // Move form
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(60);
  const [override, setOverride] = useState(false);
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !session) return;
    setMode(initialMode);
    setDate(session.session_date);
    setStart(session.start_time.slice(0, 5));
    const mins = minutesBetweenHM(session.start_time.slice(0, 5), session.end_time.slice(0, 5));
    setDuration(mins > 0 ? mins : 60);
    setOverride(false);
    setNotify(true);
    setReason("");
  }, [open, session?.id, initialMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: client } = useQuery({
    queryKey: ["session-sheet-client", session?.client_id],
    enabled: open && !!session?.client_id,
    staleTime: 60_000,
    queryFn: async () =>
      (await supabase.from("clients").select("id, full_name, first_name").eq("id", session!.client_id).maybeSingle()).data as
        | { id: string; full_name: string | null; first_name: string | null }
        | null,
  });
  const { data: request } = useQuery<ChangeRequest | null>({
    queryKey: ["session-change-request", session?.id],
    enabled: open && !!session?.id,
    queryFn: async () =>
      ((
        await (supabase as any)
          .from("pt_session_change_requests")
          .select("*")
          .eq("pt_session_id", session!.id)
          .eq("status", "pending")
          .maybeSingle()
      ).data ?? null) as ChangeRequest | null,
  });

  const tz = session?.timezone || DEFAULT_TZ;
  const end = start ? addMinutesHM(start, duration) : "";
  const changedTime = !!session && (date !== session.session_date || start !== session.start_time.slice(0, 5) || end !== session.end_time.slice(0, 5));
  const conflictCheck = useConflictCheck({
    slots: date && start ? [{ key: "move", date, start, end }] : [],
    timezone: tz,
    excludeSessionIds: session ? [session.id] : [],
    enabled: open && mode === "move" && changedTime,
  });
  const blocked = conflictCheck.conflicts.length > 0 && !override;

  const name = clientName || client?.full_name || "Client";
  const first = client?.first_name || name.split(" ")[0];
  const title = session?.title || session?.session_type || "session";
  const oldStart = session ? wallTimeToUtc(session.session_date, session.start_time.slice(0, 5), tz) : null;
  const newStart = date && start ? wallTimeToUtc(date, start, tz) : null;
  const lastMinute = useMemo(() => {
    const now = new Date();
    return (!!newStart && isLastMinute(newStart, now)) || (!!oldStart && isLastMinute(oldStart, now));
  }, [newStart?.getTime(), oldStart?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;
  const isScheduled = session.status === "Scheduled";
  const when = whenLabel(session.session_date, session.start_time);

  const done = (msg: string) => {
    invalidatePtSessionCaches(qc, session.client_id);
    qc.invalidateQueries({ queryKey: ["schedule-change-requests"] });
    qc.invalidateQueries({ queryKey: ["session-change-request", session.id] });
    qc.invalidateQueries({ queryKey: ["cal-admin-pt"] });
    qc.invalidateQueries({ queryKey: ["cal-client-pt"] });
    kickGoogleSync();
    toast.success(msg);
    onOpenChange(false);
  };

  const tellClient = async (body: string) => {
    if (!user) return false;
    try {
      await sendMessage({
        clientId: session.client_id,
        senderId: user.id,
        senderRole: "admin",
        body,
        messageType: "Scheduling",
        isAutomated: true,
      });
      return true;
    } catch {
      toast.error("Saved, but the message to the client didn't send.");
      return false;
    }
  };

  const textIfUrgent = async (kind: "moved" | "cancelled", previousStartsAt?: string) => {
    try {
      const r = await textClientSessionChange({ data: { sessionId: session.id, kind, previousStartsAt: previousStartsAt ?? null } });
      return r.texted;
    } catch {
      return false;
    }
  };

  const doMove = async () => {
    if (!date || !start || !changedTime) return;
    if (end <= start) return toast.error("Pick an earlier start so the session ends the same day.");
    setBusy(true);
    try {
      const { error } = await supabase
        .from("pt_sessions")
        .update({ session_date: date, start_time: start, end_time: end })
        .eq("id", session.id);
      if (error) throw error;
      let texted = false;
      if (notify) {
        await tellClient(`Your ${title} on ${when} moved to ${whenLabel(date, start)}.`);
        texted = await textIfUrgent("moved", oldStart?.toISOString());
      }
      done(`Moved to ${whenLabel(date, start)}${texted ? ` · ${first} was texted` : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't move the session");
    } finally {
      setBusy(false);
    }
  };

  const doStatus = async (status: "Completed" | "Cancelled" | "Missed", opts: { deduct?: boolean; message?: string } = {}) => {
    setBusy(true);
    try {
      await setPtSessionStatus({ data: { sessionId: session.id, status, deductOnMissed: opts.deduct } });
      let texted = false;
      if (opts.message && notify) {
        await tellClient(opts.message);
        if (status !== "Completed") texted = await textIfUrgent("cancelled");
      }
      if (status === "Completed") {
        invalidatePtSessionCaches(qc, session.client_id);
        kickGoogleSync();
        toast.success(session.uses_credit === false ? "Marked done" : "Marked done · 1 session used", {
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                await setPtSessionStatus({ data: { sessionId: session.id, status: "Scheduled" } });
                invalidatePtSessionCaches(qc, session.client_id);
                toast.success("Undone · session is scheduled again");
              } catch (e: any) {
                toast.error(e?.message ?? "Undo failed");
              }
            },
          },
        });
        onOpenChange(false);
        return;
      }
      done(status === "Cancelled" ? `Cancelled${texted ? ` · ${first} was texted` : ""}` : "Late cancel recorded · 1 session used");
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const doDecline = async () => {
    if (!request) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("pt_session_change_requests")
        .update({ status: "declined", resolution: reason.trim() || "declined", resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null })
        .eq("id", request.id)
        .eq("status", "pending");
      if (error) throw error;
      await tellClient(
        `Your ${title} on ${when} stays as booked.${reason.trim() ? ` ${reason.trim()}` : ""}`,
      );
      done("Request declined · client told");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't decline");
    } finally {
      setBusy(false);
    }
  };

  const notifyRow = (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2">
      <div className="min-w-0">
        <Label className="text-sm">Tell {first}</Label>
        <p className="text-[11px] text-muted-foreground">
          Sends a message in the app{lastMinute ? ", plus a text since it's within 48 hours" : ""}.
        </p>
      </div>
      <Switch checked={notify} onCheckedChange={setNotify} />
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-lg space-y-4">
            <SheetHeader className="space-y-1 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusTone(session.status)}>
                  {session.status === "Missed" ? "No-show" : session.status}
                </Badge>
                {session.google_event_id && (
                  <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-300">In Google</Badge>
                )}
              </div>
              <SheetTitle className="text-left">
                <Link to="/admin/clients/$id" params={{ id: session.client_id }} className="hover:underline" onClick={() => onOpenChange(false)}>
                  {name}
                </Link>
                <span className="text-muted-foreground"> · {title}</span>
              </SheetTitle>
              <SheetDescription className="flex flex-wrap gap-x-3 gap-y-1 text-left">
                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{when}</span>
                {session.location && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{session.location.split(",")[0]}</span></span>}
              </SheetDescription>
            </SheetHeader>

            {request && mode === "menu" && (
              <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="text-sm font-semibold text-amber-200">
                  {first} {request.kind === "move" ? "asked to move this session" : "can't make this session"}
                </div>
                {request.preferred_times && (
                  <p className="text-sm"><span className="text-muted-foreground">Better times:</span> {request.preferred_times}</p>
                )}
                {request.note && <p className="text-sm"><span className="text-muted-foreground">Note:</span> {request.note}</p>}
                <div className="grid grid-cols-2 gap-2">
                  {request.kind === "move" ? (
                    <Button className="h-11 bg-gradient-primary font-bold" onClick={() => setMode("move")}>
                      <CalendarClock className="mr-2 h-4 w-4" /> Pick new time
                    </Button>
                  ) : (
                    <Button className="h-11 bg-gradient-primary font-bold" onClick={() => setMode("cancel")}>
                      <CircleOff className="mr-2 h-4 w-4" /> Cancel it
                    </Button>
                  )}
                  <Button variant="outline" className="h-11" onClick={() => setMode("decline")}>Decline</Button>
                </div>
              </div>
            )}

            {mode === "menu" && (
              <div className="space-y-2">
                {isScheduled ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="h-14 flex-col gap-0.5 text-sm" onClick={() => setMode("move")}>
                        <CalendarClock className="h-5 w-5 text-primary" /> Move
                      </Button>
                      <Button variant="outline" className="h-14 flex-col gap-0.5 text-sm" disabled={busy} onClick={() => doStatus("Completed")}>
                        <CheckCircle2 className="h-5 w-5 text-success" /> Mark done
                      </Button>
                      <Button variant="outline" className="h-14 flex-col gap-0.5 text-sm" onClick={() => setNoShowOpen(true)}>
                        <Ban className="h-5 w-5 text-warning" /> No-show
                      </Button>
                      <Button variant="outline" className="h-14 flex-col gap-0.5 text-sm" onClick={() => setMode("cancel")}>
                        <CircleOff className="h-5 w-5 text-muted-foreground" /> Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="rounded-md border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                    This session is {session.status === "Missed" ? "a no-show" : session.status.toLowerCase()}. Open the full editor to undo or restore it.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {onEdit && (
                    <Button variant="ghost" className="h-11" onClick={() => { onOpenChange(false); onEdit(session); }}>
                      <Pencil className="mr-2 h-4 w-4" /> Full editor
                    </Button>
                  )}
                  <Button variant="ghost" className="h-11" asChild>
                    <Link to="/admin/messages" search={{ client: session.client_id } as any} onClick={() => onOpenChange(false)}>
                      <MessageSquare className="mr-2 h-4 w-4" /> Message {first}
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {mode === "move" && (
              <div className="space-y-3">
                <BackButton onClick={() => setMode("menu")} />
                {request?.kind === "move" && request.preferred_times && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    {first} suggested: {request.preferred_times}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 sm:col-span-1">
                    <Label>New date</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Label>Start time</Label>
                    <Input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} className="h-11" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Length</Label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Array.from(new Set([...DURATIONS, duration])).sort((a, b) => a - b).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDuration(m)}
                        className={cn(
                          "h-9 rounded-full border px-3 text-xs font-semibold",
                          duration === m ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
                        )}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                  {end && <p className="mt-1 text-[11px] text-muted-foreground">Ends {fmtWallClock(end)}</p>}
                </div>
                {changedTime && (
                  <ConflictNotice check={conflictCheck} override={override} onOverride={setOverride} overrideLabel="Move anyway" />
                )}
                {notifyRow}
                <Button
                  className="h-12 w-full bg-gradient-primary font-bold"
                  disabled={busy || !changedTime || blocked || conflictCheck.checking}
                  onClick={doMove}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {changedTime ? `Move to ${whenLabel(date, start)}` : "Pick a new date or time"}
                </Button>
              </div>
            )}

            {mode === "cancel" && (
              <div className="space-y-3">
                <BackButton onClick={() => setMode("menu")} />
                <p className="text-sm">Cancel {first}'s session on {when}?</p>
                {notifyRow}
                <Button
                  className="h-12 w-full"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => doStatus("Cancelled", { message: `Your ${title} on ${when} is cancelled.` })}
                >
                  Cancel · session goes back to {first}
                </Button>
                {session.uses_credit !== false && (
                  <Button
                    className="h-12 w-full"
                    variant="outline"
                    disabled={busy}
                    onClick={() => doStatus("Missed", { deduct: true, message: `Your ${title} on ${when} is cancelled. It counts as a used session.` })}
                  >
                    Late cancel · counts as used
                  </Button>
                )}
              </div>
            )}

            {mode === "decline" && request && (
              <div className="space-y-3">
                <BackButton onClick={() => setMode("menu")} />
                <p className="text-sm">The session stays on {when}. {first} gets a message.</p>
                <div>
                  <Label>Reason or other options (optional)</Label>
                  <Textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. I'm booked Wednesday. Thursday at 4 works if you want it."
                  />
                </div>
                <Button className="h-12 w-full" variant="outline" disabled={busy} onClick={doDecline}>
                  Decline request
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <NoShowPtDialog
        open={noShowOpen}
        onOpenChange={setNoShowOpen}
        session={session as any}
        onDone={() => {
          invalidatePtSessionCaches(qc, session.client_id);
          kickGoogleSync();
          onOpenChange(false);
        }}
      />
    </>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <ChevronLeft className="h-3.5 w-3.5" /> Back
    </button>
  );
}
