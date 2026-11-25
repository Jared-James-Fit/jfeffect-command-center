/**
 * Whether a read the engine made on its own found the bar (pure). Detection
 * proposes a plate; a "high" one it would read alone, a "medium" one used to
 * wait for the athlete. Either way, what the read measured says whether it
 * was the plate: a plate on a loaded bar, scaled by its own 450 mm, travels a
 * lift's range at a lift's speed, rep after rep, and is followed through the
 * clip. Something else round (a head, a knee, a light, a plate on the floor)
 * scaled as if it were 450 mm gives ranges and speeds no lift has, isn't
 * followed, or never measures its own edge.
 *
 * A read that passes is kept as the engine's own ("auto"); one that doesn't
 * waits for one look from the athlete, with the ring it would have used.
 */
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { MOVEMENT_ROM_MM, type GuideLift } from "@/lib/lift-analysis/exercise";

/** A rep's range (mm) by lift, wide enough for every lifter, every variation. */
export const ROM_BANDS: Record<GuideLift, [number, number]> = {
  bench: [100, 650],
  squat: [250, 950],
  deadlift: [200, 850],
  other: [100, 1000],
};

export type AutoCheck = { ok: boolean; why: string[] };

/**
 * `confidence` is detection's own: a "medium" plate (another round thing
 * moved too, or its edge barely showed) is kept only when the whole set
 * passes every rule for logging its speed (verdict.ts), the strictest
 * self-consistency there is. On the validation clips that turned one wrong
 * read (a ring 32 % too big, scale off by a quarter, plate followed in 82 %
 * of frames) back into "check the bar" and kept every right one.
 */
export function autoReadCheck(
  a: LiftAnalysis,
  lift: GuideLift,
  confidence: "high" | "medium" | "low" = "high",
): AutoCheck {
  const why: string[] = [];
  if (confidence !== "high" && !a.velocity?.accepted)
    why.push("not sure of the plate and the read didn't prove it");
  // A confidently found plate can retain pixel paths and rep timing while awaiting its diameter.
  if (a.units !== "mm" && !a.plate.confirmed && confidence === "high") {
    if (a.quality.tracked >= 0.8 && a.reps.length > 0 && a.reps.every(r => r.complete) &&
        !(a.track?.lost ?? []).some(g => g.end - g.start > 1)) return { ok: true, why: [] };
  }
  if (a.units !== "mm" || !a.calibration.ok) why.push("no scale from the plate's edge");
  else if (a.calibration.relErr > 0.04) why.push("the plate's edge was unclear");
  if (!(a.quality.tracked >= 0.8)) why.push("not followed through the clip");
  const frames = a.series.t.length || 1;
  if ((a.track?.conflicts ?? 0) > 0.05 * frames) why.push("followed two different things");
  if (!a.reps.length) why.push("no reps");
  // the movement's own range when the read knows it (an overhead press, a row, a snatch), else the guide lift's
  const [lo, hi] = a.movement && a.movement.kind !== "other" ? MOVEMENT_ROM_MM[a.movement.kind] : ROM_BANDS[lift];
  for (const r of a.reps) {
    const rom = r.top - r.bottom;
    if (a.units === "mm" && (rom < lo || rom > hi)) {
      why.push(`a rep of ${Math.round(rom)} mm`);
      break;
    }
    const T = r.con.end - r.con.start;
    if (!(T >= 0.2 && T <= 12)) {
      why.push("a press no lift has");
      break;
    }
    const olympic = a.movement?.kind === "olympic";
    if ((r.mcv.v ?? 0) > (olympic ? 2.6 : 2) || (r.peak.v ?? 0) > (olympic ? 3.4 : 3)) {
      why.push("faster than a loaded bar moves");
      break;
    }
  }
  return { ok: why.length === 0, why };
}
