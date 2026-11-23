import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { getMyCoachingCalls, saveCallTopics, type MyCall } from "@/lib/coaching-packages/packages.functions";
import { lastDay } from "@/lib/coaching-packages/call-period";

function day(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

function when(c: MyCall): string {
  if (!c.start) return day(c.date);
  return new Date(c.start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * A client's included video calls (Coaching Plus): how many are left this
 * billing period, their booked calls with what they want to cover, and the
 * next steps their coach sent after a call. Nothing shows for anyone whose
 * package has no calls. In a coach's preview it reads, and books or saves
 * nothing.
 */
/** The signed-in client's included calls (or the previewed client's), shared by Home's card and the session sheet. */
export function useMyCoachingCalls(enabled = true) {
  const pov = usePovArgs();
  const fetchCalls = usePovFn(useServerFn(getMyCoachingCalls));
  return useQuery({
    queryKey: ["my-coaching-calls", pov.viewAsClientId ?? null],
    queryFn: () => fetchCalls({ data: {} }),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * The cancellation rule for one included call, said when they ask to cancel
 * it: 24+ hours ahead gives the call back, later (or a no-show) uses it.
 * Null when the session isn't one of their included calls.
 */
export function IncludedCallCancelNote({ sessionId, startsAt }: { sessionId: string; startsAt: Date | null }) {
  const q = useMyCoachingCalls();
  const c = q.data;
  if (!c || !c.calls.some((x) => x.id === sessionId)) return null;
  const hoursOut = startsAt ? (startsAt.getTime() - Date.now()) / 3_600_000 : null;
  const timely = hoursOut !== null && hoursOut >= c.cancelHours;
  return (
    <p className="rounded-xl bg-muted/60 p-3 text-[13px] leading-relaxed text-muted-foreground" data-call-cancel-note={timely ? "timely" : "late"}>
      {timely
        ? `This is one of your included calls. You're more than ${c.cancelHours} hours out, so cancelling gives it back to you.`
        : `This is one of your included calls. It's within ${c.cancelHours} hours, so cancelling now uses it, the same as a no-show.`}
    </p>
  );
}

export function IncludedCallsCard() {
  const pov = usePovArgs();
  const previewing = !!pov.viewAsClientId;
  const q = useMyCoachingCalls();
  const c = q.data;
  if (!c) return null;
  const now = Date.now();
  const upcoming = c.calls.filter((x) => x.status === "Scheduled" && (!x.end || new Date(x.end).getTime() > now));
  const notes = c.calls.filter((x) => x.shared).slice(-1);
  return (
    <Card className="space-y-3 p-4" data-included-calls>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted" aria-hidden>
          <Video className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold">Calls with your coach</p>
          <p className="text-[13px] text-muted-foreground" data-calls-left>
            {c.left} of {c.included} left until {day(lastDay(c.periodEnd))}
            {c.left === 0 && c.next ? ` · ${c.next.left} more from ${day(c.next.periodStart)}` : ""}
          </p>
        </div>
        {c.bookSlug && !previewing && (c.left > 0 || (c.next?.left ?? 0) > 0) && (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/book/$slug" params={{ slug: c.bookSlug }} search={{ name: "", email: "", phone: "", application_id: "", i: "" }}>
              Book a call
            </Link>
          </Button>
        )}
      </div>

      {upcoming.map((call) => (
        <UpcomingCall key={call.id} call={call} previewing={previewing} />
      ))}

      {notes.map((call) => (
        <div key={call.id} className="rounded-xl bg-muted/50 p-3" data-call-next-steps>
          <p className="text-[13px] font-medium text-muted-foreground">Next steps from your call on {day(call.date)}</p>
          {call.shared!.actionItems.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px]">
              {call.shared!.actionItems.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {call.shared!.nextPriorities && <p className="mt-1.5 text-[14px]">{call.shared!.nextPriorities}</p>}
        </div>
      ))}

      <p className="text-[12px] leading-relaxed text-muted-foreground" data-calls-policy>
        {c.callMinutes} minutes each. Cancel at least {c.cancelHours} hours ahead and the call goes back to you. A later cancel
        or a no-show uses it. If I move or cancel a call, it never counts. Unused calls don't carry over.
      </p>
    </Card>
  );
}

function UpcomingCall({ call, previewing }: { call: MyCall; previewing: boolean }) {
  const qc = useQueryClient();
  const save = useServerFn(saveCallTopics);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(call.topics ?? "");
  const m = useMutation({
    mutationFn: () => save({ data: { sessionId: call.id, topics: text } }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["my-coaching-calls"] });
      toast.success("Saved. Your coach sees it before the call.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="rounded-xl border border-border p-3" data-upcoming-call>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[15px] font-medium">{when(call)}</p>
        {call.meetLink && !previewing && (
          <a href={call.meetLink} target="_blank" rel="noreferrer" className="text-[14px] font-semibold underline-offset-4 hover:underline">
            Join
          </a>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            rows={3}
            maxLength={1500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What do you want to cover? Questions, a lift, your nutrition…"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
              Save
            </Button>
          </div>
        </div>
      ) : call.topics ? (
        <button
          type="button"
          className="mt-1 w-full text-left text-[14px] text-muted-foreground"
          onClick={() => !previewing && setEditing(true)}
        >
          To cover: {call.topics}
        </button>
      ) : (
        !previewing && (
          <button type="button" className="mt-1 text-[14px] font-medium underline-offset-4 hover:underline" onClick={() => setEditing(true)}>
            Add what you want to cover
          </button>
        )
      )}
    </div>
  );
}
