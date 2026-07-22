/**
 * Predicted Best Performance Window.
 *
 * From current-block week-by-week signals plus prior blocks' peak weeks,
 * estimate which upcoming week is most likely to produce the best output.
 * Hides entirely when there isn't enough history.
 */

export interface BlockWeekSignal {
  block_id: string;
  week_index: number;
  /** average e1RM (lb) across working sets that week */
  avg_e1rm?: number | null;
  /** average session RPE that week */
  avg_rpe?: number | null;
  /** total volume that week */
  volume?: number | null;
  /** derived recovery score mean for the week */
  avg_recovery?: number | null;
  /** number of scored/completed workouts in the week */
  workouts?: number | null;
}

export interface PredictedWindow {
  week: number;
  confidence: "High" | "Moderate";
  rationale: string;
}

/**
 * Determine each block's peak week (highest avg_e1rm; ties broken by
 * recovery, then completion). Returns null if no valid peak week.
 */
function peakWeek(weeks: BlockWeekSignal[]): number | null {
  const valid = weeks.filter((w) => (w.avg_e1rm ?? 0) > 0);
  if (!valid.length) return null;
  const best = valid.reduce((b, w) => {
    if ((w.avg_e1rm ?? 0) > (b.avg_e1rm ?? 0)) return w;
    if ((w.avg_e1rm ?? 0) === (b.avg_e1rm ?? 0) && (w.avg_recovery ?? 0) > (b.avg_recovery ?? 0)) return w;
    return b;
  });
  return best.week_index;
}

export function predictBestWindow(
  currentBlockWeeks: BlockWeekSignal[],
  priorBlocksWeeks: BlockWeekSignal[][],
): PredictedWindow | null {
  // Prior peaks
  const priorPeaks = priorBlocksWeeks
    .map(peakWeek)
    .filter((n): n is number => n != null);

  const currentValid = currentBlockWeeks.filter((w) => (w.workouts ?? 0) > 0);
  if (currentValid.length < 2) return null;

  // Current trend: is avg_e1rm still climbing? Compare last vs first half.
  const half = Math.floor(currentValid.length / 2);
  const firstHalf = currentValid.slice(0, half).map((w) => w.avg_e1rm ?? 0);
  const lastHalf = currentValid.slice(-half).map((w) => w.avg_e1rm ?? 0);
  const climbing =
    lastHalf.length && firstHalf.length &&
    lastHalf.reduce((s, n) => s + n, 0) / lastHalf.length >
      firstHalf.reduce((s, n) => s + n, 0) / firstHalf.length;

  // Most common prior peak
  let predictedWeek: number | null = null;
  if (priorPeaks.length >= 1) {
    const counts = new Map<number, number>();
    for (const p of priorPeaks) counts.set(p, (counts.get(p) ?? 0) + 1);
    const [wk, cnt] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    predictedWeek = wk;
    const agree = cnt;
    if (agree >= 2 && climbing) {
      return {
        week: predictedWeek,
        confidence: "High",
        rationale: `Peak in ${agree} prior blocks · trend still climbing`,
      };
    }
    if (agree >= 1) {
      return {
        week: predictedWeek,
        confidence: "Moderate",
        rationale: `Similar to your typical peak week`,
      };
    }
  }

  // Fallback: infer from current trend only.
  if (climbing && currentValid.length >= 3) {
    const currentPeak = peakWeek(currentValid) ?? currentValid[currentValid.length - 1].week_index;
    // If the current best is late in the block, extrapolate one week forward.
    return {
      week: currentPeak + 1,
      confidence: "Moderate",
      rationale: "Extrapolated from your current block trend",
    };
  }

  return null;
}