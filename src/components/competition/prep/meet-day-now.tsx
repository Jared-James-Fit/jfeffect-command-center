/**
 * Meet-Day Mode's "now" panel (Nov 26 2026): what matters this minute, read
 * from the timeline, the approved gameplan and what's been logged
 * (`meetDayView`): the stage, the next thing and when, the lift that's on with
 * its attempts, the next warm-up's weight and reps, the rack heights, and what
 * changed. The same panel for the coach (who can mark when a flight actually
 * started, so the later times move) and the athlete (read-only). It reads the
 * meet the athlete's way (`getMyMeetFn`), which their phone keeps for the
 * venue, and refreshes every half minute.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getMyMeetFn, meetProgressFn } from "@/lib/competition/handling.functions";
import { clock, hhmm, nowInZone } from "@/lib/competition/event-timeline";
import { meetDayView, STAGE_WORD, type LoggedAttempt } from "@/lib/competition/meet-day-mode";
import { readGameplan } from "@/lib/competition/gameplan";
import { cn } from "@/lib/utils";

export const myMeetKey = (competitionId: string, clientId: string | null) => ["my-meet", competitionId, clientId] as const;

const LIFT_WORD = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" } as const;

export function MeetDayNow({
  competitionId,
  clientId,
  who,
  logged: extraLogged,
}: {
  competitionId: string;
  clientId: string | null;
  who: "coach" | "athlete";
  /** attempts logged on this phone and not on the server yet */
  logged?: LoggedAttempt[];
}) {
  const read = useServerFn(getMyMeetFn);
  const progress = useServerFn(meetProgressFn);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: myMeetKey(competitionId, clientId),
    queryFn: () => read({ data: { competitionId, clientId } }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const mark = useMutation({
    mutationFn: (anchor: string) => {
      const tz = (q.data as any)?.tz ?? null;
      return progress({ data: { competitionId, anchor, at: hhmm(nowInZone(tz).minutes) } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-meet", competitionId] });
      toast.success("Later times moved to match");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });

  const data = q.data as any;
  const view = useMemo(() => {
    if (!data) return null;
    const server: LoggedAttempt[] = ((data.meetLog ?? []) as any[]).map((r) => ({
      lift: r.lift,
      attempt: r.attempt,
      kg: r.kg != null ? Number(r.kg) : null,
      result: r.result,
    }));
    const byKey = new Map<string, LoggedAttempt>();
    for (const r of [...server, ...(extraLogged ?? [])]) byKey.set(`${r.lift}|${r.attempt}`, r);
    return meetDayView({
      timeline: data.timeline,
      plan: data.plan?.doc ? readGameplan(data.plan.doc) : null,
      now: nowInZone(data.tz),
      logged: [...byKey.values()],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, extraLogged, tick]);

  if (!data || !view) return null;
  const nextIn = view.nextInMinutes;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" data-meet-day-now>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Now</p>
        <p className="text-[12px] text-muted-foreground">{clock(nowInZone(data.tz).minutes)}</p>
      </div>
      <p className="text-[24px] font-semibold leading-tight" data-meet-stage={view.stage}>
        {STAGE_WORD[view.stage]}
      </p>
      {view.next ? (
        <p className="text-[15px]" data-meet-next>
          Next: <span className="font-medium">{view.next.label}</span>
          {view.next.at != null ? ` at ${clock(view.next.at)}` : ""}
          {nextIn != null ? (
            <span className={cn("text-muted-foreground", nextIn < 0 && "text-warning")}>
              {" "}
              · {nextIn >= 0 ? `in ${nextIn} min` : `${-nextIn} min late`}
            </span>
          ) : null}
          {view.next.status !== "confirmed" ? <span className="text-[12px] text-muted-foreground"> (est.)</span> : null}
        </p>
      ) : null}

      {view.nextWarmup ? (
        <div className="rounded-xl bg-muted/50 p-3" data-next-warmup>
          <p className="text-[12px] text-muted-foreground">
            Next warm-up · {view.nextWarmup.index} of {view.nextWarmup.of}
            {view.nextWarmup.at != null ? ` · ~${clock(view.nextWarmup.at)}` : ""}
          </p>
          <p className="text-[30px] font-semibold leading-tight tabular-nums">
            {view.nextWarmup.kg} kg × {view.nextWarmup.reps}
          </p>
        </div>
      ) : null}

      {view.lift ? (
        <div data-meet-attempts>
          <p className="mb-1 text-[12.5px] text-muted-foreground">{LIFT_WORD[view.lift]} attempts</p>
          <div className="grid grid-cols-3 gap-2">
            {view.attempts.map((a) => (
              <div
                key={a.attempt}
                className={cn(
                  "rounded-xl border p-2 text-center",
                  a.result === "good" ? "border-success/50" : a.result === "no_lift" ? "border-destructive/50" : "border-border",
                )}
              >
                <p className="text-[11px] text-muted-foreground">{a.attempt === 1 ? "Opener" : a.attempt === 2 ? "2nd" : "3rd"}</p>
                <p className="text-[18px] font-semibold tabular-nums">{a.kg ?? "–"}</p>
                <p className={cn("text-[11px]", a.result === "good" ? "text-success" : a.result === "no_lift" ? "text-destructive" : "text-muted-foreground")}>
                  {a.result === "good" ? "Good" : a.result === "no_lift" ? "No lift" : a.result === "pending" ? "Pending" : "Planned"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view.rack ? (
        <p className="text-[14px]" data-meet-rack>
          <span className="text-muted-foreground">Rack: </span>
          {view.rack}
        </p>
      ) : null}
      {view.changes.length ? (
        <ul className="space-y-0.5 text-[13px] text-warning" data-meet-changes>
          {view.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ) : null}

      {who === "coach" ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-3" data-meet-progress>
          <span className="w-full text-[12px] text-muted-foreground">Mark what just started (later times move with it)</span>
          {view.stage === "before" || view.stage === "weigh_in" ? (
            <Button size="sm" variant="outline" loading={mark.isPending} onClick={() => mark.mutate("weigh_in")}>
              Weigh-in
            </Button>
          ) : null}
          {(["squat", "bench", "deadlift"] as const).map((l) =>
            view.lift === l || (!view.lift && l === "squat") || (view.lift === "squat" && l === "bench") || (view.lift === "bench" && l === "deadlift") ? (
              <Button key={l} size="sm" variant="outline" loading={mark.isPending} onClick={() => mark.mutate(`${l}_flight`)}>
                {LIFT_WORD[l]} flight started
              </Button>
            ) : null,
          )}
        </div>
      ) : null}
    </section>
  );
}
