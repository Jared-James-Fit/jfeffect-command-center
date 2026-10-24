import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Clock, Dumbbell, HelpCircle, Loader2, Phone, Ruler } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listenChannel } from "@/lib/realtime-channel";
import { requestSession, withdrawSessionRequest } from "@/lib/session-requests.functions";
import {
  REQUEST_TYPES, requestStatusLabel, requestTypeLabel, requestWhen,
  type SessionRequest, type SessionRequestType,
} from "@/lib/session-requests";
import { cn } from "@/lib/utils";
import { DayChips, localISO, summaryDate, summaryTime } from "@/components/schedule/day-chips";

const TYPE_ICON: Record<SessionRequestType, React.ElementType> = { training: Dumbbell, call: Phone, assessment: Ruler, other: HelpCircle };
const LENGTHS = [30, 45, 60, 90];
/** Short enough for four across a 360px phone. */
const SHORT_TYPE: Record<SessionRequestType, string> = { training: "Training", call: "Call", assessment: "Assessment", other: "Other" };

/**
 * "Request a session": what, which day, what time, how long. One screen,
 * top to bottom, with the send button always in reach; the note and other
 * times stay folded away unless wanted. It goes to the coach's chat as a
 * request card; nothing is booked until the coach approves.
 */
export function RequestSessionSheet({ open, onOpenChange, isPov = false, initialDate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  isPov?: boolean;
  initialDate?: string | null;
}) {
  const qc = useQueryClient();
  const send = useServerFn(requestSession);
  const [type, setType] = useState<SessionRequestType>("training");
  const [date, setDate] = useState(localISO(1));
  const [time, setTime] = useState("09:00");
  const [anyTime, setAnyTime] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [alt, setAlt] = useState("");
  const [note, setNote] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("training"); setMinutes(60); setTime("09:00"); setAnyTime(false); setAlt(""); setNote(""); setMoreOpen(false);
    const today = localISO(0);
    setDate(initialDate && initialDate > today ? initialDate : localISO(1));
  }, [open, initialDate]);

  const pickType = (t: SessionRequestType) => {
    setType(t);
    setMinutes(REQUEST_TYPES.find((x) => x.value === t)?.minutes ?? 60);
    if (t === "other") setMoreOpen(true);
  };
  const needsNote = type === "other" && !note.trim();

  const submit = async () => {
    if (isPov) return;
    setBusy(true);
    try {
      await send({
        data: {
          requestType: type, date, time: anyTime ? null : time, durationMinutes: minutes,
          altTimes: alt.trim() || undefined, note: note.trim() || undefined,
        },
      });
      qc.invalidateQueries({ queryKey: ["my-session-requests"] });
      toast.success("Request sent. You'll get a message when your coach approves it.");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send. Try again or message your coach.");
    } finally {
      setBusy(false);
    }
  };

  const seg = (on: boolean) => cn(
    "flex min-h-11 items-center justify-center rounded-lg border px-2 text-sm font-semibold transition active:scale-[0.97]",
    on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
  );
  const summary = [
    requestTypeLabel(type),
    summaryDate(date),
    anyTime ? "any time" : summaryTime(time),
    `${minutes} min`,
  ].join(" · ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5">
          <div className="mx-auto w-full max-w-lg space-y-5">
            <SheetHeader className="text-left">
              <SheetTitle className="text-left">Request a session</SheetTitle>
              <SheetDescription className="text-left">Your coach confirms it before it's booked.</SheetDescription>
            </SheetHeader>

            {isPov && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Preview only. Clients send requests from here; they show up as a card in your chat with them.
              </p>
            )}

            <div className="space-y-2">
              <Label>Type</Label>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Session type">
                {REQUEST_TYPES.map((t) => {
                  const Icon = TYPE_ICON[t.value];
                  const on = type === t.value;
                  return (
                    <button key={t.value} type="button" role="radio" aria-checked={on} onClick={() => pickType(t.value)}
                      className={cn(seg(on), "flex-col gap-1 px-0.5 py-2 text-xs")}>
                      <Icon className="h-4 w-4" />
                      <span className="max-w-full truncate text-[11px] leading-tight sm:text-xs">{SHORT_TYPE[t.value]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Day</Label>
              <DayChips value={date} onChange={setDate} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="req-time">Time</Label>
              <div className="grid grid-cols-2 gap-2">
                <input id="req-time" type="time" value={time} step={900} disabled={anyTime} onChange={(e) => setTime(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px] disabled:opacity-40" />
                <button type="button" onClick={() => setAnyTime((v) => !v)} className={seg(anyTime)} aria-pressed={anyTime}>
                  <Clock className="mr-1.5 h-4 w-4" /> Any time
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Length</Label>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Length">
                {LENGTHS.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)} className={seg(minutes === m)}>
                    {m} min
                  </button>
                ))}
              </div>
            </div>

            {moreOpen ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="req-note">{type === "other" ? "What's it for?" : "Note for your coach (optional)"}</Label>
                  <textarea id="req-note" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[16px]" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-alt">Other times that work (optional)</Label>
                  <input id="req-alt" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)}
                    placeholder="e.g. Thursday after 5, or Saturday morning"
                    className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px]" />
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setMoreOpen(true)} className="text-sm font-semibold text-primary">
                + Add a note or other times
              </button>
            )}
          </div>
        </div>

        {/* Always in reach: what's being asked for, and Send. */}
        <div className="border-t border-border bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto w-full max-w-lg space-y-2">
            <p className="truncate text-center text-xs text-muted-foreground">{summary}</p>
            <Button className="h-12 w-full bg-gradient-primary font-bold" disabled={busy || isPov || !date || needsNote} onClick={submit}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send request
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The client's open (and recently answered) requests on their Schedule, plus the button
 * to make a new one.
 */
export function MySessionRequests({ clientId, isPov = false, children }: { clientId: string; isPov?: boolean; children?: React.ReactNode }) {
  const qc = useQueryClient();
  const channelId = useId();
  const withdraw = useServerFn(withdrawSessionRequest);
  const [open, setOpen] = useState(false);
  const { data: rows = [] } = useQuery<SessionRequest[]>({
    queryKey: ["my-session-requests", clientId],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await (supabase as any)
        .from("session_requests").select("*").eq("client_id", clientId)
        .or(`status.eq.pending,resolved_at.gte.${since}`)
        .order("created_at", { ascending: false }).limit(10);
      return (data ?? []) as SessionRequest[];
    },
  });
  useEffect(() => {
    const ch = listenChannel(`my-session-requests-${clientId}-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_requests", filter: `client_id=eq.${clientId}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [clientId, channelId, qc]);

  return (
    <section className="space-y-2">
      {/* The section's one action, labelled in words. */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Sessions</h2>
        <Button size="sm" className="h-9 gap-1.5 bg-gradient-primary font-bold" onClick={() => setOpen(true)}>
          <CalendarPlus className="h-4 w-4" /> Request a session
        </Button>
      </div>
      {children}

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5",
              r.status === "pending" ? "border-primary/40 bg-primary/5" : r.status === "approved" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border")}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{requestTypeLabel(r.request_type)} · {requestWhen(r)}</div>
                <div className={cn("text-xs", r.status === "approved" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                  {requestStatusLabel(r.status)}{r.status === "declined" && r.decline_reason ? ` · ${r.decline_reason}` : ""}
                </div>
              </div>
              {r.status === "pending" && !isPov && (
                <button type="button" className="shrink-0 text-xs font-semibold text-muted-foreground hover:underline"
                  onClick={async () => {
                    try { await withdraw({ data: { requestId: r.id } }); toast.success("Request withdrawn"); qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] }); }
                    catch (e: any) { toast.error(e?.message ?? "Couldn't withdraw"); }
                  }}>
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RequestSessionSheet open={open} onOpenChange={setOpen} isPov={isPov} />
    </section>
  );
}
