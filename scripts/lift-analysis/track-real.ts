/** Finds and follows the plate through a real clip; writes the track as CSV (debugging / validation). */
import { writeFileSync } from "node:fs";
import { decode } from "./decode";
import { findPlate } from "../../src/lib/lift-analysis/find";
import { PlateFollower, bestSeed } from "../../src/lib/lift-analysis/follow";

export function sampleFrames<T extends { t: number }>(frames: T[]): T[] {
  const span = frames[frames.length - 1].t - frames[0].t;
  const n = Math.min(40, Math.max(12, Math.ceil(span * 4)));
  return Array.from(
    { length: n },
    (_, i) => frames[Math.round(((i + 0.5) * (frames.length - 1)) / n)],
  );
}

const [file, out] = process.argv.slice(2);
if (file) {
  const d = decode(file);
  const t0 = Date.now();
  const samples = sampleFrames(d.frames);
  const pf = findPlate(samples);
  const t1 = Date.now();
  if (!pf.track) {
    console.log(file, "no plate", pf.why);
    process.exit(0);
  }
  const seed = bestSeed(pf.track, samples)!;
  const fol = new PlateFollower(seed, pf.track);
  for (const f of d.frames) fol.push(f);
  const t2 = Date.now();
  const pts = fol.points();
  const found = pts.filter((p) => p.found);
  const sc = found.map((p) => p.score).sort((a, b) => a - b);
  console.log(
    `${file.split("/").pop()} find ${t1 - t0}ms follow ${t2 - t1}ms (${((t2 - t1) / pts.length).toFixed(1)}ms/f) ${pf.why} r=${seed.r.toFixed(1)} found ${(found.length / pts.length).toFixed(3)} score p10 ${sc[Math.floor(sc.length * 0.1)]?.toFixed(2)} med ${sc[sc.length >> 1]?.toFixed(2)} rimconf>0.5 ${(found.filter((p) => p.conf > 0.5).length / pts.length).toFixed(2)}`,
  );
  if (out)
    writeFileSync(
      out,
      "t,x,y,found,score,a,b,conf\n" +
        pts
          .map((p) =>
            [
              p.t.toFixed(4),
              p.x.toFixed(2),
              p.y.toFixed(2),
              p.found ? 1 : 0,
              p.score.toFixed(3),
              p.a.toFixed(2),
              p.b.toFixed(2),
              p.conf.toFixed(2),
            ].join(","),
          )
          .join("\n"),
    );
}
