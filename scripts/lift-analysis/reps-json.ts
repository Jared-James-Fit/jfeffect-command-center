/** The engine's reps for a real clip as JSON (validation): npx tsx scripts/lift-analysis/reps-json.ts <clip> <squat|bench|deadlift> */
import { decode } from "./decode";
import { runEngine } from "../../src/lib/lift-analysis/engine";

const [file, lift, tx, ty, tt] = process.argv.slice(2);
const dirHint = lift === "deadlift" ? "lift_first" : "lower_first";
const d = decode(file);
const seed = tx ? { kind: "tap" as const, x: Number(tx), y: Number(ty), t: Number(tt) } : undefined;
const r = runEngine(d.frames, { dirHint, seed });
if (!r.ok) {
  console.log(JSON.stringify({ ok: false, why: r.why }));
} else {
  const a = r.analysis;
  console.log(
    JSON.stringify({
      ok: true,
      units: a.units,
      fps: a.fps,
      tracked: a.quality.tracked,
      notes: a.quality.notes,
      cal: a.calibration,
      plate: a.plate,
      reps: a.reps.map((p) => ({
        n: p.n,
        complete: p.complete,
        con: p.con,
        mcv: p.mcv,
        peak: p.peak,
        rom: p.rom,
        coverage: p.coverage,
      })),
      set: { mean: a.set.meanMcv, loss: a.set.velocityLoss, reps: a.set.reps },
      velocity: a.velocity,
    }),
  );
}
