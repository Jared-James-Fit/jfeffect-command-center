// Downloads every Lovable-hosted image the site references (src/assets/**/*.asset.json),
// records its real size, and writes resized WebP copies for the app to ship itself.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire("/tmp/tools/");
const sharp = require("sharp");

const ORIGIN = "https://jfeffect.com";
const OUT = ".perf/out/img";
fs.mkdirSync(OUT, { recursive: true });
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".asset.json")) files.push(p);
  }
})("src/assets");

const WIDTHS = [400, 600, 800, 1000, 1200, 1600];
const report = [];
for (const f of files) {
  const meta = JSON.parse(fs.readFileSync(f, "utf8"));
  const rel = f.replace(/^src\/assets\//, "").replace(/\.asset\.json$/, "");
  const base = rel.replace(/\.(png|jpe?g)$/i, "").replace(/\//g, "__");
  const res = await fetch(ORIGIN + meta.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const entry = { file: f, url: meta.url, status: res.status, bytes: buf.length, cacheControl: res.headers.get("cache-control"), contentType: res.headers.get("content-type"), outputs: [] };
  if (res.ok) {
    const img = sharp(buf, { failOn: "none" });
    const m = await img.metadata();
    entry.width = m.width; entry.height = m.height; entry.hasAlpha = m.hasAlpha;
    fs.writeFileSync(path.join(OUT, `${base}.orig${path.extname(rel)}`), buf);
    for (const w of WIDTHS) {
      if (w > m.width) continue;
      const out = path.join(OUT, `${base}-${w}.webp`);
      await sharp(buf).resize({ width: w }).webp({ quality: 78, effort: 6 }).toFile(out);
      entry.outputs.push({ w, bytes: fs.statSync(out).size });
    }
    const out = path.join(OUT, `${base}-full.webp`);
    await sharp(buf).webp({ quality: 80, effort: 6 }).toFile(out);
    entry.outputs.push({ w: m.width, full: true, bytes: fs.statSync(out).size });
  }
  report.push(entry);
  console.log(entry.status, entry.width, entry.height, entry.bytes, f);
}
// Does the host resize images itself? (informational only)
const probe = report.find((r) => r.status === 200);
if (probe) {
  for (const u of [`/cdn-cgi/image/width=400,format=webp${probe.url}`, `${probe.url}?width=400`, `${probe.url}?w=400&format=webp`]) {
    try {
      const r = await fetch(ORIGIN + u);
      const b = Buffer.from(await r.arrayBuffer());
      report.push({ probe: u, status: r.status, bytes: b.length, contentType: r.headers.get("content-type") });
    } catch (e) { report.push({ probe: u, error: String(e) }); }
  }
}
fs.writeFileSync(".perf/out/images.json", JSON.stringify(report, null, 2));
