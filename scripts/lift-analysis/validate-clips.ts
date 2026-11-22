/**
 * Validate the lift analysis engine on realistic encoded clips (gym-scene.ts):
 *
 *   npx tsx scripts/lift-analysis/validate-clips.ts <dir> [name-filter] [--render] [--mode auto|confirm]
 *
 * Renders any clip that's missing (or all with --render), decodes each with
 * ffmpeg the way the phone does, runs the engine, and scores every rep
 * against the truth. `auto`: the engine finds the plate on its own; `confirm`:
 * as if the athlete confirmed the detected point (the new flow), or tapped it
 * when detection had nothing. Prints a table and writes <dir>/report-<mode>.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode } from "./decode";
import { matchReps, renderGymClip, sceneGeometry } from "./gym-scene";
import { dirOf, SCENARIOS } from "./scenarios";
import * as engine from "../../src/lib/lift-analysis/engine";

const args = process.argv.slice(2);
const dir = args[0];
const filter = args[1] && !args[1].startsWith("--") ? args[1] : "";
const force = args.includes("--render");
// --no-recover: the engine without reading lost stretches again (to measure what it adds)
const recover = !args.includes("--no-recover");
const mode = (args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "auto") as
  | "auto"
  | "confirm";
if (!dir) {
  console.error("usage: validate-clips.ts <dir> [filter] [--render] [--mode auto|confirm]");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

type Row = Record<string, unknown>;

async function main() {
  // what the browser harness needs to know about each clip
  writeFileSync(
    join(dir, "scenes.json"),
    JSON.stringify(
      SCENARIOS.map((s) => ({
        name: s.name,
        dir: dirOf(s.lift),
        lift: s.lift === "sumo" ? "deadlift" : s.lift,
        plateMm: s.plateMm ?? 450,
        width: s.w ?? 720,
      })),
    ),
  );
  const rows: Row[] = [];
  for (const sc of SCENARIOS.filter((s) => !filter || s.name.includes(filter))) {
    const file = join(dir, `${sc.name}.mp4`);
    if (force || !existsSync(file) || !existsSync(`${file}.json`)) {
      const t0 = Date.now();
      await renderGymClip(sc, file);
      console.error(`rendered ${sc.name} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    const truth = JSON.parse(readFileSync(`${file}.json`, "utf8"));
    const d = decode(file);
    const t1 = Date.now();
    const plate = { mm: sc.plateMm ?? 450, rel: 0.005, confirmed: true };
    let res = engine.runEngine(d.frames, {
      seed: { kind: mode === "confirm" ? "proposal" : "auto" },
      dirHint: dirOf(sc.lift),
      lift: sc.lift === "sumo" ? "deadlift" : sc.lift,
      plate,
      recover,
    });
    let tapped = false;
    if (mode === "confirm" && !res.ok) {
      // nothing to preselect: the athlete taps the plate (a frame a second in, on its centre)
      const g = sceneGeometry(sc);
      const k = d.w / g.W;
      const f = d.frames[Math.min(d.frames.length - 1, Math.round(d.fps))];
      const [cx, cy] = g.centerAt(f.t);
      res = engine.runEngine(d.frames, {
        seed: { kind: "tap", t: f.t, x: cx * k, y: cy * k },
        dirHint: dirOf(sc.lift),
        plate,
        recover,
      });
      tapped = true;
    }
    const ms = Date.now() - t1;
    if (!res.ok) {
      rows.push({
        name: sc.name,
        ok: false,
        why: res.why,
        ms,
        confidence: res.proposal?.confidence,
      });
      continue;
    }
    const a = res.analysis;
    const m = matchReps(truth.reps, a.reps);
    const errs = m.filter((x) => x.err != null).map((x) => Math.abs(x.err!));
    rows.push({
      name: sc.name,
      ok: true,
      units: a.units,
      source: tapped ? "tap" : `${res.proposal?.confidence ?? "?"}`,
      tracked: a.quality.tracked,
      repsTrue: truth.reps.length,
      reps: a.reps.length,
      complete: a.reps.filter((r) => r.complete).length,
      lost: (a.track?.lost ?? []).map((l) => `${l.start.toFixed(1)}-${l.end.toFixed(1)}`).join(" "),
      recovered: a.track?.recovered ?? 0,
      vl:
        a.set.velocityLoss.tier === "unavailable"
          ? `— (${a.set.velocityLoss.why})`
          : `${a.set.velocityLoss.v?.toFixed(1)}±${a.set.velocityLoss.u?.toFixed(1)}`,
      found: m.filter((x) => x.got != null).length,
      maxErr: errs.length ? Math.max(...errs) : null,
      meanErr: errs.length ? errs.reduce((s, x) => s + x, 0) / errs.length : null,
      accepted: a.velocity?.accepted ?? null,
      reasons: a.velocity?.reasons?.join(",") ?? "",
      scale: a.calibration.mmPerPxY
        ? Number((a.calibration.mmPerPxY / (truth.mmPerPx * (d.width / d.w))).toFixed(4))
        : null,
      notes: a.quality.notes.join(","),
      ms,
      perRep: m,
    });
  }
  writeFileSync(join(dir, `report-${mode}.json`), JSON.stringify(rows, null, 1));
  for (const r of rows) {
    if (!r.ok) {
      console.log(`${String(r.name).padEnd(22)} REFUSED ${r.why}`);
      continue;
    }
    const per = (r.perRep as ReturnType<typeof matchReps>)
      .map((p) =>
        p.got == null
          ? "  —  "
          : `${p.err! >= 0 ? "+" : ""}${p.err!.toFixed(3)}${p.tier === "measured" ? "" : p.tier === "estimated" ? "≈" : "?"}`,
      )
      .join(" ");
    console.log(
      `${String(r.name).padEnd(22)} ${String(r.units).padEnd(2)} ${String(r.source).padEnd(4)} trk ${(Number(r.tracked) * 100).toFixed(0).padStart(3)}% reps ${r.reps}/${r.repsTrue} (${r.complete} complete) scale ${r.scale ?? "—"} acc ${r.accepted ? "Y" : "n"} | ${per} | ${r.reasons} | lost ${r.lost || "none"} rec ${r.recovered} | VL ${r.vl}`,
    );
  }
}

void main();
