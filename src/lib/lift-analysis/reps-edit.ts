/**
 * The athlete's "Not a rep" (pure): a read done again from the track kept on
 * it (raw-track.ts), with the rises they took out left out, so the reps, the
 * set's numbers and whether its velocity can be logged all follow, in an
 * instant and with no video. A rise taken back ("It's a rep") is read again
 * the same way. Older reads keep no track: they're read again by the current
 * engine first (reread.ts), and can be edited after that.
 */
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { DEFAULT_PLATE } from "@/lib/lift-analysis/calibrate";
import { unpackTrack } from "@/lib/lift-analysis/raw-track";

export const canEditReps = (a: LiftAnalysis | null | undefined): boolean =>
  !!a?.track?.raw && !!a.track.keys?.length;

/** The read again with these rises left out (each by when its concentric started, s). */
export function readWithout(a: LiftAnalysis, exclude: number[]): LiftAnalysis | null {
  if (!a.track?.raw) return null;
  const points = unpackTrack(a.track.raw);
  if (!points.length) return null;
  const re = a.track.reread;
  return analyzeTrack(points, {
    plate: {
      mm: a.plate.mm,
      rel: a.plate.confirmed ? 0.005 : DEFAULT_PLATE.rel,
      confirmed: a.plate.confirmed,
    },
    source: a.plate.source,
    seed: { x: a.plate.x, y: a.plate.y, r: a.plate.r, t: a.plate.t },
    frame: a.frame,
    dirHint: re?.dirHint ?? undefined,
    shake: re?.shake != null ? [re.shake] : [],
    size: re?.size ?? null,
    keys: a.track.keys,
    conflicts: a.track.conflicts,
    recovered: a.track.recovered,
    exclude,
  });
}

/** Take a rep out (by its concentric's start), or put back one taken out. */
export function toggleRep(a: LiftAnalysis, conStart: number, out: boolean): LiftAnalysis | null {
  const now = a.exclude ?? [];
  const next = out
    ? [...now.filter((t) => Math.abs(t - conStart) > 0.05), conStart]
    : now.filter((t) => Math.abs(t - conStart) > 0.35);
  return readWithout(a, next);
}
