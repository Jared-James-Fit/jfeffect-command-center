/**
 * Set videos on their way up, for whatever is on screen (the set's video
 * cell, its sheet). A tiny store with no heavy imports: the uploader
 * (uploader.ts, loaded only once a video is picked) writes to it, the
 * logger's set rows just read it.
 */
import { useSyncExternalStore } from "react";

export type SetVideoJobState =
  /** cutting / shrinking it on the phone */
  | "preparing"
  /** sending it (resumable) */
  | "uploading"
  /** the server reading it back */
  | "checking"
  /** recording it on the set and posting it to the coach chat */
  | "sending"
  | "done"
  | "failed";

export type SetVideoJob = {
  id: string;
  userId: string;
  clientId: string;
  rowId: string;
  dayId: string;
  resultId: string | null;
  setIndex: number;
  exerciseName: string;
  dayTitle: string;
  label: string;
  fileKey: string;
  fileName: string;
  state: SetVideoJobState;
  /** 0–100 */
  progress: number;
  error?: string | null;
  /** Retrying by itself (a dropped connection) vs waiting on a tap. */
  autoRetry?: boolean;
  /** The app was closed before the clip was ready to send: it has to be picked again. */
  needsFile?: boolean;
  /** Set once recorded. */
  setVideoId?: string | null;
  messageId?: string | null;
  /** Its poster once sent (shown on the set until the set's videos are read again). */
  posterPath?: string | null;
  createdAt: number;
};

let jobs: SetVideoJob[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSetVideoJobs(): SetVideoJob[] {
  return jobs;
}

export function subscribeSetVideoJobs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function putSetVideoJob(job: SetVideoJob) {
  const i = jobs.findIndex((j) => j.id === job.id);
  jobs = i >= 0 ? jobs.map((j, k) => (k === i ? job : j)) : [...jobs, job];
  emit();
}

export function patchSetVideoJob(id: string, patch: Partial<SetVideoJob>): SetVideoJob | null {
  const cur = jobs.find((j) => j.id === id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  jobs = jobs.map((j) => (j.id === id ? next : j));
  emit();
  return next;
}

export function dropSetVideoJob(id: string) {
  if (!jobs.some((j) => j.id === id)) return;
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}

/** Every set video job this session knows about (a new array only when something changed). */
export function useSetVideoJobs(): SetVideoJob[] {
  return useSyncExternalStore(subscribeSetVideoJobs, getSetVideoJobs, getSetVideoJobs);
}

/** Still on its way (not sent, not failed). */
export function isActiveJob(j: Pick<SetVideoJob, "state">): boolean {
  return (
    j.state === "preparing" ||
    j.state === "uploading" ||
    j.state === "checking" ||
    j.state === "sending"
  );
}

/** The jobs that belong on one set: same exercise row and the same logged set. */
export function jobsForSet(
  all: SetVideoJob[],
  rowId: string,
  resultId: string | null,
): SetVideoJob[] {
  if (!resultId) return [];
  return all.filter((j) => j.rowId === rowId && j.resultId === resultId && j.state !== "done");
}

/** "Preparing", "Uploading 42%", "Checking", "Sending to your coach". */
export function jobStatusText(
  j: Pick<SetVideoJob, "state" | "progress" | "error" | "autoRetry" | "needsFile">,
): string {
  switch (j.state) {
    case "preparing":
      return "Preparing";
    case "uploading":
      return `Uploading ${Math.max(1, Math.min(99, Math.round(j.progress)))}%`;
    case "checking":
      return "Checking";
    case "sending":
      return "Sending to your coach";
    case "done":
      return "Sent";
    case "failed":
      if (j.needsFile) return "The app closed before it was ready. Pick the video again.";
      if (j.autoRetry) return "Waiting for a connection. It'll carry on by itself.";
      return j.error || "That video didn't send. Tap to try again.";
  }
}
