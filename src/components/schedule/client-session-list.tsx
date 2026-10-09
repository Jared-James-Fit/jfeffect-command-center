import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, CircleOff, Clock, MapPin, Phone, Video, ChevronDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RescheduleDialog } from "@/components/appointments/reschedule-dialog";
import { listMyPortalAppointments } from "@/lib/appointments.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { requestSessionChange, withdrawSessionChange } from "@/lib/schedule.functions";
import { sendMessage } from "@/lib/messages";
import { useAuth } from "@/lib/auth";
import { fmtWallClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

type Session = {
  id: string;
  title: string | null;
  session_type: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  location: string | null;
  notes: string | null;
  client_visible_notes: boolean | null;
  meet_link?: string | null;
};

/** Video and phone sessions have no address to map. */
function isPlace(location: string): boolean {
  return !/^(video call|phone call)/i.test(location.trim());
}

type Pending = { id: string; pt_session_id: string; kind: "move" | "cancel" };

function dayLabel(dateISO: string) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
}
function relativeDay(dateISO: string): string | null {
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const tm = new Date(today.getTime() + 86400000);
  const tomorrow = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, "0")}-${String(tm.getDate()).padStart(2, "0")}`;
  if (dateISO === t) return "Today";
  if (dateISO === tomorrow) return "Tomorrow";
  return null;
}
export function sessionWhen(s: Pick<Session, "session_date" | "start_time">) {
  return `${dayLabel(s.session_date)} at ${fmtWallClock(s.start_time)}`;
}

const SHOW = 4;

/**
 * The client's booked sessions (and any calls), soonest first, each with one
 * clear way to ask for a change. Nothing to work out: when, where, and a button.
 */
export function ClientSessionList({ clientId }: { clientId: string }) {
  const [showAll, setShowAll] = useState(false);
  const [changing, setChanging] = useState<Session | null>(null);
  const [reFor, setReFor] = useState<any>(null);
  const qc = useQueryClient();
  const povKey = usePovArgs().viewAsClientId ?? null;
  const apptFn = usePovFn(useServerFn(listMyPortalAppointments));
  const withdraw = useServerFn(withdrawSessionChange);
  const isPov = !!povKey;

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ["my-upcoming-sessions", clientId],
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("id,title,session_type,session_date,start_time,end_time,starts_at,location,notes,client_visible_notes,meet_link")
        .eq("client_id", clientId)
        .eq("status", "Scheduled")
        .eq("visible_to_client", true)
        .gte("starts_at", since)
        .order("starts_at", { ascending: true })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as Session[];
    },
  });
  const { data: pending = [] } = useQuery<Pending[]>({
    queryKey: ["my-session-requests", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pt_session_change_requests")
        .select("id, pt_session_id, kind")
        .eq("client_id", clientId)
        .eq("status", "pending");
      return (data ?? []) as Pending[];
    },
  });
  const { data: appts } = useQuery({
    queryKey: ["portal-appointments", povKey],
    queryFn: () => apptFn(),
  });

  // Live: when the coach moves or answers, the client sees it without a refresh.
  const channelId = useId();
  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["my-upcoming-sessions", clientId] });
      qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] });
    };
    const ch = supabase
      .channel(`client-schedule-${clientId}-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_sessions", filter: `client_id=eq.${clientId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_session_change_requests", filter: `client_id=eq.${clientId}` }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [clientId, qc, channelId]);

  const pendingBySession = new Map(pending.map((p) => [p.pt_session_id, p]));
  const calls = ((appts as any)?.upcoming ?? []) as any[];
  const visible = showAll ? sessions : sessions.slice(0, SHOW);

  const onWithdraw = async (p: Pending) => {
    try {
      await withdraw({ data: { requestId: p.id } });
      qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] });
      toast.success("Request withdrawn. Your session stays as booked.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't withdraw");
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Your sessions</h2>
        {sessions.length > 0 && <span className="text-xs text-muted-foreground">{sessions.length} booked</span>}
      </div>

      {isLoading ? (
        <Card className="p-5 text-sm text-muted-foreground">Loading…</Card>
      ) : sessions.length === 0 && calls.length === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">No sessions booked right now.</Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => {
            const p = pendingBySession.get(s.id);
            const rel = relativeDay(s.session_date);
            return (
              <li key={s.id}>
                <Card className={cn("space-y-3 p-4", rel && "border-primary/40")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-bold leading-tight">
                        {rel ? `${rel} · ` : ""}{dayLabel(s.session_date)}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-foreground/90">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {fmtWallClock(s.start_time)} – {fmtWallClock(s.end_time)}
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground">{s.title || s.session_type || "Session"}</div>
                    </div>
                  </div>
                  {s.meet_link && (
                    <Button asChild className="h-11 w-full bg-gradient-primary font-bold">
                      <a href={s.meet_link} target="_blank" rel="noreferrer"><Video className="mr-2 h-4 w-4" /> Join video call</a>
                    </Button>
                  )}
                  {s.location && !isPlace(s.location) && !s.meet_link && (
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {/^phone/i.test(s.location) ? <Phone className="h-3.5 w-3.5 shrink-0" /> : <Video className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{s.location}</span>
                    </div>
                  )}
                  {s.location && isPlace(s.location) && (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(s.location)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate underline-offset-2 hover:underline">{s.location}</span>
                    </a>
                  )}
                  {s.client_visible_notes && s.notes && <p className="text-xs text-foreground/80">{s.notes}</p>}
                  {p ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                      <span className="text-xs font-semibold text-amber-200">
                        {p.kind === "move" ? "Move requested" : "Cancel requested"} · waiting on your coach
                      </span>
                      {!isPov && (
                        <button type="button" className="text-xs font-semibold text-muted-foreground underline" onClick={() => onWithdraw(p)}>
                          Withdraw
                        </button>
                      )}
                    </div>
                  ) : (
                    <Button variant="outline" className="h-11 w-full" onClick={() => setChanging(s)}>
                      <CalendarClock className="mr-2 h-4 w-4" /> Need to change it?
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
          {calls.map((a) => (
            <li key={`appt:${a.id}`}>
              <Card className="space-y-3 p-4">
                <div>
                  <div className="text-base font-bold leading-tight">
                    {new Date(a.starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                  <div className="mt-1 text-sm">
                    {new Date(a.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {a.title || a.appointment_type}
                  </div>
                  <div className="text-xs text-muted-foreground">with {a.host_coach?.full_name ?? "your coach"}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {a.meet_link ? (
                    <Button asChild className="h-11 bg-gradient-primary">
                      <a href={a.meet_link} target="_blank" rel="noreferrer"><Video className="mr-2 h-4 w-4" /> Join</a>
                    </Button>
                  ) : <span />}
                  {a.status === "Scheduled" && (
                    <Button variant="outline" className="h-11" onClick={() => setReFor(a)}>
                      <CalendarClock className="mr-2 h-4 w-4" /> Reschedule
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {sessions.length > SHOW && (
        <Button variant="ghost" className="w-full text-xs" onClick={() => setShowAll((v) => !v)}>
          <ChevronDown className={cn("mr-1 h-4 w-4 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Show fewer" : `Show all ${sessions.length}`}
        </Button>
      )}

      <RequestChangeSheet clientId={clientId} session={changing} onClose={() => setChanging(null)} isPov={isPov} />
      <RescheduleDialog
        open={!!reFor}
        onOpenChange={(b) => { if (!b) setReFor(null); }}
        appointment={reFor}
        onChanged={() => qc.invalidateQueries({ queryKey: ["portal-appointments"] })}
      />
    </section>
  );
}

export function RequestChangeSheet({
  clientId,
  session,
  onClose,
  isPov,
}: {
  clientId: string;
  session: Session | null;
  onClose: () => void;
  isPov: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const request = useServerFn(requestSessionChange);
  const [kind, setKind] = useState<"move" | "cancel" | null>(null);
  const [times, setTimes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setKind(null);
    setTimes("");
    setNote("");
    onClose();
  };

  const submit = async () => {
    if (!session || !kind || !user) return;
    setBusy(true);
    try {
      const res = await request({
        data: { sessionId: session.id, kind, preferredTimes: times.trim() || undefined, note: note.trim() || undefined },
      });
      if (!res.alreadyPending) {
        const what = `my ${session.title || "session"} on ${sessionWhen(session)}`;
        const body =
          kind === "move"
            ? `Can we move ${what}?${times.trim() ? ` Better times for me: ${times.trim()}.` : ""}${note.trim() ? ` ${note.trim()}` : ""}`
            : `I can't make ${what}. Can we cancel it?${note.trim() ? ` ${note.trim()}` : ""}`;
        try {
          await sendMessage({ clientId, senderId: user.id, senderRole: "client", body, messageType: "Scheduling" });
        } catch {
          /* the request itself is saved and shows on the coach's calendar */
        }
      }
      qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] });
      toast.success(res.alreadyPending ? "You already asked about this one. Your coach has it." : "Sent to your coach. You'll get a message when it's sorted.");
      close();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send. Try again or message your coach.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!session} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {session && (
          <div className="mx-auto w-full max-w-lg space-y-4">
            <SheetHeader className="text-left">
              <SheetTitle className="text-left">Change this session?</SheetTitle>
              <SheetDescription className="text-left">
                {session.title || "Session"} · {sessionWhen(session)}
              </SheetDescription>
            </SheetHeader>

            {isPov && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Preview only. Clients send requests from here; you'll see them at the top of your calendar.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("move")}
                className={cn(
                  "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-semibold",
                  kind === "move" ? "border-primary bg-primary/15 text-primary" : "border-border",
                )}
              >
                <CalendarClock className="h-5 w-5" /> Move it
              </button>
              <button
                type="button"
                onClick={() => setKind("cancel")}
                className={cn(
                  "flex h-20 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-semibold",
                  kind === "cancel" ? "border-primary bg-primary/15 text-primary" : "border-border",
                )}
              >
                <CircleOff className="h-5 w-5" /> Can't make it
              </button>
            </div>

            {kind === "move" && (
              <div className="space-y-1.5">
                <Label>When works better?</Label>
                <Textarea
                  rows={2}
                  value={times}
                  maxLength={300}
                  onChange={(e) => setTimes(e.target.value)}
                  placeholder="e.g. Wednesday after 4, or any morning next week"
                />
              </div>
            )}
            {kind && (
              <div className="space-y-1.5">
                <Label>Anything else? (optional)</Label>
                <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            {kind && (
              <>
                <Button className="h-12 w-full bg-gradient-primary font-bold" disabled={busy || isPov || (kind === "move" && !times.trim())} onClick={submit}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {kind === "move" ? "Send to my coach" : "Ask to cancel"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  Your session stays booked until your coach confirms the change.
                </p>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
