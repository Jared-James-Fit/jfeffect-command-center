/**
 * How far a read has got (pure, tiny): shared by the line under a clip and
 * the full view without pulling the tracking engine into either's bundle.
 */
export type RunStage = "opening" | "finding" | "tracking" | "measuring" | "reading";
export type RunProgress = { stage: RunStage; progress: number };

const STAGES: RunStage[] = ["opening", "finding", "tracking", "measuring", "reading"];
/** Each stage's share of the whole run: following the bar through every frame is most of it. */
const WEIGHTS: Record<RunStage, number> = {
  opening: 0.04,
  finding: 0.14,
  tracking: 0.7,
  measuring: 0.08,
  reading: 0.04,
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
