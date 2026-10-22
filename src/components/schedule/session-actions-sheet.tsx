import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban, CalendarClock, CheckCircle2, ChevronRight, Clock, Dumbbell, MapPin, MessageSquare, Pencil, PiggyBank, ChevronLeft, Loader2, StickyNote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { setPtSessionStatus } from "@/lib/pt-pack.functions";
import { invalidatePtSessionCaches } from "@/lib/pt-session-manage";
import { statusTone } from "@/lib/pt-sessions";
import { sendMessage } from "@/lib/messages";
import { useAuth } from "@/lib/auth";
import { kickScheduleSync, textClientSessionChange } from "@/lib/schedule.functions";
import { isLastMinute } from "@/lib/pt-session-reminders";
import { addMinutesHM, fmtWallClock, minutesBetweenHM, wallTimeToUtc, DEFAULT_TZ } from "@/lib/schedule-time";
import { ConflictNotice, useConflictCheck } from "@/components/schedule/use-conflict-check";
import { useEnterClientPov } from "@/components/clients/use-enter-client-pov";
import { COACH_NOTE_MAX, creditChipClasses, moveOutcome, sessionCredit, sessionStatusLabel, shortDay, statusForDate } from "@/lib/session-credit";
import { todayLocalISO } from "@/lib/today";
import { COACH_NOTES_KEY, saveCoachNote, useCoachNote } from "@/lib/session-coach-notes";
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

type Mode = "menu" | "move" | "confirm" | "decline";

/** What the coach picked for the session's credit (Reschedule is the move form). */
type Outcome = "done" | "bank" | "use";

const DURATIONS = [30, 45, 60, 90];

export function dayLabel(dateISO: string): string {
  return shortDay(dateISO);
}

export function whenLabel(dateISO: string, startHM: string): string {
  return `${dayLabel(dateISO)} at ${fmtWallClock(startHM)}`;
}

/** Fire-and-forget: push this change to Google now instead of on the next 5-minute tick. */
export function kickGoogleSync() {
  void kickScheduleSync().catch(() => {});
}

const OUTCOME_STATUS: Record<Outcome, "Completed" | "Cancelled" | "Missed"> = { done: "Completed", bank: "Cancelled", use: "Missed" };

/**
 * The coach's one place to act on a session. Booked sessions count as used by
 * themselves once their day is over (pt_sessions_auto_complete), so what's
 * left here is the exceptions, each saying what it does to the credit:
 * Reschedule (the credit moves with it), Cancel · bank the credit, Late cancel
 * or no-show · use the credit, and for a done one "Didn't happen". Every
 * change can be undone from its toast, and an upcoming one can tell the client
 * (by text too when it's within 48 hours).
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
  initialMode?: "menu" | "move";
  onEdit?: (s: ActionSession) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [outcome, setOutcome] = useState<Outcome>("bank");
  const [busy, setBusy] = useState(false);

  // Move form
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(60);
  const [override, setOverride] = useState(false);
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState("");
  // The coach's own note on the session (only staff see it): the "why" behind a cancel, move or miss.
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

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
    setEditingNote(false);
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
  const { data: coachNote = null } = useCoachNote(session?.id, open);
  useEffect(() => {
    if (open) setNoteDraft(coachNote ?? "");
  }, [open, coachNote]);
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
  const today = todayLocalISO();
  const end = start ? addMinutesHM(start, duration) : "";
  const changedTime = !!session && (date !== session.session_date || start !== session.start_time.slice(0, 5) || end !== session.end_time.slice(0, 5));
  const conflictCheck = useConflictCheck({
    slots: date && start ? [{ key: "move", date, start, end }] : [],
    timezone: tz,
    excludeSessionIds: session ? [session.id] : [],
    enabled: open && mode === "move" && (changedTime || session?.status !== "Scheduled") && !!date && date >= today,
  });
  const blocked = conflictCheck.conflicts.length > 0 && !override;

  const pov = useEnterClientPov();
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

  /** Saves the note when it changed; a failed save never blocks the session change itself. */
  const persistNote = async (): Promise<boolean> => {
    if (noteDraft.trim() === (coachNote ?? "").trim()) return true;
    try {
      await saveCoachNote(session.id, noteDraft);
      qc.invalidateQueries({ queryKey: [COACH_NOTES_KEY] });
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the note");
      return false;
    }
  };

  const saveNoteOnly = async () => {
    setSavingNote(true);
    const ok = await persistNote();
    setSavingNote(false);
    if (ok) {
      setEditingNote(false);
      toast.success(noteDraft.trim() ? "Note saved" : "Note removed");
    }
  };
  const when = whenLabel(session.session_date, session.start_time);
  const usesCredit = session.uses_credit !== false;
  const credit = sessionCredit(session, today);
  const upcoming = session.session_date >= today;
  const dayOver = !upcoming;
  const isBooked = session.status === "Scheduled";
  const isUsed = session.status === "Completed" || session.status === "Missed";
  // Rebooking a cancelled / missed one may keep its old time; moving a booked or done one needs a new one.
  const rebooking = !isBooked && session.status !== "Completed";
  const canMove = !!date && !!start && (changedTime || rebooking);
  const target = date ? statusForDate(date, today) : "Scheduled";

  const refresh = () => {
    invalidatePtSessionCaches(qc, session.client_id);
    qc.invalidateQueries({ queryKey: ["schedule-change-requests"] });
    qc.invalidateQueries({ queryKey: ["session-change-request", session.id] });
    qc.invalidateQueries({ queryKey: ["cal-admin-pt"] });
    qc.invalidateQueries({ queryKey: ["cal-client-pt"] });
    kickGoogleSync();
  };

  /** Toast with Undo that puts the session back exactly as it was (the credit follows). */
  const doneWithUndo = (msg: string, description?: string) => {
    const before = {
      status: session.status,
      session_date: session.session_date,
      start_time: session.start_time.slice(0, 5),
      end_time: session.end_time.slice(0, 5),
    };
    refresh();
    toast.success(msg, {
      description,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error } = await supabase.from("pt_sessions").update(before).eq("id", session.id);
          if (error) return toast.error(error.message || "Undo failed");
          refresh();
          toast.success("Undone · back as it was");
        },
      },
    });
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
    if (!canMove) return;
    if (end <= start) return toast.error("Pick an earlier start so the session ends the same day.");
    setBusy(true);
    try {
      const { error } = await supabase
        .from("pt_sessions")
        .update({ session_date: date, start_time: start, end_time: end, status: target })
        .eq("id", session.id);
      if (error) throw error;
      await persistNote();
      let texted = false;
      // Only an upcoming time is news to the client.
      if (notify && target === "Scheduled") {
        await tellClient(
          rebooking
            ? `You're booked: ${title} on ${whenLabel(date, start)}.`
            : `Your ${title} on ${when} moved to ${whenLabel(date, start)}.`,
        );
        texted = await textIfUrgent("moved", oldStart?.toISOString());
      }
      doneWithUndo(
        `${rebooking ? "Booked" : "Moved to"} ${whenLabel(date, start)}${texted ? ` · ${first} was texted` : ""}`,
        moveOutcome(date, today, usesCredit),
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't move the session");
    } finally {
      setBusy(false);
    }
  };

  const OUTCOME_COPY: Record<Outcome, { toast: string; message: string }> = {
    done: { toast: usesCredit ? "Done · 1 credit used" : "Marked done", message: "" },
    bank: {
      toast: usesCredit ? "Cancelled · credit banked" : "Cancelled",
      message: `Your ${title} on ${when} is cancelled.${usesCredit ? " The session stays on your account to book another time." : ""}`,
    },
    use: {
      toast: usesCredit ? "Counted · 1 credit used" : "Marked missed",
      message: `Your ${title} on ${when} is cancelled.${usesCredit ? " It counts as a used session." : ""}`,
    },
  };

  const apply = async (o: Outcome) => {
    setBusy(true);
    try {
      await setPtSessionStatus({ data: { sessionId: session.id, status: OUTCOME_STATUS[o] } });
      await persistNote();
      let texted = false;
      if (o !== "done" && upcoming && notify) {
        await tellClient(OUTCOME_COPY[o].message);
        texted = await textIfUrgent("cancelled");
      }
      doneWithUndo(`${OUTCOME_COPY[o].toast}${texted ? ` · ${first} was texted` : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  };

  /** Upcoming: confirm (and tell the client). Its day is over: just do it, with Undo. */
  const pick = (o: Outcome) => {
    if (upcoming && o !== "done") {
      setOutcome(o);
      setMode("confirm");
    } else {
      void apply(o);
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
      refresh();
      toast.success("Request declined · client told");
      onOpenChange(false);
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

  // The choices, in the order the coach needs them for this session.
  const credits = (text: string, fallback: string) => (usesCredit ? text : fallback);
  const choices: ChoiceProps[] = [];
  if (isBooked && dayOver) {
    choices.push({
      icon: <CheckCircle2 className="h-5 w-5 text-success" />, title: "It happened",
      hint: credits("Done · uses 1 credit.", "Marks it done."), onClick: () => pick("done"),
    });
  }
  choices.push({
    icon: <CalendarClock className="h-5 w-5 text-primary" />,
    title: rebooking ? "Book it again" : "Reschedule",
    hint: rebooking
      ? credits("Pick a day and time. It holds a credit again.", "Pick a day and time.")
      : isUsed
        ? credits("Didn't happen that day? Move it: the credit moves with it.", "Move it to the right day.")
        : credits("New day or time. The credit stays with it.", "New day or time."),
    onClick: () => setMode("move"),
  });
  if (session.status !== "Cancelled" && session.status !== "Rescheduled") {
    choices.push({
      icon: <PiggyBank className="h-5 w-5 text-sky-300" />,
      title: session.status === "Completed"
        ? "Didn't happen · bank the credit"
        : session.status === "Missed" ? "Don't count it · bank the credit" : "Cancel · bank the credit",
      hint: credits(`The credit goes back to ${first} to book another time.`, "Cancels it."),
      onClick: () => pick("bank"),
    });
  }
  if (session.status !== "Missed") {
    choices.push({
      icon: <Ban className="h-5 w-5 text-warning" />,
      title: session.status === "Completed"
        ? "Mark as a no-show"
        : isBooked ? credits("Late cancel or no-show · use the credit", "Late cancel or no-show") : credits("Count it after all · use the credit", "Mark it missed"),
      hint: session.status === "Completed"
        ? credits("Keeps the credit used, and shows it was missed.", "Shows it was missed.")
        : credits(`Counts as one of ${first}'s sessions.`, "Shows it was missed."),
      onClick: () => pick("use"),
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <SheetHeader className="space-y-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={statusTone(session.status)}>{sessionStatusLabel(session.status)}</Badge>
              {usesCredit && <Badge variant="outline" className={creditChipClasses(credit.state)}>{credit.label}</Badge>}
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
            {usesCredit && mode === "menu" && <p className="text-xs text-muted-foreground">{credit.detail}</p>}
          </SheetHeader>

          {mode === "menu" && (
            editingNote ? (
              <div className="space-y-2">
                <NoteField value={noteDraft} onChange={setNoteDraft} label="Note" autoFocus />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" className="h-10" onClick={() => { setNoteDraft(coachNote ?? ""); setEditingNote(false); }}>Cancel</Button>
                  <Button className="h-10" disabled={savingNote} onClick={saveNoteOnly}>
                    {savingNote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save note
                  </Button>
                </div>
              </div>
            ) : coachNote ? (
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                className="flex w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left"
              >
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{coachNote}</span>
                <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">Edit</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <StickyNote className="h-3.5 w-3.5" /> Add a note · only you see it
              </button>
            )
          )}

          {request && mode === "menu" && (
            <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold text-amber-200">
                {first} {request.kind === "move" ? "asked to move this session" : "can't make this session"}
              </div>
              {request.preferred_times && (
                <p className="text-sm"><span className="text-muted-foreground">Better times:</span> {request.preferred_times}</p>
              )}
              {request.note && <p className="text-sm"><span className="text-muted-foreground">Note:</span> {request.note}</p>}
              <p className="text-[11px] text-muted-foreground">It stays booked (and isn't counted by itself) until you answer.</p>
              {request.kind === "move" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-11 bg-gradient-primary font-bold" onClick={() => setMode("move")}>
                    <CalendarClock className="mr-2 h-4 w-4" /> Pick new time
                  </Button>
                  <Button variant="outline" className="h-11" onClick={() => setMode("decline")}>Decline</Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="h-11 bg-gradient-primary font-bold" onClick={() => pick("bank")}>
                    <PiggyBank className="mr-2 h-4 w-4" /> Bank it
                  </Button>
                  <Button variant="outline" className="h-11" onClick={() => pick("use")}>
                    <Ban className="mr-2 h-4 w-4" /> Count it
                  </Button>
                  <Button variant="ghost" className="col-span-2 h-10" onClick={() => setMode("decline")}>Decline · keep it booked</Button>
                </div>
              )}
            </div>
          )}

          {mode === "menu" && (
            <div className="space-y-2">
              {/* Mid-session: straight into the client's workout for that day, as they see it. */}
              {pov.canPov && (
                <Button
                  className="h-12 w-full bg-gradient-primary font-bold"
                  disabled={pov.busy}
                  onClick={() => pov.enter(session.client_id, { to: `/portal/workouts?open=${session.session_date}`, fallbackName: name })}
                >
                  {pov.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Dumbbell className="mr-2 h-4 w-4" />}
                  Open {first}'s workout
                </Button>
              )}
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {choices.map((c) => <Choice key={c.title} {...c} disabled={busy} />)}
              </div>
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
                  <Label>{rebooking ? "Date" : "New date"}</Label>
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
              {canMove && target === "Scheduled" && (
                <ConflictNotice check={conflictCheck} override={override} onOverride={setOverride} overrideLabel="Book anyway" />
              )}
              {canMove && target === "Scheduled" && notifyRow}
              {canMove && <NoteField value={noteDraft} onChange={setNoteDraft} label="Why (optional)" placeholder="e.g. moved to Sunday, I volunteered Tuesday" />}
              {canMove && <p className="text-xs text-muted-foreground">{moveOutcome(date, today, usesCredit)}</p>}
              <Button
                className="h-12 w-full bg-gradient-primary font-bold"
                disabled={busy || !canMove || (target === "Scheduled" && (blocked || conflictCheck.checking))}
                onClick={doMove}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {canMove ? `${rebooking ? "Book" : "Move to"} ${whenLabel(date, start)}` : "Pick a new date or time"}
              </Button>
            </div>
          )}

          {mode === "confirm" && (
            <div className="space-y-3">
              <BackButton onClick={() => setMode("menu")} />
              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <p className="text-sm font-semibold">
                  {outcome === "bank" ? `Cancel ${first}'s session on ${when}?` : `Count ${first}'s session on ${when} as a late cancel?`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {outcome === "bank"
                    ? credits(`The credit goes back to ${first}, ready to book another time.`, "It comes off the calendar.")
                    : credits(`It counts as one of ${first}'s sessions (1 credit used).`, "It's marked missed.")}
                </p>
              </div>
              <NoteField value={noteDraft} onChange={setNoteDraft} label="Why (optional)" placeholder={outcome === "bank" ? "e.g. sick kid, my competition" : "e.g. cancelled with 30 minutes notice"} />
              {notifyRow}
              <Button
                className="h-12 w-full"
                variant={outcome === "bank" ? "default" : "destructive"}
                disabled={busy}
                onClick={() => apply(outcome)}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {outcome === "bank" ? credits("Cancel · bank the credit", "Cancel it") : credits("Late cancel · use the credit", "Mark it missed")}
              </Button>
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
  );
}

/** The coach's note on a session: saved with the change, never shown to the client. */
function NoteField({ value, onChange, label, placeholder, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-normal text-muted-foreground">Only you see it</span>
      </Label>
      <Textarea
        rows={2}
        value={value}
        maxLength={COACH_NOTE_MAX}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[64px] text-base sm:text-sm"
      />
    </div>
  );
}

type ChoiceProps = { icon: ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean };

function Choice({ icon, title, hint, onClick, disabled }: ChoiceProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3 bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary/40 disabled:opacity-50"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <ChevronLeft className="h-3.5 w-3.5" /> Back
    </button>
  );
}
