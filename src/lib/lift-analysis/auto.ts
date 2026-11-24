/**
 * Bar path and bar speed read by themselves, right after a set video lands:
 * from the very file that was sent (still in memory on the phone: nothing is
 * downloaded again, and its times match the coach's copy exactly), one clip
 * at a time, while nothing else is sending, so the athlete just keeps
 * logging, on whatever screen they're on. Only for barbell lifts
 * (exercise.ts), and never twice for the same video.
 *
 * Every outcome is kept, so the line under the clip always says where it
 * stands and no phone reads the same video again and again:
 *   - a read: saved (set_video_analysis_save), and the server puts the set's
 *     average velocity on the set when the read passes its rule;
 *   - not sure of the plate: "needs a look", with the ring it would have
 *     used (opening it is one look and Analyze) and the circles worth offering;
 *   - a video this phone can't decode: "couldn't read".
 *
 * A read cut off by the app closing (iOS ends a backgrounded web app) is
 * picked up on the next open (resumeLiftAnalyses): the athlete's own barbell
 * set videos from the last two days with nothing stored yet, read from their
 * link, a few at a time, and at most twice each on this phone.
 *
 * A read an older engine left unfinished or refused is read again by this
 * one (reread.ts rereadPlan, queueLiftReread): on the athlete's next open for
 * their set videos of the last two weeks, and whenever anyone opens one.
 * The new read replaces the old only when it is a read (or the old one was
 * only "needs a look"); a speed already on the set is never touched.
 */
import { supabase } from "@/integrations/supabase/client";
import { readInWorker as analyzeVideo } from "@/lib/lift-analysis/worker-client";
import { analysableExercise, guideLift, repDirection } from "@/lib/lift-analysis/exercise";
import {
  proposalSuggestions,
  saveAnalysis,
  saveNotRead,
} from "@/lib/lift-analysis/queries";
import { setRunning } from "@/lib/lift-analysis/store";
import { ENGINE_VERSION } from "@/lib/lift-analysis/analyze";
import { getSetVideoJobs, isActiveJob } from "@/lib/set-videos/jobs";
import { rereadPlan, type RereadPlan } from "@/lib/lift-analysis/reread";
import type { ShownSeed } from "@/lib/lift-analysis/run";

type Auto = {
  setVideoId: string;
  file: Blob | string;
  exerciseName: string;
  /** Read again: an older engine's read is there (reread.ts). */
  reread?: RereadPlan;
};

const queue: Auto[] = [];
const seen = new Set<string>();
let busy = false;

/** Whether the stored read is already this engine's (or can't be told: then leave it). */
async function readByThisEngine(setVideoId: string): Promise<boolean> {
  const { data, error } = await db
    .from("pl_set_video_analyses")
    .select("engine")
    .eq("set_video_id", setVideoId)
    .maybeSingle();
  if (error) return true;
  return (data as { engine?: string } | null)?.engine === ENGINE_VERSION;
}

/** Queue an older engine's read to be read again by this one (once per video per open of the app). */
export function queueLiftReread(job: Omit<Auto, "reread"> & { plan: RereadPlan }) {
  const key = `re:${job.setVideoId}`;
  if (!job.setVideoId || seen.has(key)) return;
  if (!analysableExercise(job.exerciseName)) return;
  seen.add(key);
  queue.push({
    setVideoId: job.setVideoId,
    file: job.file,
    exerciseName: job.exerciseName,
    reread: job.plan,
  });
  void pump();
}

/** Queue a sent set video for analysis (a no-op for exercises without a bar to follow). */
export function queueLiftAnalysis(job: Auto) {
  if (!job.setVideoId || seen.has(job.setVideoId)) return;
  seen.add(job.setVideoId);
  queue.push(job);
  void pump();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function whenVisible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden")
    return Promise.resolve();
  return new Promise<void>((r) => {
    const on = () => {
      if (document.visibilityState === "visible") {
        document.removeEventListener("visibilitychange", on);
        r();
      }
    };
    document.addEventListener("visibilitychange", on);
  });
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      // let the set's own upload and the next clip go first: analysis waits for a quiet moment
      for (let i = 0; i < 60 && getSetVideoJobs().some(isActiveJob); i++) await wait(2_000);
      await whenVisible();
      const job = queue.shift();
      if (!job) break;
      const re = job.reread;
      let lease: string | null = null;
      try {
        const { data: claim, error: claimError } = await db.rpc("velocity_job_claim", { _video: job.setVideoId });
        if (claimError) throw claimError;
        if (!claim) continue;
        lease = claim.lease_id;
        const started = performance.now();
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 100_000);
        const onHide = () => { if (document.visibilityState === "hidden") abort.abort(); };
        document.addEventListener("visibilitychange", onHide);
        noteTry(re ? rereadKey(job.setVideoId) : job.setVideoId);
        const seed: ShownSeed | undefined =
          re?.mode === "keys" ? { kind: "keys", keys: re.keys } : undefined;
        let res: Awaited<ReturnType<typeof analyzeVideo>>;
        try { res = await analyzeVideo({
          source: job.file,
          seed,
          plate:
            re?.mode === "keys" && re.plateMm
              ? { mm: re.plateMm, rel: 0.005, confirmed: true }
              : undefined,
          dirHint: repDirection(claim.exercise_name) ?? undefined,
          lift: guideLift(claim.exercise_name),
          exclude: re?.mode === "keys" ? re.exclude : undefined,
          onProgress: (p) => setRunning(job.setVideoId, p),
          signal: abort.signal,
        }); } finally { clearTimeout(timer); document.removeEventListener("visibilitychange", onHide); }
        // read again meanwhile by hand (Fix tracking, Start over): theirs wins
        if (re && (await readByThisEngine(job.setVideoId))) continue;
        if (res.ok) {
          await saveAnalysis(job.setVideoId, res.analysis, { lease, computeMs: Math.round(performance.now()-started) });
        } else if (re && re.was === "done") {
          // the old read stays: a doubt from the new engine is never worse than a read
        } else if (
          res.why === "needs_confirm" ||
          res.why === "no_plate" ||
          res.why === "ambiguous"
        ) {
          // not sure enough to read it alone: kept with where it thinks the bar is (its best guess,
          // whatever the doubt), so opening it is one look at one ring and Analyze
          await saveNotRead(job.setVideoId, {
            engine: ENGINE_VERSION,
            status: "needs_tap",
            why: res.why,
            suggestions: proposalSuggestions(res.proposal ?? null),
          }, { lease, computeMs: Math.round(performance.now()-started) });
        } else if (!re && (res.why === "unreadable" || res.why === "too_short")) {
          await saveNotRead(job.setVideoId, {
            engine: ENGINE_VERSION,
            status: "failed",
            why: res.why,
          }, { lease, computeMs: Math.round(performance.now()-started) });
        }
        if (!res.ok && res.why === "cancelled") await db.rpc("velocity_job_fail", { _video: job.setVideoId, _lease: lease, _reason: "Paused; resume when the app is open", _retry: true });
        // cancelled: nothing kept, it's tried again on the next open
      } catch {
        if (lease) await db.rpc("velocity_job_fail", { _video: job.setVideoId, _lease: lease, _reason: "The read could not finish. Try again.", _retry: true });
      } finally {
        seen.delete(job.setVideoId);
        setRunning(job.setVideoId, null);
      }
      await wait(500);
    }
  } finally {
    busy = false;
  }
}

/* ── picking up where a closed app left off ─────────────────────────────── */

const TRIES_KEY = "jf-lift-analysis-tries-v1";
/** At most this many tries of one video on this phone (a clip that keeps the app from finishing isn't fetched forever). */
const MAX_TRIES = 2;
/** Only set videos sent this recently. */
const RESUME_WINDOW_MS = 2 * 24 * 3600_000;
/** And only clips short enough to fetch again without a second thought (a set, not a session). */
const RESUME_MAX_SECONDS = 120;
const RESUME_MAX_PER_OPEN = 3;
/** Older engines' reads: read again for set videos this recent, a couple per open, once or twice each per engine. */
const REREAD_WINDOW_MS = 14 * 24 * 3600_000;
const REREAD_MAX_PER_OPEN = 2;
const rereadKey = (id: string) => `re:${ENGINE_VERSION}:${id}`;

function readTries(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TRIES_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function noteTry(id: string) {
  try {
    const t = readTries();
    t[id] = (t[id] ?? 0) + 1;
    // keep the newest 200
    const keys = Object.keys(t);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete t[k];
    localStorage.setItem(TRIES_KEY, JSON.stringify(t));
  } catch {
    /* no storage: tried once this visit */
  }
}

const db = supabase as any;

/**
 * The athlete's own recent barbell set videos with nothing stored, read from
 * their link (the file left this phone with the app). Never on Save Data.
 */
export async function resumeLiftAnalyses(uid: string): Promise<number> {
  const conn = (navigator as any)?.connection;
  if (conn?.saveData) return 0;
  // RLS returns the signed-in athlete's or coach's authorized pending jobs, regardless of uploader.
  const { data: pending, error: pendingError } = await db.from("set_velocity_jobs")
    .select("set_video_id, exercise_name, available_at, lease_until, status, attempts")
    .in("status", ["queued", "running"]).eq("enabled", true).lt("attempts", 3)
    .order("available_at").limit(20);
  if (pendingError) throw pendingError;
  let recovered = 0;
  for (const p of pending ?? []) {
    if (recovered >= RESUME_MAX_PER_OPEN || seen.has(p.set_video_id) || Date.parse(p.available_at)>Date.now() ||
        (p.status === "running" && Date.parse(p.lease_until)>Date.now())) continue;
    const { data: v, error: videoError } = await db.from("pl_set_videos").select("storage_path").eq("id",p.set_video_id).is("deleted_at",null).maybeSingle();
    if (videoError) throw videoError;
    if (!v?.storage_path) continue;
    const { data: signed, error: signError } = await supabase.storage.from("message-attachments").createSignedUrl(v.storage_path,3600);
    if (signError) throw signError;
    if (!signed?.signedUrl) continue;
    queueLiftAnalysis({ setVideoId:p.set_video_id, file:signed.signedUrl, exerciseName:p.exercise_name });
    recovered++;
  }
  return recovered;

}

