/**
 * Bar speed as corroboration, never as an override (pure, tested). A set's
 * measured mean concentric velocity is compared with the athlete's OWN
 * load–velocity line for that lift (lift-analysis/velocity-model.ts), fitted
 * from their other sessions only, so a set never vouches for itself:
 *  - as expected: the set's estimate is a little more reliable;
 *  - rated hard (RPE 8+) but clearly faster than their line at that load:
 *    there was more in it, so it's read as a lower bound;
 *  - rated light (RPE ≤ 7.5) but clearly slower: the rating likely ran low,
 *    so it counts less.
 * No universal threshold, no velocity-to-%1RM table. A video read with poor
 * quality or wide uncertainty, a set excluded from speed, or a row with a
 * slow tempo or a pause (intent wasn't maximal) is ignored, and with too few
 * measured sets nothing is said: missing velocity never changes anything.
 */
import { compareToExpected, fitLoadVelocity, predictVelocity, type VelocitySample } from "@/lib/lift-analysis/velocity-model";
import { STRENGTH_RULES as R, LB_PER_KG } from "./rules";

export type VelocityRead = "agrees" | "faster" | "slower" | null;

/** A velocity worth reading: accepted, measured or a confident estimate, maximal intent. */
export function usableVelocity(s: {
  velocity?: number | null;
  velocityQuality?: string | null;
  velocityUncertainty?: number | null;
  tempo?: string | null;
}): number | null {
  const v = Number(s.velocity);
  if (!(v > 0.05 && v < 3)) return null;
  const q = String(s.velocityQuality ?? "").toLowerCase();
  if (q && q !== "measured" && q !== "estimated" && q !== "device") return null;
  if (s.velocityUncertainty != null && Number(s.velocityUncertainty) > R.VELOCITY_MAX_UNCERTAINTY) return null;
  // a written tempo with a slow concentric or a pause (E-P-C-P: "3-1-X-0" is fine, "2-0-3-0" isn't)
  const parts = String(s.tempo ?? "").split(/[-/:\s]+/).filter(Boolean);
  if (parts.length >= 3) {
    const conc = parts[2].toUpperCase();
    if (conc !== "X" && conc !== "0" && conc !== "1") return null;
  }
  return v;
}

type Sample = { i: number; session: string; loadLb: number; reps: number; mcv: number; at: string; effort: number | null };

/** Each set's read against the athlete's own line from their other sessions (index-aligned with `sets`). */
export function velocityReads(
  sets: Array<{
    day: string;
    load: number;
    reps: number;
    effort: number | null;
    velocity?: number | null;
    velocityQuality?: string | null;
    velocityUncertainty?: number | null;
    tempo?: string | null;
    session?: string | null;
  }>,
): VelocityRead[] {
  const samples: Sample[] = [];
  sets.forEach((s, i) => {
    const mcv = usableVelocity(s);
    if (mcv == null || !(s.load > 0) || !(s.reps >= 1)) return;
    samples.push({ i, session: s.session ?? s.day, loadLb: s.load, reps: s.reps, mcv, at: `${s.day}T12:00:00Z`, effort: s.effort });
  });
  const out: VelocityRead[] = sets.map(() => null);
  if (samples.length < 6) return out;
  for (const smp of samples) {
    const others: VelocitySample[] = samples
      .filter((o) => o.session !== smp.session)
      .map((o) => ({ loadKg: o.loadLb / LB_PER_KG, reps: o.reps, mcv: o.mcv, at: o.at, session: o.session }));
    const model = fitLoadVelocity(others, Date.parse(smp.at));
    const p = predictVelocity(model, smp.loadLb / LB_PER_KG, smp.reps);
    if (!p) continue;
    const dev = compareToExpected(smp.mcv, p);
    out[smp.i] = dev === "as_expected" ? "agrees" : dev;
  }
  return out;
}
