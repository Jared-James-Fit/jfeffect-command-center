// Singleton in-memory upload queue for lift videos.
//
// Goal: make Send Video feel instant. The lift_videos DB row is created
// immediately (with upload_status="Uploading"), and the actual file is
// uploaded straight to Supabase Storage (the primary, fast, resumable
// destination). Google Drive is no longer in the client upload path — a
// background server job archives the file to Drive afterwards.
//
// Concurrency: 1 (sequential). iPhone Safari/PWA can't be trusted to keep a
// real background upload going if the user navigates away — we surface that
// via the active() helper so the page can fire a beforeunload warning.

import { uploadLiftFileToStorage } from "@/lib/lift-video-storage-upload";
import { useSyncExternalStore } from "react";

type ServerFn = (args: { data: any }) => Promise<any>;

export type LiftUploadState =
  | { status: "queued"; progress: 0; fileName: string }
  | { status: "uploading"; progress: number; fileName: string }
  | { status: "done"; progress: 100; fileName: string }
  | { status: "failed"; progress: number; fileName: string; error: string };

export type LiftUploadJob = {
  videoId: string;
  clientId: string;
  clientName: string | null | undefined;
  file: File;
  index: number;
  total: number;
  batchNote: string | null;
  perClipNote: string | null;
  urgent: boolean;
  painNote: string | null;
  userId: string;
  updateFn: ServerFn;
};

const states = new Map<string, LiftUploadState>();
const listeners = new Set<() => void>();
const queue: LiftUploadJob[] = [];
let running = false;

function notify() { for (const l of listeners) l(); }
function setState(videoId: string, s: LiftUploadState) {
  states.set(videoId, s);
  notify();
}

export function enqueueLiftUpload(job: LiftUploadJob) {
  setState(job.videoId, { status: "queued", progress: 0, fileName: job.file.name });
  queue.push(job);
  void runQueue();
}

async function runQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      await processJob(job);
    }
  } finally {
    running = false;
    notify();
  }
}

async function processJob(job: LiftUploadJob) {
  setState(job.videoId, { status: "uploading", progress: 0, fileName: job.file.name });
  try {
    const res = await uploadLiftFileToStorage({
      file: job.file,
      userId: job.userId,
      onProgress: (pct) =>
        setState(job.videoId, { status: "uploading", progress: pct, fileName: job.file.name }),
    });
    await job.updateFn({ data: {
      id: job.videoId,
      video_storage_path: res.path,
      video_source: "upload",
      file_type: res.mimeType,
      file_size_bytes: res.sizeBytes,
      upload_status: "Uploaded",
      playback_error: null,
      status: "Awaiting Review",
      archive_status: "pending",
      archive_next_attempt_at: new Date().toISOString(),
    }});
    setState(job.videoId, { status: "done", progress: 100, fileName: job.file.name });
    // Clear after a moment so the UI falls back to row.upload_status.
    setTimeout(() => { states.delete(job.videoId); notify(); }, 4000);
  } catch (e: any) {
    const message = (e?.message ?? String(e ?? "Upload failed")).replace(/^\[[^\]]+\]\s*/, "");
    setState(job.videoId, { status: "failed", progress: 0, fileName: job.file.name, error: message });
    try {
      await job.updateFn({ data: {
        id: job.videoId,
        upload_status: "Upload Failed",
        playback_error: message.slice(0, 500),
      }});
    } catch { /* best-effort */ }
  }
}

// React subscription helpers --------------------------------------------------

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useLiftUploadState(videoId: string | null | undefined): LiftUploadState | null {
  return useSyncExternalStore(
    subscribe,
    () => (videoId ? states.get(videoId) ?? null : null),
    () => null,
  );
}

export function useLiftUploadActiveCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => {
      let n = 0;
      for (const s of states.values()) if (s.status === "queued" || s.status === "uploading") n++;
      return n;
    },
    () => 0,
  );
}

export function hasActiveUploads(): boolean {
  for (const s of states.values()) if (s.status === "queued" || s.status === "uploading") return true;
  return false;
}

// Retry a previously failed upload. Caller must re-supply the File (browser
// can't persist it across reload).
export function retryLiftUpload(job: LiftUploadJob) {
  enqueueLiftUpload(job);
}