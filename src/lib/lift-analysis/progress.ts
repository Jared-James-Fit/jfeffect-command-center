/**
 * How far a read has got (pure, tiny): shared by the line under a clip and
 * the full view without pulling the tracking engine into either's bundle.
 */
export type RunStage = "opening" | "finding" | "tracking" | "measuring" | "reading";
export type RunProgress = { stage: RunStage; progress: number };

const STAGES: RunStage[] = ["opening", "finding", "tracking", "measuring", "reading"];
/**
 * Each stage's share of the whole run, from the time each took on the 27
 * validation clips in a browser (Nov 22 2026: finding ~2.8 s, tracking ~7 s,
 * measuring ~1.5 s of ~11 s); within a stage the progress is measured (frames
 * decoded, seconds of the clip followed, plate frames measured), never a timer.
 */
const WEIGHTS: Record<RunStage, number> = {
  opening: 0.02,
  finding: 0.22,
  tracking: 0.62,
  measuring: 0.12,
  reading: 0.02,
};

/** How far through the whole run a stage's progress is (0…1, for one bar). */
export function overallProgress(p: RunProgress): number {
  let done = 0;
  for (const s of STAGES) {
    if (s === p.stage) return Math.min(1, done + WEIGHTS[s] * Math.max(0, Math.min(1, p.progress)));
    done += WEIGHTS[s];
  }
  return done;
}
