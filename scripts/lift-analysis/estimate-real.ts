/**
 * The server's estimate (estimate.ts) on a real clip, with what each
 * candidate gave:
 *
 *   npx tsx scripts/lift-analysis/estimate-real.ts <file> "<exercise>" [logged reps]
 *
 * Decodes like the phone (decode.ts) and, for the plate's edges, the same
 * frames at twice the working size.
 */
import { decode } from "./decode";
import { estimateRead, circleSeeds, everyNth } from "../../src/lib/lift-analysis/estimate";
import { movementOf, repDirection } from "../../src/lib/lift-analysis/exercise";

const [file, ex, repsArg] = process.argv.slice(2);
const d = decode(file, 480, { end: 75 });
const t0 = Date.now();
const res = estimateRead(d.frames, {
  dirHint: repDirection(ex) ?? undefined,
  movement: movementOf(ex),
  expectedReps: repsArg ? Number(repsArg) : null,
  extraSeeds: circleSeeds(everyNth(d.frames, 4).slice(0, 40)),
});
console.log(`${file.split("/").pop()} ${ex} logged=${repsArg ?? "-"} ${((Date.now() - t0) / 1000).toFixed(1)}s ok=${res.ok}`);
for (const t of res.tried)
  console.log(`  ${t.from.padEnd(18)} reps=${t.reps}/${t.complete} tracked=${t.tracked.toFixed(2)} ${t.accepted ? `ACCEPT ${t.value}` : t.why.join(",")}`);
const a = res.ok ? res.analysis : res.best;
if (a) {
  console.log(`  view=${a.plate.view} ratio=${a.plate.ratio.toFixed(2)} cal=${a.calibration.ok} rel=${a.calibration.relErr.toFixed(3)} mm/px=${a.calibration.mmPerPxY?.toFixed(2)} v=${a.velocity.value} tier=${a.velocity.tier}`);
  for (const r of a.reps)
    console.log(`    rep ${r.con.start.toFixed(2)}-${r.con.end.toFixed(2)} rom=${(r.top - r.bottom).toFixed(0)} mcv=${r.mcv.v?.toFixed(3)} (${r.mcv.tier}) complete=${r.complete}`);
}
