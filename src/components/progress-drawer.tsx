import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCw,
  X,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { useJobs, jobStore, type Job } from "@/lib/progress-jobs";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Persistent progress drawer mounted once at the root.
 *
 * - Collapsed by default as a small pill in the bottom-right.
 * - Auto-expands the first time a job starts; user can collapse again.
 * - Stays out of the way: hidden entirely when there are no jobs.
 * - Non-blocking: the rest of the app remains fully interactive.
 */
export function ProgressDrawer() {
  const jobs = useJobs();
  const [open, setOpen] = React.useState(false);
  const prevCount = React.useRef(0);

  // Auto-expand when a NEW job appears (not on success/dismiss churn).
  React.useEffect(() => {
    if (jobs.length > prevCount.current) setOpen(true);
    prevCount.current = jobs.length;
  }, [jobs.length]);

  if (jobs.length === 0) return null;

  const pending = jobs.filter((j) => j.status === "pending").length;
  const failed = jobs.filter((j) => j.status === "error").length;
  const succeeded = jobs.filter((j) => j.status === "success").length;

  // Aggregate percent across pending determinate jobs (for the pill).
  const determinate = jobs.filter((j) => j.status === "pending" && j.percent != null);
  const aggPercent = determinate.length
    ? Math.round(determinate.reduce((s, j) => s + (j.percent ?? 0), 0) / determinate.length)
    : null;

  return (
    <div
      className={cn(
        "fixed z-[60] right-3 bottom-3 sm:right-4 sm:bottom-4 w-[min(380px,calc(100vw-1.5rem))]",
        "pointer-events-none",
      )}
      aria-live="polite"
    >
      <div className="pointer-events-auto rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-sm overflow-hidden">
        {/* Header pill */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors"
        >
          <div className="relative">
            {pending > 0 ? (
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            ) : failed > 0 ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Activity className="h-3 w-3 text-muted-foreground" />
              {pending > 0
                ? `${pending} in progress${aggPercent != null ? ` · ${aggPercent}%` : ""}`
                : failed > 0
                ? `${failed} failed${succeeded ? ` · ${succeeded} done` : ""}`
                : `${succeeded} completed`}
            </div>
            {pending > 0 && aggPercent != null && (
              <Progress value={aggPercent} className="h-1 mt-1" />
            )}
          </div>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {open && (
          <div className="max-h-[60vh] overflow-y-auto border-t border-border divide-y divide-border">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {(failed > 0 || succeeded > 0) && (
              <div className="p-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => jobStore.clearFinished()}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear finished
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const Icon =
    job.status === "success"
      ? CheckCircle2
      : job.status === "error"
      ? AlertTriangle
      : Loader2;
  const tone =
    job.status === "success"
      ? "text-emerald-500"
      : job.status === "error"
      ? "text-destructive"
      : "text-primary";

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            "h-4 w-4 mt-0.5 shrink-0",
            tone,
            job.status === "pending" && "animate-spin",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground leading-tight truncate">
            {job.title}
          </div>
          {job.description && (
            <div className="text-[11px] text-muted-foreground truncate">{job.description}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => jobStore.dismiss(job.id)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {job.status === "pending" && (
        <>
          {job.percent != null ? (
            <div className="space-y-1">
              <Progress value={job.percent} className="h-1.5" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{job.statusText ?? "Working…"}</span>
                <span>{job.percent}%</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] bg-primary/70" />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {job.statusText ?? "Processing…"}
              </div>
            </div>
          )}

          {job.steps && job.steps.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {job.steps.map((s, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px]",
                    s.done ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <CheckCircle2
                    className={cn("h-3 w-3", s.done ? "text-emerald-500" : "text-muted-foreground/40")}
                  />
                  <span className={cn(s.done && "line-through opacity-70")}>{s.label}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {job.status === "success" && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
            {job.statusText ?? "Done"}
          </div>
          {job.successAction && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={job.successAction.onClick}
            >
              {job.successAction.label}
            </Button>
          )}
        </div>
      )}

      {job.status === "error" && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-destructive">
            {job.error ?? "Action failed"}
          </div>
          {job.retry && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                const r = job.retry;
                jobStore.dismiss(job.id);
                Promise.resolve(r?.()).catch(() => {});
              }}
            >
              <RotateCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}