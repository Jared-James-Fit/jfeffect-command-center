/**
 * The athlete's Competition page (Nov 24 2026): their meet, the game plan their
 * coach approved (attempts, warm-ups, the day, in plain words), and every
 * preparation update released to them, newest first. Only what was released is
 * here, only the athlete's version: never the internal read or the competitor
 * research. Acknowledging belongs to the version on screen; when a newer
 * version is released, the page says so and asks again. The last read stays
 * on the phone (the app's saved queries), so the plan opens at a venue with no
 * signal. A coach previewing them sees the page but never opens or
 * acknowledges anything for them.
 */
import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/loading";
import { getMyCompetitionsFn, markMyUpdateFn } from "@/lib/competition/competition.functions";
import { countdownWords, daysBetween, MILESTONE_BY_KIND } from "@/lib/competition/milestones";
import { useClientImpersonation, useViewingAsClient } from "@/lib/client-impersonation";
import { todayLocalISO } from "@/lib/today";
import { AttemptsView, GameDayView, WarmupsView } from "./plan-views";
import { cn } from "@/lib/utils";

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "";

export function AthleteCompetition({ focusUpdate }: { focusUpdate?: string | null }) {
  const read = useServerFn(getMyCompetitionsFn);
  const mark = useServerFn(markMyUpdateFn);
  const { client } = useClientImpersonation();
  const previewing = useViewingAsClient();
  const qc = useQueryClient();
  const clientId = client?.id ?? null;
  const q = useQuery({
    queryKey: ["my-competitions", clientId],
    queryFn: () => read({ data: { clientId } }),
    staleTime: 60_000,
  });
  const ack = useMutation({
    mutationFn: (id: string) => mark({ data: { assessmentId: id, what: "acknowledged" } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-competitions"] });
      toast.success("Got it. Your coach can see you've read it.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });

  const comps = (q.data?.competitions ?? []) as any[];
  const today = todayLocalISO();
  const upcoming = comps
    .filter((c) => c.status === "upcoming")
    .sort((a, b) => String(a.meet_date).localeCompare(String(b.meet_date)));
  const past = comps.filter((c) => c.status !== "upcoming");
  const ordered = [...upcoming, ...past];

  // opening the page with an update on screen counts as opening it (never in a preview)
  const toOpen = useMemo(() => {
    const ids: string[] = [];
    for (const c of ordered) {
      for (const u of c.updates)
        if (!u.openedAt && (u.id === focusUpdate || u.id === c.currentPlanId)) ids.push(u.id);
    }
    return ids;
  }, [ordered, focusUpdate]);
  useEffect(() => {
    if (previewing || !toOpen.length) return;
    for (const id of toOpen)
      void mark({ data: { assessmentId: id, what: "opened" } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toOpen.join(","), previewing]);

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (q.error && !q.data)
    return <ErrorState error={q.error} what="your competition" onRetry={() => void q.refetch()} />;
  if (!ordered.length)
    return (
      <EmptyState
        icon={<Trophy className="h-5 w-5" />}
        title="No competition yet"
        detail="When your coach sets up a meet, your preparation updates and game plan show up here."
      />
    );

  return (
    <div className="space-y-6" data-athlete-competition>
      {ordered.map((c) => {
        const days = daysBetween(today, String(c.meet_date));
        const plan = c.updates.find((u: any) => u.id === c.currentPlanId) ?? null;
        const ackedOlder = c.updates.some(
          (u: any) =>
            u.id !== plan?.id &&
            (u.kind === "game_plan" || u.kind === "confirm") &&
            u.acknowledgedAt,
        );
        const others = c.updates.filter((u: any) => u.id !== plan?.id && !u.superseded);
        return (
          <section key={c.id} className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-[12px] text-muted-foreground">
                {c.status === "upcoming" ? countdownWords(days) : "Completed"}
              </p>
              <h2 className="text-[20px] font-semibold leading-tight">{c.name}</h2>
              <p className="mt-0.5 text-[14px] text-muted-foreground">
                {[
                  fmt(c.meet_date),
                  c.location,
                  c.federation,
                  c.weight_class ? `${c.weight_class} kg` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {c.weigh_in_at || c.lifting_start || c.flight ? (
                <p className="mt-1 text-[13px]">
                  {[
                    c.weigh_in_at ? `Weigh-in ${c.weigh_in_at}` : null,
                    c.lifting_start ? `Lifting ${c.lifting_start}` : null,
                    c.flight ? `Flight ${c.flight}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {c.results?.total ? (
                <p className="mt-2 text-[15px] font-semibold">
                  Total {c.results.total} kg{c.results.place ? ` · ${c.results.place}` : ""}
                </p>
              ) : null}
            </div>

            {plan ? (
              <div
                className="space-y-3 rounded-2xl border border-border bg-card p-4"
                data-athlete-plan
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[17px] font-semibold">
                      {plan.athlete?.title ?? "Your game plan"}
                    </h3>
                    <p className="text-[12px] text-muted-foreground">
                      {plan.automated ? "Automated preparation update" : "From your coach"} ·{" "}
                      {fmtWhen(plan.releasedAt)} · version {plan.version}
                    </p>
                  </div>
                  {plan.acknowledgedAt ? (
                    <span className="flex items-center gap-1 rounded-full border border-success/40 px-2 py-1 text-[12px] text-success">
                      <Check className="h-3.5 w-3.5" /> Got it
                    </span>
                  ) : null}
                </div>
                {!plan.acknowledgedAt && ackedOlder ? (
                  <p className="rounded-xl bg-warning/10 p-2 text-[13px]">
                    Your plan was updated since you last read it. Have a look at what changed.
                  </p>
                ) : null}
                {plan.athlete?.summary ? (
                  <p className="whitespace-pre-line text-[15px] leading-relaxed">
                    {plan.athlete.summary}
                  </p>
                ) : null}
                {plan.athlete?.focus?.length ? (
                  <ul className="space-y-1 text-[14px]">
                    {plan.athlete.focus.map((f: string, i: number) => (
                      <li key={i}>· {f}</li>
                    ))}
                  </ul>
                ) : null}
                {plan.athlete?.plan ? (
                  <>
                    <div>
                      <h4 className="mb-2 text-[15px] font-semibold">Attempts</h4>
                      <AttemptsView attempts={plan.athlete.plan.attempts} detail={false} />
                    </div>
                    <div>
                      <h4 className="mb-2 text-[15px] font-semibold">Warm-ups</h4>
                      <WarmupsView warmups={plan.athlete.plan.warmups} compact />
                    </div>
                    <div>
                      <h4 className="mb-2 text-[15px] font-semibold">The day</h4>
                      <GameDayView steps={plan.athlete.plan.gameDay} />
                    </div>
                  </>
                ) : null}
                {plan.needsAck && !plan.acknowledgedAt ? (
                  <Button
                    className="w-full"
                    loading={ack.isPending}
                    disabled={previewing}
                    onClick={() => ack.mutate(plan.id)}
                  >
                    {previewing ? "They tap Got it here" : "Got it"}
                  </Button>
                ) : null}
                <p className="text-[12px] text-muted-foreground">
                  Saved on this phone, so it opens at the venue without signal.
                </p>
              </div>
            ) : c.status === "upcoming" ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-[14px] text-muted-foreground">
                Your game plan comes about two weeks out.
              </p>
            ) : null}

            {others.length ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-[16px] font-semibold">Preparation updates</h3>
                <ul className="mt-2 divide-y divide-border">
                  {others.map((u: any) => (
                    <li
                      key={u.id}
                      className={cn("py-3", u.id === focusUpdate && "rounded-lg bg-muted/40 px-2")}
                    >
                      <p className="text-[12px] text-muted-foreground">
                        {MILESTONE_BY_KIND[u.kind as keyof typeof MILESTONE_BY_KIND]?.title ??
                          "Update"}{" "}
                        · {fmtWhen(u.releasedAt)}
                        {u.automated ? " · automated" : ""}
                      </p>
                      <p className="text-[15px] font-medium">{u.athlete?.title}</p>
                      {u.athlete?.summary ? (
                        <p className="mt-1 whitespace-pre-line text-[14px] text-muted-foreground">
                          {u.athlete.summary}
                        </p>
                      ) : null}
                      {u.athlete?.expectations?.length ? (
                        <ul className="mt-1 space-y-0.5 text-[13px]">
                          {u.athlete.expectations.map((x: string, i: number) => (
                            <li key={i}>· {x}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
