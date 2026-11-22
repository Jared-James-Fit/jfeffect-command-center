/**
 * Smoke test for the on-device pose read in headless Chromium (the app's own
 * runPose, MediaPipe's WebAssembly, the shipped model):
 *   node scripts/lift-analysis/browser/pose-smoke.cjs <dir> <clip.mp4> <start> <end> [barFx barFy]
 * <dir> must hold the clip, vision_wasm_internal.{js,wasm} and models/<model>.task.
 * Prints what was found and writes <clip>.pose.png: the middle frame with its skeleton.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const [dir, clip, s, e, bx, by] = process.argv.slice(2);
const root = path.resolve(__dirname, "../../..");
const urlPlugin = path.join(dir, "url-plugin.cjs");
fs.writeFileSync(
  urlPlugin,
  `module.exports = { name: "url", setup(b) {
    b.onResolve({ filter: /\\?url$/ }, (a) => ({ path: a.path, namespace: "url" }));
    b.onLoad({ filter: /.*/, namespace: "url" }, (a) => ({
      contents: "export default " + JSON.stringify("/" + a.path.replace(/\\?url$/, "").split("/").pop()),
      loader: "js",
    }));
  } };`,
);
const build = path.join(dir, "build.cjs");
fs.writeFileSync(
  build,
  `require(${JSON.stringify(path.join(root, "node_modules/esbuild"))}).build({
    entryPoints: [${JSON.stringify(path.join(__dirname, "pose-entry.ts"))}],
    bundle: true, format: "esm", outfile: ${JSON.stringify(path.join(dir, "bundle.js"))},
    tsconfig: ${JSON.stringify(path.join(root, "tsconfig.json"))},
    plugins: [require(${JSON.stringify(urlPlugin)})], logLevel: "warning",
  }).catch(() => process.exit(1));`,
);
execFileSync("node", [build], { cwd: root, stdio: "inherit" });
fs.writeFileSync(
  path.join(dir, "index.html"),
  '<!doctype html><meta charset="utf-8"><script type="module" src="bundle.js"></script>',
);
const types = { ".js": "text/javascript", ".html": "text/html", ".mp4": "video/mp4", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p)) {
    res.writeHead(404);
    return res.end();
  }
  const st = fs.statSync(p);
  const type = types[path.extname(p)] ?? "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const [a, b] = range.replace("bytes=", "").split("-");
    const start = Number(a);
    const end = b ? Number(b) : st.size - 1;
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
  page.on("pageerror", (err) => console.error("page error:", err.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  await page.goto(`http://localhost:${port}/index.html`);

  if (process.env.POSE_DELEGATE) await page.evaluate((d) => (window.__jfPoseDelegate = d), process.env.POSE_DELEGATE);
  await page.waitForFunction(() => typeof window.pose === "function");
  const bar = bx != null ? { fx: Number(bx), fy: Number(by) } : null;
  const out = await page.evaluate(
    ([u, a, b, br]) => window.pose(u, { start: a, end: b }, br),
    [`/${clip}`, Number(s), Number(e), bar],
  );
  const first = out.first;
  delete out.first;
  console.log(JSON.stringify(out));
  if (first) {
    const names = { 0: "nose", 11: "lSh", 12: "rSh", 13: "lEl", 14: "rEl", 15: "lWr", 16: "rWr", 23: "lHip", 24: "rHip", 25: "lKnee", 26: "rKnee", 27: "lAnk", 28: "rAnk", 31: "lToe", 32: "rToe" };
    console.log(Object.entries(names).map(([j, n]) => `${n} ${first[3 * j].toFixed(3)},${first[3 * j + 1].toFixed(3)} v${first[3 * j + 2].toFixed(2)}`).join(" | "));
  }
  const png = await page.evaluate(([u, t]) => window.drawAt(u, t), [`/${clip}`, (Number(s) + Number(e)) / 2]);
  fs.writeFileSync(path.join(dir, `${clip}.pose.png`), Buffer.from(png.split(",")[1], "base64"));
  console.log("view:", JSON.stringify(await page.evaluate(() => window.lastView)));
  if (process.env.POSE_CLIP) console.log("clip:", JSON.stringify(await page.evaluate(([u]) => window.clip(u, 0.5, 2.0), [`/${clip}`])));
  await browser.close();
  server.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
