/** Plain-English titles and one-line summaries for support_alerts rows. */

const ERROR_TYPE_LABELS: Record<string, string> = {
  workout_load_failure: "Workout logger failed to load",
  workout_sync_failure: "Workout didn't sync",
  workout_sync_stuck: "Workout sync stuck",
  empty_workout: "Empty workout",
  progress_submission: "Progress check-in problem",
  missing_maxes: "Missing maxes",
  missing_client_maxes: "Missing maxes",
  scheduled_jobs_failing: "Scheduled jobs failing",
  google_calendar_setup: "Google Calendar setup needs fixing",
};

const STATUS_BREAKDOWN_LABELS: Record<string, string> = {
  "404": "not found",
  "401": "unauthorized",
  "403": "forbidden",
  "500": "server error",
  "502": "bad gateway",
  "503": "unavailable",
  "no response": "no response",
};

export function titleFor(alert: any): string {
  return ERROR_TYPE_LABELS[alert.error_type] ?? String(alert.error_type ?? "Alert").replace(/_/g, " ");
}

/** One plain-English line for the list; the raw message lives under Details. */
export function summaryFor(alert: any): string {
  const d = (alert.details ?? {}) as any;
  if (alert.error_type === "scheduled_jobs_failing" && typeof d.http_failed === "number") {
    const parts = Object.entries((d.status_breakdown ?? {}) as Record<string, number>)
      .map(([code, n]) => `${n} ${STATUS_BREAKDOWN_LABELS[code] ?? `HTTP ${code}`}`);
    const cron = Number(d.cron_failed_runs) > 0 ? `${d.cron_failed_runs} cron run(s) errored` : null;
    return [
      `${d.http_failed} of ${d.http_total} calls failed in the last hour`,
      parts.length ? parts.join(", ") : null,
      cron,
    ].filter(Boolean).join(" · ");
  }
  const msg = String(alert.error_message ?? "").split("\n")[0].trim();
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg || "No details provided";
}
