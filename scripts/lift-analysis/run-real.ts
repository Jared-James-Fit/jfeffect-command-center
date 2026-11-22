/**
 * Run the engine on a real clip the way the phone does (auto, then the
 * proposal as if confirmed) and print what it found:
 *
 *   npx tsx scripts/lift-analysis/run-real.ts <file.mp4> [lower_first|lift_first] [start] [end]
 */
import { decode } from "./decode";
import * as engine from "../../src/lib/lift-analysis/engine";
import { proposePlate } from "../../src/lib/lift-analysis/detect";

const [file, dirArg, s0, s1] = process.argv.slice(2);
const dir = (dirArg === "lift_first" || dirArg === "lower_first" ? dirArg : undefined) as
  | "lower_first"
  | "lift_first"
  | undefined;
const d = decode(file, 480, {
  start: s0 ? Number(s0) : undefined,
  end: s1 ? Number(s1) : undefined,
});
const span = d.frames[d.frames.length - 1].t - d.frames[0].t;
const samples = engine
  .sampleIndices(d.frames.length, engine.sampleCount(span))
  .map((i) => d.frames[i]);
const t0 = Date.now();
const p = proposePlate(samples);
console.log(
  `${file.split("/").pop()} ${d.w}x${d.h} ${d.fps.toFixed(1)}fps ${span.toFixed(1)}s | proposal ${p.confidence} why=${p.why} edge=${p.edgeShare?.toFixed(2)} key=${p.key ? `${p.key.x.toFixed(0)},${p.key.y.toFixed(0)} a${p.key.a.toFixed(1)} b${p.key.b.toFixed(1)} t${p.key.t.toFixed(2)}` : "-"} cands=${p.candidates.length} (${Date.now() - t0}ms)`,
);
if (p.find) {
  const f: any = p.find;
  console.log(
    `  find: confident=${f.confident} track=${f.track ? `r${f.track.r.toFixed(1)} hits${f.track.hits.length}` : "-"} others=${(f.others ?? []).map((o: any) => `r${o.r.toFixed(0)}/${o.hits.length}`).join(",")} still=${(f.still ?? []).length}`,
  );
}
for (const mode of ["auto", "proposal"] as const) {
  const t1 = Date.now();
  const res = engine.runEngine(d.frames, { seed: { kind: mode }, dirHint: dir });
  if (!res.ok) {
    console.log(`  ${mode}: ${res.why} (${Date.now() - t1}ms)`);
    continue;
  }
  const a = res.analysis;
  console.log(
    `  ${mode}: units=${a.units} reps=${a.reps.length} tracked=${a.quality.tracked} ratio=${a.plate.ratio} view=${a.plate.view} cal=${a.calibration.ok}/${a.calibration.relErr} notes=${a.quality.notes.join(",")} verdict=${a.velocity.accepted ? a.velocity.value : a.velocity.reasons.join(",")} (${Date.now() - t1}ms)`,
  );
  for (const r of a.reps)
    console.log(
      `    rep ${r.dir} ${r.con.start.toFixed(2)}-${r.con.end.toFixed(2)}s rom=${(r.top - r.bottom).toFixed(0)} mcv=${r.mcv.v?.toFixed(3)}(${r.mcv.tier}) peak=${r.peak.v?.toFixed(2)} cov=${r.coverage.toFixed(2)} complete=${r.complete}`,
    );
  if (a.track?.lost.length) console.log(`    lost: ${JSON.stringify(a.track.lost)}`);
}
