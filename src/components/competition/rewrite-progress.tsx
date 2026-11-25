/**
 * The moment after "Write a new version" (and any assessment Cleo is writing): one compact card
 * that says it was sent, where Cleo is (Sent · Reading · Writing · Checking · Ready), about how
 * long is left from Cleo's own measured runs, when it's waiting on OpenAI or needs a second pass,
 * why it stopped with Try again, and "Version 2 is ready · Open" when it lands. The words and
 * times are rewrite-progress.ts's (pure, tested); this polls the light read every few seconds
 * while something's in flight, never the whole workspace.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertCircle, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/loading/progress-states";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { getRewriteProgressFn, retryRewriteFn } from "@/lib/competition/competition.functions";
import { MILESTONE_BY_KIND } from "@/lib/competition/milestones";
import {
  inFlight,
  isProviderWait,
  rewriteView,
  type LiveRewrite,
  type RewriteView,
} from "@/lib/competition/rewrite-progress";
import { cn } from "@/lib/utils";

/** Poll this often while Cleo is working (the worker moves on about once a minute). */
const POLL_MS = 4000;

export const rewriteKey = (competitionId: string | null | undefined) =>
  ["competition-rewrite", competitionId ?? null] as const;

/** Versions already announced on this device, so a second screen never toasts twice. */
const announced = new Set<string>();

type RewriteData = Awaited<ReturnType<typeof getRewriteProgressFn>>;

/** Still moving by itself (a stopped one waits for the coach or its own retry; no need to poll fast). */
const moving = (l: LiveRewrite) => inFlight(l.status) && l.status !== "failed";

export function useRewriteProgress(
  competitionId: string | null | undefined,
  clientId: string,
  onOpen?: (assessmentId: string) => void,
) {
  const read = useServerFn(getRewriteProgressFn);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: rewriteKey(competitionId),
    queryFn: () => read({ data: { competitionId: competitionId! } }) as Promise<RewriteData>,
    enabled: !!competitionId,
    staleTime: 2000,
    refetchInterval: (query) => {
      const d = query.state.data as RewriteData | undefined;
      if (!d) return false;
      if (d.live.some(moving)) return POLL_MS;
      // a stopped one is checked now and then (it tries again by itself)
      return d.live.length ? 30_000 : false;
    },
  });
  const data = q.data;

  // the server's clock, so "2 min left" doesn't drift with the phone's
  const skew = useMemo(
    () => (data ? data.serverNow - q.dataUpdatedAt : 0),
    [data, q.dataUpdatedAt],
  );
  const ticking = !!data?.live.some(moving);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ticking]);

  // the change requests seen being written on this screen: only those are announced when they land
  const watched = useRef<Set<string>>(new Set());
  const seenLive = useRef<Set<string>>(new Set());
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.live.map((l) => l.milestoneId));
    let finished = false;
    for (const id of seenLive.current) if (!ids.has(id)) finished = true;
    seenLive.current = ids;
    for (const l of data.live) if (l.request) watched.current.add(l.request.assessmentId);
    if (
      finished ||
      data.done.some((d) => watched.current.has(d.fromId) && !announced.has(d.toId))
    ) {
      // one landed: the workspace and the sheet read again once
      void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
      void qc.invalidateQueries({ queryKey: ["competition-overview"] });
      void qc.invalidateQueries({ queryKey: ["competition-assessment"] });
    }
    for (const d of data.done) {
      if (!watched.current.has(d.fromId) || announced.has(d.toId)) continue;
      announced.add(d.toId);
      const title =
        MILESTONE_BY_KIND[d.kind as keyof typeof MILESTONE_BY_KIND]?.title ?? "Assessment";
      toast.success(`Version ${d.version} is ready`, {
        description: title,
        action: openRef.current
          ? { label: "Open", onClick: () => openRef.current?.(d.toId) }
          : undefined,
      });
    }
  }, [data, qc, clientId]);

  return {
    data,
    now: now + skew,
    /** The rewrite of this version, while Cleo is on it. */
    liveFor: (assessmentId: string | null | undefined) =>
      assessmentId
        ? (data?.live.find((l) => l.request?.assessmentId === assessmentId) ?? null)
        : null,
    /** The version a rewrite of this one just produced. */
    doneFor: (assessmentId: string | null | undefined) =>
      assessmentId ? (data?.done.find((d) => d.fromId === assessmentId) ?? null) : null,
    refetch: () => void qc.invalidateQueries({ queryKey: rewriteKey(competitionId) }),
  };
}

export type RewriteProgress = ReturnType<typeof useRewriteProgress>;

export function RewriteProgressCard({
  live,
  now,
  typical,
  competitionId,
  className,
  onRetried,
  onOpenCurrent,
}: {
  live: LiveRewrite;
  now: number;
  typical: RewriteData["typical"];
  competitionId: string;
  className?: string;
  onRetried?: () => void;
  /** Open the version being replaced (it stays readable while the new one is written). */
  onOpenCurrent?: () => void;
}) {
  const view: RewriteView = rewriteView(live, now, typical);
  const retry = useServerFn(retryRewriteFn);
  const go = useMutation({
    mutationFn: () => retry({ data: { competitionId, milestoneId: live.milestoneId } }),
    onSuccess: () => {
      onRetried?.();
      toast.success("Cleo is on it again");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't start it again"),
  });
  const def = MILESTONE_BY_KIND[live.kind as keyof typeof MILESTONE_BY_KIND];
  const stopped =
    view.phase === "failed" || view.phase === "stopped" || view.phase === "no_consent";
  const title = live.request
    ? `${stopped ? "Version" : "Writing version"} ${live.request.version + 1}`
    : `${stopped ? "" : "Writing "}${def?.title ?? "the assessment"}`;
  const clock = (t: number) =>
    new Date(t).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });

  return (
    <div
      className={cn("rounded-2xl border border-border bg-card p-4", className)}
      data-rewrite-progress={view.phase}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <CleoAvatar size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug">
            {title}
            {live.request && def ? (
              <span className="font-normal text-muted-foreground"> · {def.title}</span>
            ) : null}
          </p>
          {live.request?.note ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground" data-rewrite-note>
              “{live.request.note}”
            </p>
          ) : null}
        </div>
        {onOpenCurrent && live.request ? (
          <button
            type="button"
            onClick={onOpenCurrent}
            className="-my-1 shrink-0 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            See v{live.request.version}
          </button>
        ) : null}
      </div>

      {!stopped ? (
        <>
          <ProgressBar
            fraction={view.share}
            label="Progress of the new version"
            className="mt-3 h-1 [&>div]:duration-1000"
          />
          <ol className="mt-2.5 grid grid-cols-5 gap-1" data-rewrite-steps>
            {view.steps.map((s) => (
              <li
                key={s.key}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 text-center text-[11px] leading-tight",
                  s.state === "now"
                    ? "font-medium text-foreground"
                    : s.state === "done"
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60",
                )}
                data-step={s.key}
                data-state={s.state}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-full",
                    s.state === "done"
                      ? "bg-success text-white"
                      : s.state === "now"
                        ? "border-2 border-foreground"
                        : "border border-border",
                  )}
                  aria-hidden
                >
                  {s.state === "done" ? (
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  ) : s.state === "now" ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" />
                  ) : null}
                </span>
                <span className="w-full truncate">{s.label}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 space-y-0.5">
            <p className="text-[14px]">{view.doing}</p>
            <p className="text-[13px] tabular-nums text-muted-foreground" data-rewrite-time>
              {[
                view.time,
                view.sinceAsked != null && view.sinceAsked >= 60_000
                  ? `sent ${Math.floor(view.sinceAsked / 60_000)} min ago`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {isProviderWait(live) && view.error ? (
              <p className="text-[12px] text-muted-foreground">{view.error}</p>
            ) : null}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            You'll get a notification when it's ready. You can leave this page.
          </p>
        </>
      ) : (
        <div className="mt-3 space-y-2" data-rewrite-stopped>
          <div className="flex items-start gap-2">
            <AlertCircle
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                view.phase === "no_consent" ? "text-warning" : "text-destructive",
              )}
            />
            <div className="min-w-0">
              <p className="text-[14px] font-medium">{view.doing}</p>
              {view.error ? (
                <p className="mt-0.5 text-[13px] text-muted-foreground">{view.error}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
            <span className="text-[12px] text-muted-foreground">
              {view.phase === "no_consent"
                ? "Carries on by itself once they allow it"
                : view.retryAt && view.retryAt > now
                  ? `Tries again by itself at ${clock(view.retryAt)}`
                  : view.retryAt
                    ? "Trying again shortly"
                    : "Nothing more happens until you try again"}
            </span>
            <Button size="sm" variant="outline" loading={go.isPending} onClick={() => go.mutate()}>
              Try again now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A rewrite that just landed: one quiet row to open the new version. */
export function RewriteReadyRow({
  version,
  kind,
  onOpen,
  className,
}: {
  version: number | null;
  kind: string;
  onOpen: () => void;
  className?: string;
}) {
  const def = MILESTONE_BY_KIND[kind as keyof typeof MILESTONE_BY_KIND];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left hover:bg-muted/30",
        className,
      )}
      data-rewrite-ready
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success text-white">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1 text-[14px]">
        <span className="font-medium">
          {version ? `Version ${version} is ready` : "There's a newer version"}
        </span>
        {def ? <span className="text-muted-foreground"> · {def.title}</span> : null}
      </span>
      <span className="flex shrink-0 items-center text-[13px] font-medium">
        Open <ChevronRight className="h-4 w-4" />
      </span>
    </button>
  );
}
