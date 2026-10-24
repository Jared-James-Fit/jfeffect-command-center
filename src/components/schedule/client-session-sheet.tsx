import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock, CalendarDays, ChevronLeft, CircleOff, Clock, Loader2, MapPin, MessageCircle, Phone, StickyNote, Video,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DayChips, summaryDate, summaryTime } from "@/components/schedule/day-chips";
import { requestSessionChange, withdrawSessionChange } from "@/lib/schedule.functions";
import { sendMessage } from "@/lib/messages";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { addMinutesHM, DEFAULT_TZ, fmtWallClock, minutesBetweenHM, wallTimeToUtc } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

/** A booked session as the client sees it (any of the client calendar's session rows). */
export type ClientSession = {
  id: string;
  title: string | null;
  session_type?: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  starts_at?: string | null;
  timezone?: string | null;
  location?: string | null;
  notes?: string | null;
  client_visible_notes?: boolean | null;
  meet_link?: string | null;
  status?: string | null;
};

/** A client's open request to move or cancel one of their sessions. */
export type MyChangeRequest = {
  id: string;
  pt_session_id: string;
  kind: "move" | "cancel";
  proposed_date: string | null;
  proposed_start: string | null;
  preferred_times: string | null;
  note: string | null;
};

/** The client's open change requests (one per session at most). Same key everywhere, so one fetch serves every screen. */
export function useMySessionRequests(clientId: string | null | undefined) {
  return useQuery<MyChangeRequest[]>({
    queryKey: ["my-session-requests", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pt_session_change_requests")
        .select("id, pt_session_id, kind, proposed_date, proposed_start, preferred_times, note")
        .eq("client_id", clientId)
        .eq("status", "pending");
      return (data ?? []) as MyChangeRequest[];
    },
  });
}

/** "Fri, Oct 31 at 6 PM". */
export function proposedLabel(r: Pick<MyChangeRequest, "proposed_date" | "proposed_start">): string | null {
  return r.proposed_date && r.proposed_start ? `${summaryDate(r.proposed_date)} at ${summaryTime(r.proposed_start.slice(0, 5))}` : null;
}

/** One tap answers "why": the usual reasons, plus words of their own. */
const REASONS = ["Work", "Feeling sick", "Injury", "Travel", "Family", "Something came up"];

type Mode = "view" | "move" | "cancel";

/** Video and phone sessions have no address to map. */
function isPlace(location: string): boolean {
  return !/^(video call|phone call)/i.test(location.trim());
}

/**
 * Tap a session anywhere in the client's app (Home's calendar card, the
 * Calendar page, Workouts, the Booked list) and this opens: when, how long,
 * where, the video link and the coach's note, then Change time (a new day
 * and time, other times that work, and why) or Can't make it. The request
 * goes to the coach with the exact time asked for, so they can approve it in
 * one tap; the session stays booked until they answer, and an open request
 * shows here with Withdraw.
 */
export function ClientSessionSheet({
  clientId,
  session,
  initialMode = "view",
  onClose,
}: {
  clientId: string;
  session: ClientSession | null;
  initialMode?: Mode;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isImpersonating: isPov } = useClientImpersonation();
  const request = useServerFn(requestSessionChange);
  const withdraw = useServerFn(withdrawSessionChange);
  const { data: requests = [] } = useMySessionRequests(session ? clientId : null);
  const pending = session ? requests.find((r) => r.pt_session_id === session.id) ?? null : null;

  const [mode, setMode] = useState<Mode>(initialMode);
  const [newDate, setNewDate] = useState("");
  const [newStart, setNewStart] = useState("");
  const [others, setOthers] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    setMode(initialMode);
    setNewDate(session.session_date);
    setNewStart(session.start_time.slice(0, 5));
    setOthers("");
    setReasons([]);
    setWhy("");
  }, [session?.id, initialMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const tz = session?.timezone || DEFAULT_TZ;
  const startsAt = useMemo(() => {
    if (!session) return null;
    return session.starts_at ? new Date(session.starts_at) : wallTimeToUtc(session.session_date, session.start_time.slice(0, 5), tz);
  }, [session?.id, session?.starts_at, session?.session_date, session?.start_time, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;

  const title = session.title || session.session_type || "Session";
  const length = Math.max(0, minutesBetweenHM(session.start_time.slice(0, 5), session.end_time.slice(0, 5)));
  const when = `${summaryDate(session.session_date)} at ${summaryTime(session.start_time.slice(0, 5))}`;
  const status = session.status ?? "Scheduled";
  const upcoming = !!startsAt && startsAt.getTime() > Date.now();
  const changeable = status === "Scheduled" && upcoming;

  const newEnd = newStart && length ? addMinutesHM(newStart, length) : "";
  const sameTime = newDate === session.session_date && newStart === session.start_time.slice(0, 5);
  const newAt = newDate && newStart ? wallTimeToUtc(newDate, newStart, tz) : null;
  const inPast = !!newAt && newAt.getTime() <= Date.now();
  const crossesMidnight = !!newEnd && newEnd <= newStart;
  const reasonText = [reasons.join(", "), why.trim()].filter(Boolean).join(" · ");

  const close = () => {
    setMode(initialMode);
    onClose();
  };

  const toggleReason = (r: string) => setReasons((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));

  const submit = async (kind: "move" | "cancel") => {
    if (!user || isPov) return;
    setBusy(true);
    try {
      const res = await request({
        data: {
          sessionId: session.id,
          kind,
          proposedDate: kind === "move" ? newDate : undefined,
          proposedStart: kind === "move" ? newStart : undefined,
          preferredTimes: kind === "move" && others.trim() ? others.trim() : undefined,
          note: reasonText || undefined,
        },
      });
      if (!res.alreadyPending) {
        // The coach's chat gets it in words too; the request itself is on their calendar with Approve.
        const body = kind === "move"
          ? `Can I move my ${title} on ${when} to ${summaryDate(newDate)} at ${summaryTime(newStart)}?`
            + (others.trim() ? ` Other times that work: ${others.trim()}.` : "")
            + (reasonText ? ` Reason: ${reasonText}` : "")
          : `I can't make my ${title} on ${when}.${reasonText ? ` Reason: ${reasonText}` : ""}`;
        try {
          await sendMessage({ clientId, senderId: user.id, senderRole: "client", body, messageType: "Scheduling" });
        } catch {
          /* the request is saved and waiting on the coach's calendar */
        }
      }
      await qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] });
      toast.success(res.alreadyPending ? "You already asked about this one. Your coach has it." : "Sent to your coach. It stays booked until they answer.");
      setMode("view");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send. Try again or message your coach.");
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async () => {
    if (!pending || isPov) return;
    setBusy(true);
    try {
      await withdraw({ data: { requestId: pending.id } });
      await qc.invalidateQueries({ queryKey: ["my-session-requests", clientId] });
      toast.success("Request withdrawn. Your session stays as booked.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't withdraw");
    } finally {
      setBusy(false);
    }
  };

  const footer = mode === "move" ? (
    <>
      <p className="mb-2 text-center text-xs text-muted-foreground">
        {!newDate || !newStart || sameTime ? "Pick a new day or time." : inPast ? "Pick a time that hasn't passed yet." : (
          <>Move to <span className="font-semibold text-foreground">{summaryDate(newDate)} · {summaryTime(newStart)}{newEnd ? `–${summaryTime(newEnd)}` : ""}</span></>
        )}
      </p>
      <Button className="h-12 w-full bg-gradient-primary font-bold" disabled={busy || isPov || sameTime || inPast || crossesMidnight || !newDate || !newStart} onClick={() => submit("move")}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send to my coach
      </Button>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">It stays booked for {when} until your coach approves.</p>
    </>
  ) : mode === "cancel" ? (
    <>
      <Button className="h-12 w-full" variant="destructive" disabled={busy || isPov} onClick={() => submit("cancel")}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Ask to cancel
      </Button>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">It stays booked until your coach confirms.</p>
    </>
  ) : null;

  return (
    <Sheet open={!!session} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="bottom" className="flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5">
          <div className="mx-auto w-full max-w-lg space-y-4">
            {mode !== "view" && (
              <button type="button" onClick={() => setMode("view")} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}

            <SheetHeader className="space-y-1 text-left">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-violet-400">
                <CalendarDays className="h-3.5 w-3.5" /> {mode === "move" ? "Change time" : mode === "cancel" ? "Can't make it?" : "Session with your coach"}
              </div>
              <SheetTitle className="text-left text-xl font-black leading-tight">{title}</SheetTitle>
              <SheetDescription className="text-left">
                {mode === "view" ? (
                  status !== "Scheduled" ? <Badge variant="outline" className="text-[10px]">{status === "Completed" ? "Done" : status}</Badge> : null
                ) : (
                  <>Booked for {when}</>
                )}
              </SheetDescription>
            </SheetHeader>

            {isPov && mode !== "view" && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Preview only. Clients send this from here; it shows up on your calendar with Approve.
              </p>
            )}

            {mode === "view" && (
              <>
                <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-3.5">
                  <InfoRow icon={<CalendarDays className="h-4 w-4" />}>
                    <div className="font-semibold">{new Date(`${session.session_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
                    <div className="text-sm text-muted-foreground">
                      {fmtWallClock(session.start_time)} – {fmtWallClock(session.end_time)}{length ? ` · ${length} min` : ""}
                    </div>
                  </InfoRow>
                  {session.location && (isPlace(session.location) ? (
                    <InfoRow icon={<MapPin className="h-4 w-4" />}>
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(session.location)}`} target="_blank" rel="noreferrer" className="block text-sm underline-offset-2 hover:underline">
                        {session.location}
                      </a>
                      <div className="text-xs text-muted-foreground">Tap for directions</div>
                    </InfoRow>
                  ) : (
                    <InfoRow icon={/^phone/i.test(session.location) ? <Phone className="h-4 w-4" /> : <Video className="h-4 w-4" />}>
                      <div className="text-sm">{session.location}</div>
                    </InfoRow>
                  ))}
                  {session.client_visible_notes && session.notes && (
                    <InfoRow icon={<StickyNote className="h-4 w-4" />}>
                      <div className="text-xs text-muted-foreground">From your coach</div>
                      <div className="whitespace-pre-wrap text-sm">{session.notes}</div>
                    </InfoRow>
                  )}
                </div>

                {session.meet_link && upcoming && (
                  <Button asChild className="h-11 w-full bg-gradient-primary font-bold">
                    <a href={session.meet_link} target="_blank" rel="noreferrer"><Video className="mr-2 h-4 w-4" /> Join video call</a>
                  </Button>
                )}

                {pending ? (
                  <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5">
                    <div className="text-sm font-semibold text-amber-200">
                      {pending.kind === "move"
                        ? proposedLabel(pending) ? `You asked to move it to ${proposedLabel(pending)}` : "You asked to move it"
                        : "You asked to cancel it"}
                    </div>
                    {pending.preferred_times && <p className="text-xs"><span className="text-muted-foreground">Other times:</span> {pending.preferred_times}</p>}
                    {pending.note && <p className="text-xs"><span className="text-muted-foreground">Why:</span> {pending.note}</p>}
                    <p className="text-[11px] text-muted-foreground">Waiting on your coach. It stays booked for {when} until they answer.</p>
                    {!isPov && (
                      <Button variant="ghost" size="sm" className="h-9 px-0 text-xs font-semibold text-muted-foreground" disabled={busy} onClick={onWithdraw}>
                        Withdraw request
                      </Button>
                    )}
                  </div>
                ) : changeable ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button className="h-12 font-bold" variant="outline" onClick={() => setMode("move")}>
                      <CalendarClock className="mr-2 h-4 w-4 text-primary" /> Change time
                    </Button>
                    <Button className="h-12" variant="outline" onClick={() => setMode("cancel")}>
                      <CircleOff className="mr-2 h-4 w-4 text-muted-foreground" /> Can't make it
                    </Button>
                  </div>
                ) : status === "Scheduled" && !upcoming ? (
                  <p className="text-center text-xs text-muted-foreground">This session has started, so it can't be changed here.</p>
                ) : null}

                <Button asChild variant="ghost" className="h-10 w-full text-muted-foreground">
                  <Link to="/portal/messages" onClick={close}>
                    <MessageCircle className="mr-2 h-4 w-4" /> Message your coach
                  </Link>
                </Button>
              </>
            )}

            {mode === "move" && (
              <>
                <div className="space-y-2">
                  <Label>New day</Label>
                  <DayChips value={newDate} onChange={setNewDate} label="New day" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="move-time">New time</Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="move-time"
                      type="time"
                      step={900}
                      value={newStart}
                      onChange={(e) => setNewStart(e.target.value)}
                      className="h-11 w-40 rounded-lg border border-border bg-background px-3 text-[16px]"
                    />
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> {length ? `${length} min, same as now` : "Same length"}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="move-others">Other times that work <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="move-others"
                    value={others}
                    maxLength={300}
                    onChange={(e) => setOthers(e.target.value)}
                    placeholder="e.g. any evening next week"
                    className="h-11 text-[16px]"
                  />
                </div>
                <WhyField reasons={reasons} onToggle={toggleReason} why={why} onWhy={setWhy} />
              </>
            )}

            {mode === "cancel" && <WhyField reasons={reasons} onToggle={toggleReason} why={why} onWhy={setWhy} />}
          </div>
        </div>

        {footer && (
          <div className="border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <div className="mx-auto w-full max-w-lg">{footer}</div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-violet-400">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function WhyField({ reasons, onToggle, why, onWhy }: {
  reasons: string[];
  onToggle: (r: string) => void;
  why: string;
  onWhy: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Why? <span className="font-normal text-muted-foreground">(optional, helps your coach)</span></Label>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => {
          const on = reasons.includes(r);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(r)}
              className={cn(
                "h-9 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.97]",
                on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {r}
            </button>
          );
        })}
      </div>
      <Textarea rows={2} value={why} maxLength={600} onChange={(e) => onWhy(e.target.value)} placeholder="Anything else your coach should know" className="text-[16px]" />
    </div>
  );
}
