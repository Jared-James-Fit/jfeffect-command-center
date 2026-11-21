/**
 * Run the app's browser pipeline (mediabunny + WebCodecs, the phone's path)
 * on validation clips in headless Chromium and score each rep against the truth:
 *   node scripts/lift-analysis/browser/run.cjs <clips dir> [filter] [--mode auto|confirm]
 * auto: detection alone (read only when it's sure); confirm: as if the athlete
 * confirmed the ring detection preselected.
 * Serves <clips dir> on a local port; bundles entry.ts with esbuild first.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const [dir, filterArg, ...rest] = process.argv.slice(2);
const filter = filterArg && !filterArg.startsWith("--") ? filterArg : "";
const all = process.argv.slice(2);
const mode = all.includes("--mode") ? all[all.indexOf("--mode") + 1] : "auto";
const root = path.resolve(__dirname, "../../..");
execFileSync(
  path.join(root, "node_modules/.bin/esbuild"),
  [
    path.join(__dirname, "entry.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${path.join(dir, "bundle.js")}`,
    `--tsconfig=${path.join(root, "tsconfig.json")}`,
    "--log-level=warning",
  ],
  { cwd: root, stdio: "inherit" },
);
fs.writeFileSync(
  path.join(dir, "index.html"),
  '<!doctype html><meta charset="utf-8"><script type="module" src="bundle.js"></script>',
);

const scenes = require(path.join(dir, "scenes.json"));
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p)) {
    res.writeHead(404);
    return res.end();
  }
  const st = fs.statSync(p);
  const type = p.endsWith(".js")
    ? "text/javascript"
    : p.endsWith(".html")
      ? "text/html"
      : p.endsWith(".mp4")
        ? "video/mp4"
        : "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace("bytes=", "").split("-");
    const start = Number(s);
    const end = e ? Number(e) : st.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes" });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => typeof window.analyze === "function");
  const rows = [];
  for (const sc of scenes.filter((s) => !filter || s.name.includes(filter))) {
    const truth = JSON.parse(fs.readFileSync(path.join(dir, `${sc.name}.mp4.json`), "utf8"));
    const out = await page.evaluate(
      ([url, opts]) => window.analyze(url, opts),
      [
        `/${sc.name}.mp4`,
        {
          dirHint: sc.dir,
          plate: { mm: sc.plateMm, rel: 0.005, confirmed: true },
          seed: { kind: mode === "confirm" ? "proposal" : "auto" },
        },
      ],
    );
    const res = out.res;
    const conf = res.proposal ? res.proposal.confidence : "-";
    if (!res.ok) {
      rows.push({ name: sc.name, ok: false, why: res.why, ms: out.ms });
      console.log(
        `${sc.name.padEnd(22)} REFUSED ${res.why} ${conf} (${out.ms} ms) footage ${((res.proposal && res.proposal.footage) || []).join(",")}`,
      );
      continue;
    }
    const a = res.analysis;
    const per = truth.reps.map((tr) => {
      const r = a.reps.find((x) => x.con.start < tr.end && x.con.end > tr.start);
      return {
        true: tr.mcv / 1000,
        got: r ? r.mcv.v : null,
        tier: r ? r.mcv.tier : "missing",
        err: r && r.mcv.v != null ? r.mcv.v - tr.mcv / 1000 : null,
      };
    });
    const scale = a.calibration.mmPerPxY
      ? a.calibration.mmPerPxY / (truth.mmPerPx * (sc.width / a.frame.w))
      : null;
    rows.push({
      name: sc.name,
      ok: true,
      ms: out.ms,
      tracked: a.quality.tracked,
      units: a.units,
      source: a.plate.source,
      reps: a.reps.length,
      repsTrue: truth.reps.length,
      scale,
      accepted: a.velocity && a.velocity.accepted,
      reasons: a.velocity ? a.velocity.reasons : [],
      notes: a.quality.notes,
      per,
    });
    const perS = per
      .map((p) =>
        p.err == null
          ? "  —  "
          : `${p.err >= 0 ? "+" : ""}${p.err.toFixed(3)}${p.tier === "measured" ? "" : p.tier === "estimated" ? "≈" : "?"}`,
      )
      .join(" ");
    console.log(
      `${sc.name.padEnd(22)} ${a.units} ${conf.padEnd(6)} trk ${String(Math.round(a.quality.tracked * 100)).padStart(3)}% reps ${a.reps.length}/${truth.reps.length} scale ${scale ? scale.toFixed(4) : "—"} acc ${a.velocity && a.velocity.accepted ? "Y" : "n"} ${out.ms} ms | ${perS} | ${(a.velocity ? a.velocity.reasons : []).join(",")} | footage ${((res.proposal && res.proposal.footage) || []).join(",")}`,
    );
  }
  fs.writeFileSync(path.join(dir, `browser-report-${mode}.json`), JSON.stringify(rows, null, 1));
  await browser.close();
  server.close();
})();
