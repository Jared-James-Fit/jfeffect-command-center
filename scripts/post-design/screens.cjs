/**
 * Paint every fixture with the app's own painters in Chromium and save:
 * grid.png (the profile grid, 3 across at a 390pt phone's size, tiles 3:4)
 * and slides.png (each post's slides, a carousel row each).
 *   node scripts/post-design/screens.cjs <outDir>
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const esbuild = require("esbuild");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../..");
const out = path.resolve(process.argv[2] || "post-design-shots");
fs.mkdirSync(out, { recursive: true });

(async () => {
  const bundle = path.join(out, "harness.js");
  await esbuild.build({
    entryPoints: [path.join(__dirname, "harness-entry.ts")],
    bundle: true,
    outfile: bundle,
    format: "esm",
    platform: "browser",
    alias: { "@": path.join(root, "src") },
    define: { "import.meta.env": JSON.stringify({ VITE_SUPABASE_URL: "http://x", VITE_SUPABASE_PUBLISHABLE_KEY: "x", DEV: false, PROD: true, MODE: "production" }), "process.env.NODE_ENV": '"production"' },
    loader: { ".png": "dataurl", ".svg": "text", ".css": "empty" },
    logLevel: "error",
  });
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") {
      res.setHeader("content-type", "text/html");
      return res.end(`<!doctype html><html><head><style>@font-face{font-family:"Anton";src:url(/fonts/anton-latin-400.woff2)}</style></head><body style="margin:0;background:#000"><script type="module" src="/harness.js"></script></body></html>`);
    }
    const file = url === "/harness.js" ? bundle : path.join(root, "public", url);
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".png") ? "image/png" : "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => typeof window.__paintAll === "function");
  const posts = await page.evaluate(() => window.__paintAll());
  fs.writeFileSync(path.join(out, "posts.json"), JSON.stringify(posts.map((p) => ({ label: p.label, slides: p.slides.length, problems: p.problems ?? [] })), null, 1));
  const bad = posts.filter((p) => p.problems?.length);
  for (const p of bad) console.log("PROBLEMS", p.label, p.problems.join(" | "));
  if (!bad.length) console.log("every slide passed the readability checks");

  // the grid: a 390pt phone, three across, 2pt gap, 3:4 tiles, the card cover-cropped (post-grid.tsx)
  const grid = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const tiles = posts.map((p) => `<div style="aspect-ratio:3/4;overflow:hidden;background:#222"><img src="${p.slides[0]}" style="width:100%;height:100%;object-fit:cover"></div>`).join("");
  await grid.setContent(`<body style="margin:0;background:#000"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">${tiles}</div></body>`);
  await grid.waitForTimeout(300);
  await grid.screenshot({ path: path.join(out, "grid.png"), fullPage: true });

  const rows = posts
    .map((p) => `<div style="margin:0 0 18px"><div style="color:#aaa;font:600 13px system-ui;margin:0 0 6px">${p.label}</div><div style="display:flex;gap:8px">${p.slides.map((s) => `<img src="${s}" style="width:216px;height:270px">`).join("")}</div></div>`)
    .join("");
  const strip = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await strip.setContent(`<body style="margin:16px;background:#111">${rows}</body>`);
  await strip.waitForTimeout(300);
  await strip.screenshot({ path: path.join(out, "slides.png"), fullPage: true });
  await browser.close();
  server.close();
  console.log("wrote", out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
