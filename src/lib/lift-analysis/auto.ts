/**
 * Bar path and bar speed read by themselves, right after a set video lands:
 * from the very file that was sent (still in memory on the phone: nothing is
 * downloaded again, and its times match the coach's copy exactly), one clip
 * at a time, while nothing else is sending, so the athlete just keeps
 * logging. Only for barbell lifts (exercise.ts), only when the plate is
 * found with confidence (otherwise the set video's sheet asks for one tap),
 * and never twice for the same video. A failure leaves nothing behind.
 */
import { analyzeVideo } from "@/lib/lift-analysis/run";
import { analysableExercise, repDirection } from "@/lib/lift-analysis/exercise";
import { hasAnalysis, saveAnalysis } from "@/lib/lift-analysis/queries";
import { setRunning } from "@/lib/lift-analysis/store";
import { getSetVideoJobs, isActiveJob } from "@/lib/set-videos/jobs";

type Auto = { setVideoId: string; file: Blob; exerciseName: string };

const queue: Auto[] = [];
const seen = new Set<string>();
let busy = false;

/** Queue a sent set video for analysis (a no-op for exercises without a bar to follow). */
export function queueLiftAnalysis(job: Auto) {
  if (!job.setVideoId || seen.has(job.setVideoId)) return;
  if (!analysableExercise(job.exerciseName)) return;
  seen.add(job.setVideoId);
  queue.push(job);
  void pump();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      // let the set's own upload and the next clip go first: analysis waits for a quiet moment
      for (let i = 0; i < 60 && getSetVideoJobs().some(isActiveJob); i++) await wait(2_000);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        await new Promise<void>((r) => {
          const on = () => {
            if (document.visibilityState === "visible") {
              document.removeEventListener("visibilitychange", on);
              r();
            }
          };
          document.addEventListener("visibilitychange", on);
        });
      }
      const job = queue.shift()!;
      try {
        if (await hasAnalysis(job.setVideoId)) continue;
        const res = await analyzeVideo({
          source: job.file,
          dirHint: repDirection(job.exerciseName) ?? undefined,
          onProgress: (p) => setRunning(job.setVideoId, p),
        });
        // only a confident read is kept without anyone looking: anything less waits for a tap
        if (res.ok && res.analysis.reps.length > 0)
          await saveAnalysis(job.setVideoId, res.analysis);
      } catch {
        /* nothing kept: the sheet still offers Analyze */
      } finally {
        setRunning(job.setVideoId, null);
      }
      await wait(500);
    }
  } finally {
    busy = false;
  }
}
