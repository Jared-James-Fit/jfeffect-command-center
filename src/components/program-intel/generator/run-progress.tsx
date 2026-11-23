/**
 * How far along a Generate Next Program run is: a bar, the share done and about how long is left,
 * and what the model on the step now is doing when it's slower than usual (run-eta.ts, which
 * holds the usual times and the backup rule). Ticks every second while a run works.
 */
import { useEffect, useState } from "react";
import { durationWords, elapsedWords, modelName, runEta, type RunEta, type RunJob } from "@/lib/program-intel/run-eta";

/** The run's estimate, worked out again every second while it works (null once it's done). */
export function useRunEta(job: RunJob | null | undefined): RunEta | null {
  const working = !!job && (job.status === "pending" || job.status === "running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);
  return job && working ? runEta(job, now) : null;
}

/** "38% · about 6 min left", or "38% · taking longer than usual". */
export function etaLine(eta: RunEta): string {
  const unsure = eta.queuedMs != null && !eta.backup ? "waiting on OpenAI" : "taking longer than usual";
  return `${eta.pct}% · ${eta.remainingMs == null ? unsure : `${durationWords(eta.remainingMs)} left`}`;
}

/** What the model on the step now is doing, in a line (only when there's a model on it). */
export function stepLine(eta: RunEta): string | null {
  if (!eta.model) return null;
  const name = modelName(eta.model);
  if (eta.queuedMs != null && !eta.backup) return `Waiting for OpenAI to start ${name} · ${elapsedWords(eta.queuedMs)} in their queue`;
  const usual = `usually ${durationWords(eta.stepTypicalMs).replace(/^about /, "~")}`;
  if (eta.backup) {
    return `${name} is slower than usual (${elapsedWords(eta.stepElapsedMs)}), so ${modelName(eta.backup.model)} is writing it too (${elapsedWords(eta.backup.elapsedMs)} in). Whichever answers first is used.`;
  }
  if (eta.stepElapsedMs < 20_000) return `${name} started`;
  if (!eta.slow) return `${name} thinking · ${elapsedWords(eta.stepElapsedMs)} (${usual})`;
  return `${name} is taking longer than usual · ${elapsedWords(eta.stepElapsedMs)} (${usual}).${eta.backupAtMs != null && eta.stepElapsedMs < eta.backupAtMs ? ` If it hasn't answered by ${Math.round(eta.backupAtMs / 60_000)} min, a second model starts beside it and the first answer is used.` : ""}`;
}

export function RunProgressBar({ eta }: { eta: RunEta }) {
  return (
    <div className="space-y-1" data-testid="gen-eta">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={eta.pct}
      >
        <div className="h-full rounded-full bg-foreground transition-[width] duration-1000 ease-linear" style={{ width: `${eta.pct}%` }} />
      </div>
      <div className="text-[12px] tabular-nums text-muted-foreground" data-testid="gen-eta-line">
        {etaLine(eta)}
      </div>
    </div>
  );
}
