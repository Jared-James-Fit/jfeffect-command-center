/**
 * One assessment, opened from the Competition tab or a push: the internal
 * coaching read and the athlete's version kept apart (a switch between them),
 * where it stands for the coach and for the athlete, and the coach's actions:
 * mark reviewed, ask for changes (written again with their words), approve,
 * release, edit the athlete's version. Opening it records that the coach
 * opened it, never that they approved it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/loading";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import {
  assessmentActionFn,
  editAthleteVersionFn,
  getAssessmentFn,
} from "@/lib/competition/competition.functions";
import { MILESTONE_BY_KIND } from "@/lib/competition/milestones";
import {
  athleteState,
  ATHLETE_STATE_WORD,
  coachActions,
  coachState,
  COACH_STATE_WORD,
  type AssessmentRow,
} from "@/lib/competition/lifecycle";
import { AttemptsView, ForecastTable, GameDayView, WarmupsView } from "./plan-views";
import { StrategyCalls } from "./strategy-calls";
import { confirmedPlan } from "@/lib/competition/proposals";
import { cn } from "@/lib/utils";
import {
  RewriteProgressCard,
  RewriteReadyRow,
  rewriteKey,
  type RewriteProgress,
} from "./rewrite-progress";
import type { LiveRewrite } from "@/lib/competition/rewrite-progress";

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-CA", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

const SECTION_TITLE: Record<string, string> = {
  projection: "Projection",
  field: "The field",
  attempts: "Attempts",
  warmups: "Warm-ups",
  game_day: "Meet day",
  bodyweight: "Bodyweight",
  programming: "Programming",
  learning: "What we've learned about them",
  debrief: "Debrief",
};

export function AssessmentSheet({
  assessmentId,
  clientId,
  rewrite,
  onOpen,
  onClose,
  newerReleased = false,
}: {
  assessmentId: string | null;
  clientId: string;
  /** What Cleo is writing (the tab's one poll), for this version's rewrite. */
  rewrite?: RewriteProgress;
  /** Open another version in the sheet (the one a rewrite produced). */
  onOpen?: (id: string) => void;
  onClose: () => void;
  newerReleased?: boolean;
}) {
  const read = useServerFn(getAssessmentFn);
  const act = useServerFn(assessmentActionFn);
  const edit = useServerFn(editAthleteVersionFn);
  const qc = useQueryClient();
  const [view, setView] = useState<"internal" | "athlete">("internal");
  const [changes, setChanges] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | {
    title: string;
    summary: string;
    message: string;
  }>(null);
  const q = useQuery({
    queryKey: ["competition-assessment", assessmentId],
    queryFn: () => read({ data: { assessmentId: assessmentId!, markOpened: true } }),
    enabled: !!assessmentId,
    staleTime: 15_000,
  });
  // the request just sent, shown at once until the poll has it
  const [justSent, setJustSent] = useState<LiveRewrite | null>(null);
  useEffect(() => {
    setView("internal");
    setChanges(null);
    setEditing(null);
    setJustSent(null);
  }, [assessmentId]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["competition-assessment", assessmentId] });
    void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
    void qc.invalidateQueries({ queryKey: ["competition-overview"] });
  };
  const run = useMutation({
    mutationFn: (x: {
      action: "review" | "request_changes" | "approve" | "release" | "approve_release";
      note?: string | null;
    }) => act({ data: { assessmentId: assessmentId!, action: x.action, note: x.note ?? null } }),
    onSuccess: (_r, x) => {
      refresh();
      if (x.action === "request_changes") {
        // the card below says the rest: where Cleo is and about how long is left
        setChanges(null);
        const a = q.data as any;
        if (a?.milestone_id)
          setJustSent({
            milestoneId: a.milestone_id,
            kind: a.kind,
            status: "scheduled",
            attempts: 0,
            lastError: null,
            why: "Changes requested",
            updatedAt: new Date().toISOString(),
            lockedAt: null,
            done: [],
            pending: null,
            request: {
              assessmentId: a.id,
              version: Number(a.version ?? 1),
              note: x.note ?? null,
              at: new Date().toISOString(),
            },
          });
        if (a?.competition_id) void qc.invalidateQueries({ queryKey: rewriteKey(a.competition_id) });
        toast.success("Sent to Cleo");
        return;
      }
      toast.success(
        x.action === "review"
          ? "Marked reviewed"
          : x.action === "approve"
            ? "Approved"
            : "Released to the athlete",
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "That didn't work"),
  });
  const save = useMutation({
    mutationFn: (x: { title: string; summary: string; message: string }) =>
      edit({ data: { assessmentId: assessmentId!, ...x } }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success("Athlete version saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const a = q.data as any;
  const row = a as AssessmentRow | undefined;
  const def = a ? MILESTONE_BY_KIND[a.kind as keyof typeof MILESTONE_BY_KIND] : null;
  const n = a?.internal?.narrative;
  const engine = a?.internal?.engine;
  const strategy = a?.internal?.strategy;
  const plan = a?.internal ? confirmedPlan(a.internal) : null;
  // Cleo rewriting this version: its progress, never a second request on top of it
  const polled = rewrite?.liveFor(assessmentId) ?? null;
  const live = polled ?? (justSent && a?.status === "changes_requested" ? justSent : null);
  const landed = rewrite?.doneFor(assessmentId) ?? null;
  const actions = (row ? coachActions(row) : []).filter(
    (x) => !(x === "request_changes" && live),
  );
  const busy = run.isPending;

  return (
    <Sheet open={!!assessmentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto pt-[calc(env(safe-area-inset-top)+4rem)] sm:max-w-2xl"
        data-assessment-sheet
      >
        <SheetHeader className="min-h-0 pl-0 text-left">
          <div className="flex items-start gap-2">
            <CleoAvatar size="sm" />
            <div className="min-w-0">
              <SheetTitle className="text-[17px]">
                {def?.title ?? "Competition assessment"}
              </SheetTitle>
              <SheetDescription className="text-[12px]">
                {a?.competition_context ? (
                  <span className="block break-words font-medium text-foreground">
                    {a.competition_context.name}
                    {a.competition_context.weight_class ? ` · ${String(a.competition_context.weight_class).replace(/\s*kg$/i, "")} kg` : ""}
                    {a.competition_context.meet_date ? ` · ${new Date(a.competition_context.meet_date + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}` : ""}
                  </span>
                ) : a ? <span className="block text-warning">Competition details unavailable</span> : null}
                {a ? <span className="block">Prepared by Cleo · {fmt(a.created_at)} · v{a.version}</span> : "Prepared by Cleo"}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        {q.isLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : q.error || !a ? (
          <ErrorState
            error={q.error}
            what="this assessment"
            onRetry={() => void q.refetch()}
            className="mt-4"
          />
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-assessment-states>
              {a.urgency === "urgent" || a.urgency === "attention" ? (
                <span className={cn("font-medium", a.urgency === "urgent" ? "text-destructive" : "text-warning")}>
                  {a.urgency === "urgent" ? "Needs attention now" : "Review recommended"}
                </span>
              ) : null}
              <span className="font-medium">{a.needs_approval && !a.approved_at ? "Awaiting approval" : COACH_STATE_WORD[coachState(row!)]}</span>
              <span className="text-muted-foreground">Athlete: {ATHLETE_STATE_WORD[athleteState(row!, newerReleased)]}</span>
              {a.release_kind === "automated" ? <span className="text-muted-foreground">Released automatically</span> : null}
            </div>

            {live && a.competition_id ? (
              <RewriteProgressCard
                live={live}
                now={rewrite?.now ?? Date.now()}
                typical={rewrite?.data?.typical ?? { write: 160_000, write2: 245_000 }}
                competitionId={a.competition_id}
                onRetried={() => rewrite?.refetch()}
              />
            ) : landed || (a.status === "superseded" && a.superseded_by) ? (
              <RewriteReadyRow
                version={landed?.version ?? null}
                kind={a.kind}
                onOpen={() => onOpen?.(landed?.toId ?? a.superseded_by)}
              />
            ) : null}

            <div className="inline-flex rounded-lg bg-secondary p-0.5 text-[13px]" role="tablist">
              {(["internal", "athlete"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5",
                    view === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {v === "internal" ? "Coach review" : "Athlete preview"}
                </button>
              ))}
            </div>

            {view === "internal" ? (
              <div className="space-y-4" data-assessment-internal>
                {((engine?.watch ?? []) as any[])
                  .filter((w) => String(w.key ?? "").startsWith("class:note:"))
                  .map((w) => (
                    // the coach's note named another class than the meet's: said before anything else
                    <p
                      key={w.key}
                      className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] leading-snug"
                      data-class-note
                    >
                      {w.text}
                    </p>
                  ))}
                <section className="rounded-xl border border-border bg-muted/20 p-3">
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">Key takeaway</h3>
                  <p className="text-[15px] font-semibold leading-snug">{a.headline}</p>
                </section>
                {n?.concerns?.length ? <ListBlock title="Issues to review" items={n.concerns} tone="warn" /> : null}
                {engine && plan ? (
                  <section>
                    <h4 className="mb-1.5 text-[14px] font-semibold">Performance projection</h4>
                    <ForecastTable forecast={plan.forecast} showBasis />
                  </section>
                ) : null}
                <StrategyCalls
                  assessmentId={a.id}
                  clientId={clientId}
                  review={n?.engine_review ?? []}
                  checks={strategy?.checks ?? []}
                  declined={strategy?.declined ?? []}
                  evidence={strategy?.evidence ?? []}
                  locked={a.status === "released" || a.status === "superseded"}
                />
                {n?.recommendations?.length ? (
                  <section>
                    <h4 className="text-[14px] font-semibold">Recommendations</h4>
                    <ul className="mt-1.5 space-y-1.5 text-[14px]">
                      {n.recommendations.map((r: any, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
                            {r.area}
                          </span>
                          <span>
                            {r.text}
                            {r.needs_approval ? (
                              <span className="text-muted-foreground"> · your decision</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {a.call ? (
                  <section
                    className="rounded-xl border border-border p-3 text-[14px]"
                    data-call-recommendation
                  >
                    <h4 className="font-semibold">
                      {a.call.recommend
                        ? `Strategy call recommended · ${a.call.minutes} min`
                        : "No call needed"}
                    </h4>
                    {n?.call_note ? <p className="mt-1">{n.call_note}</p> : null}
                    {a.call.recommend ? (
                      <ul className="mt-1 text-[13px] text-muted-foreground">
                        {a.call.reasons.map((r: string, i: number) => (
                          <li key={i}>· {r}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[13px] text-muted-foreground">{a.call.skipReason}</p>
                    )}
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {a.call.coverage?.text} Nothing is booked or charged unless you book it.
                    </p>
                  </section>
                ) : null}
                {(n?.coach_summary || n?.challenges?.length || Object.keys(n?.sections ?? {}).length) ? (
                  <details className="rounded-xl border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Detailed coaching analysis</summary>
                    <div className="mt-3 space-y-3">
                      {n?.coach_summary ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{n.coach_summary}</p> : null}
                      {n?.challenges?.length ? <ListBlock title="Additional considerations" items={n.challenges} /> : null}
                      {Object.entries((n?.sections ?? {}) as Record<string, string>).map(([k, v]) => (
                        <section key={k}>
                          <h4 className="text-[14px] font-semibold">{SECTION_TITLE[k] ?? k.replaceAll("_", " ")}</h4>
                          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed">{v}</p>
                        </section>
                      ))}
                    </div>
                  </details>
                ) : null}
                {engine && plan ? (
                  <>

                    {a.kind === "forecast" || a.kind === "game_plan" || a.kind === "confirm" ? (
                      <section>
                        <h4 className="mb-1.5 text-[14px] font-semibold">Attempts</h4>
                        <AttemptsView attempts={plan.attempts?.lifts} />
                      </section>
                    ) : null}
                  </>
                ) : null}
                {a.internal?.instructions ? (
                  <p className="text-[12px] text-muted-foreground">
                    Written with your changes: “{a.internal.instructions}”
                  </p>
                ) : null}

              </div>
            ) : (
              <div className="space-y-4" data-assessment-athlete>
                {editing ? (
                  <div className="space-y-2">
                    <Input
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      aria-label="Title"
                    />
                    <Textarea
                      value={editing.summary}
                      onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
                      rows={5}
                      aria-label="Summary"
                    />
                    <Textarea
                      value={editing.message}
                      onChange={(e) => setEditing({ ...editing, message: e.target.value })}
                      rows={3}
                      maxLength={300}
                      aria-label="Chat message"
                      placeholder="The message that goes with it in their chat"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        loading={save.isPending}
                        onClick={() => save.mutate(editing)}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <section>
                      <h3 className="text-[16px] font-semibold">{a.athlete?.title}</h3>
                      <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed">
                        {a.athlete?.summary}
                      </p>
                    </section>
                    {a.athlete?.focus?.length ? (
                      <ListBlock title="Focus" items={a.athlete.focus} />
                    ) : null}
                    {a.athlete?.expectations?.length ? (
                      <ListBlock title="What I need from you" items={a.athlete.expectations} />
                    ) : null}
                    {a.athlete?.message ? (
                      <p className="rounded-xl bg-muted/60 p-3 text-[14px]">
                        Chat message: “{a.athlete.message}”
                      </p>
                    ) : null}
                    {a.athlete?.plan ? (
                      <>
                        <section>
                          <h4 className="mb-1.5 text-[14px] font-semibold">Attempts</h4>
                          <AttemptsView attempts={a.athlete.plan.attempts} detail={false} />
                        </section>
                        <section>
                          <h4 className="mb-1.5 text-[14px] font-semibold">Warm-ups</h4>
                          <WarmupsView warmups={a.athlete.plan.warmups} compact />
                        </section>
                        <section>
                          <h4 className="mb-1.5 text-[14px] font-semibold">The day</h4>
                          <GameDayView steps={a.athlete.plan.gameDay} />
                        </section>
                      </>
                    ) : null}
                    {actions.includes("edit_athlete") ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditing({
                            title: a.athlete?.title ?? "",
                            summary: a.athlete?.summary ?? "",
                            message: a.athlete?.message ?? "",
                          })
                        }
                      >
                        Edit athlete version
                      </Button>
                    ) : null}
                    <p className="text-[12px] text-muted-foreground">
                      Competitor research and private observations never go to the athlete.
                    </p>
                  </>
                )}
              </div>
            )}

            {changes != null ? (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <label className="text-[13px] font-medium" htmlFor="changes-note">
                  What should change?
                </label>
                <Textarea
                  id="changes-note"
                  value={changes}
                  onChange={(e) => setChanges(e.target.value)}
                  rows={4}
                  placeholder="e.g. Open the deadlift at 230, she's been pulling it for triples. Keep the bench conservative."
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      run.mutate({ action: "request_changes", note: changes.trim() || null })
                    }
                  >
                    Write a new version
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setChanges(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            <div
              className="sticky -bottom-6 -mx-6 flex flex-wrap items-center gap-2 border-t border-border bg-background px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:bg-card"
              data-assessment-actions
            >
              {actions.includes("release") ? (
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    run.mutate({
                      action: a.needs_approval && !a.approved_at ? "approve_release" : "release",
                    })
                  }
                >
                  {a.needs_approval && !a.approved_at
                    ? "Approve and release"
                    : "Release to athlete"}
                </Button>
              ) : null}
              {actions.includes("approve") ? (
                <Button
                  size="sm"
                  className="max-md:flex-1"
                  loading={busy}
                  onClick={() => run.mutate({ action: "approve_release" })}
                >
                  Approve and release
                </Button>
              ) : null}
              {/* the rest: inline on a computer, one ⋯ on a phone (a decision is one row) */}
              {actions.includes("approve") ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="max-md:hidden"
                  disabled={busy}
                  onClick={() => run.mutate({ action: "approve" })}
                >
                  Approve only
                </Button>
              ) : null}
              {actions.includes("review") ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="max-md:hidden"
                  disabled={busy}
                  onClick={() => run.mutate({ action: "review" })}
                >
                  Mark reviewed
                </Button>
              ) : null}
              {actions.includes("request_changes") && changes == null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="max-md:hidden"
                  onClick={() => setChanges("")}
                >
                  Request changes
                </Button>
              ) : null}
              {actions.includes("approve") ||
              actions.includes("review") ||
              (actions.includes("request_changes") && changes == null) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="md:hidden"
                      aria-label="More actions"
                      disabled={busy}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {actions.includes("approve") ? (
                      <DropdownMenuItem onSelect={() => run.mutate({ action: "approve" })}>
                        Approve only
                      </DropdownMenuItem>
                    ) : null}
                    {actions.includes("review") ? (
                      <DropdownMenuItem onSelect={() => run.mutate({ action: "review" })}>
                        Mark reviewed
                      </DropdownMenuItem>
                    ) : null}
                    {actions.includes("request_changes") && changes == null ? (
                      <DropdownMenuItem onSelect={() => setChanges("")}>
                        Request changes
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {a.status === "released" ? (
                <p className="text-[12px] text-muted-foreground">
                  Released {fmt(a.released_at)}
                  {a.athlete_acknowledged_at
                    ? ` · acknowledged ${fmt(a.athlete_acknowledged_at)}`
                    : a.athlete_opened_at
                      ? ` · opened ${fmt(a.athlete_opened_at)}`
                      : ""}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  return (
    <section>
      <h4 className="text-[14px] font-semibold">{title}</h4>
      <ul className="mt-1.5 space-y-1 text-[14px]">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={cn(
                "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
                tone === "warn" ? "bg-warning" : "bg-muted-foreground/60",
              )}
            />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
