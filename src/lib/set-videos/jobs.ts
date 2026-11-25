/**
 * Set videos on their way up, for whatever is on screen (the set's video
 * cell, its sheet). A tiny store with no heavy imports: the uploader
 * (uploader.ts, loaded only once a video is picked) writes to it, the
 * logger's set rows just read it.
 */
import { useRef, useSyncExternalStore } from "react";

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

/**
 * Progress alone is told at most every PROGRESS_EMIT_MS (Nov 25 2026, T14):
 * an encode or an upload reports dozens of times a second, and every set row
 * on screen used to re-render on each one while the next clip was being
 * filmed or trimmed. Anything else (a state change, a finished clip) is told
 * at once, with any progress waiting.
 */
export const PROGRESS_EMIT_MS = 150;
let progressTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  if (progressTimer != null) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  for (const l of listeners) l();
}

function emitProgress() {
  if (progressTimer != null) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    for (const l of listeners) l();
  }, PROGRESS_EMIT_MS);
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
  // nothing changed (the same rounded progress again): nobody is told
  const keys = Object.keys(patch) as (keyof SetVideoJob)[];
  if (keys.every((k) => Object.is(cur[k], patch[k]))) return cur;
  const next = { ...cur, ...patch };
  jobs = jobs.map((j) => (j.id === id ? next : j));
  if (keys.every((k) => k === "progress" || Object.is(cur[k], patch[k]))) emitProgress();
  else emit();
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

/** The same jobs, element for element. */
export const sameJobs = (a: readonly SetVideoJob[], b: readonly SetVideoJob[]) =>
  a.length === b.length && a.every((j, i) => j === b[i]);

/**
 * Only what one part of the screen needs from the jobs (`key` names what
 * `select` depends on): it re-renders only when that changes, so one clip's
 * progress re-renders its own set, never every set row of the workout.
 */
export function useSetVideoJobsSelect<T>(
  key: string,
  select: (all: SetVideoJob[]) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const cache = useRef<{ src: SetVideoJob[]; key: string; out: T } | null>(null);
  const get = () => {
    const src = jobs;
    const c = cache.current;
    if (c && c.src === src && c.key === key) return c.out;
    const out = selectRef.current(src);
    if (c && c.key === key && isEqual(c.out, out)) {
      cache.current = { src, key, out: c.out };
      return c.out;
    }
    cache.current = { src, key, out };
    return out;
  };
  return useSyncExternalStore(subscribeSetVideoJobs, get, get);
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

/**
 * A clip filmed before its set was saved has no set record yet (`result_id`
 * null): it's on the set by its exercise row and set number until the database
 * links it (`pl_row_results_link_set_videos` when the set is saved, or
 * `set_video_attach` finding the record itself). Only recent ones count, so a
 * repeat of the workout never shows an old unlinked clip.
 */
export const UNLINKED_SET_VIDEO_MS = 18 * 60 * 60 * 1000;

/**
 * Which set: its exercise row, its number, and its record once it has one.
 * Set 0 is the exercise's warm-up, and its record is the warm-up's own
 * (pl_warmup_sets.id, a clip's warmup_id), never a working set's.
 */
export type SetRef = { rowId: string; setIndex: number; resultId: string | null };

/** Is this stored clip on this set: its own record, or (filmed before the set was saved) its row and number. */
export function videoOnSet(
  v: { row_id: string | null; result_id: string | null; warmup_id?: string | null; set_index: number; created_at: string },
  set: SetRef,
  now = Date.now(),
): boolean {
  // a warm-up's clip is only ever on a warm-up, a working set's only on a working set
  if ((v.set_index === 0) !== (set.setIndex === 0)) return false;
  const record = v.set_index === 0 ? (v.warmup_id ?? null) : v.result_id;
  if (record) return !!set.resultId && record === set.resultId;
  return (
    v.row_id === set.rowId &&
    v.set_index === set.setIndex &&
    now - Date.parse(v.created_at) < UNLINKED_SET_VIDEO_MS
  );
}

/** Is this upload for this set: its record when it had one, else its row and set number. */
export function jobOnSet(j: Pick<SetVideoJob, "rowId" | "resultId" | "setIndex">, set: SetRef): boolean {
  if (j.rowId !== set.rowId) return false;
  if ((j.setIndex === 0) !== (set.setIndex === 0)) return false;
  return j.resultId ? j.resultId === set.resultId : j.setIndex === set.setIndex;
}

/** The uploads on one set that haven't landed yet. */
export function jobsForSet(all: SetVideoJob[], set: SetRef): SetVideoJob[] {
  return all.filter((j) => j.state !== "done" && jobOnSet(j, set));
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
