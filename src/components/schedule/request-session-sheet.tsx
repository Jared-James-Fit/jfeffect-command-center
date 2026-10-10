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

const TYPE_ICON: Record<SessionRequestType, React.ElementType> = { training: Dumbbell, call: Phone, assessment: Ruler, other: HelpCircle };
const LENGTHS = [30, 45, 60, 90];

function localISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Request a session": the client picks what, when and how long; it goes to their coach's
 * chat as a request card. Nothing is booked until the coach approves.
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("training"); setMinutes(60); setTime("09:00"); setAnyTime(false); setAlt(""); setNote("");
    const today = localISO(0);
    setDate(initialDate && initialDate >= today ? initialDate : localISO(1));
  }, [open, initialDate]);

  const pickType = (t: SessionRequestType) => {
    setType(t);
    setMinutes(REQUEST_TYPES.find((x) => x.value === t)?.minutes ?? 60);
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

  const chip = (on: boolean) => cn(
    "rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95",
    on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <SheetHeader className="text-left">
            <SheetTitle className="text-left">Request a session</SheetTitle>
            <SheetDescription className="text-left">
              Pick what and when. Your coach approves it before it's booked.
            </SheetDescription>
          </SheetHeader>

          {isPov && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              Preview only. Clients send requests from here; they show up as a card in your chat with them.
            </p>
          )}

          <div className="space-y-1.5">
            <Label>What for?</Label>
            <div className="grid grid-cols-2 gap-2">
              {REQUEST_TYPES.map((t) => {
                const Icon = TYPE_ICON[t.value];
                const on = type === t.value;
                return (
                  <button key={t.value} type="button" onClick={() => pickType(t.value)}
                    className={cn("flex items-center gap-2 rounded-xl border p-2.5 text-left transition active:scale-[0.98]",
                      on ? "border-primary bg-primary/10" : "border-border")}>
                    <Icon className={cn("h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                    <span className="min-w-0">
                      <span className={cn("block truncate text-sm font-semibold", on && "text-primary")}>{t.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="req-date">Day</Label>
              <input id="req-date" type="date" value={date} min={localISO(0)} onChange={(e) => setDate(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px]" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-time">Time</Label>
              <input id="req-time" type="time" value={time} step={900} disabled={anyTime} onChange={(e) => setTime(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px] disabled:opacity-40" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setAnyTime((v) => !v)} className={chip(anyTime)}>
              <Clock className="mr-1 inline h-3 w-3" /> Any time that day
            </button>
            {LENGTHS.map((m) => (
              <button key={m} type="button" onClick={() => setMinutes(m)} className={chip(minutes === m)}>{m} min</button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-alt">Other times that work (optional)</Label>
            <input id="req-alt" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)}
              placeholder="e.g. Thursday after 5, or Saturday morning"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-note">{type === "other" ? "What's it for?" : "Anything your coach should know? (optional)"}</Label>
            <textarea id="req-note" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[16px]" />
          </div>

          <Button className="h-12 w-full bg-gradient-primary font-bold" disabled={busy || isPov || !date || needsNote} onClick={submit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send request
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Not booked yet — you'll get a message as soon as your coach approves it.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The client's open (and recently answered) requests on their Schedule, plus the button
 * to make a new one.
 */
export function MySessionRequests({ clientId, isPov = false }: { clientId: string; isPov?: boolean }) {
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
      <Card className="flex items-center gap-3 p-3.5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <CalendarPlus className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Request a session</div>
          <div className="text-xs text-muted-foreground">Training, a call or an assessment. Your coach approves it.</div>
        </div>
        <Button size="sm" className="shrink-0 bg-gradient-primary font-bold" onClick={() => setOpen(true)}>Request</Button>
      </Card>

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
