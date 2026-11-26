/**
 * Builds the page the server's reader drives (scripts/velocity-worker/page-entry.ts)
 * into <out>: bundle.js, index.html, MediaPipe's WebAssembly runtime and the
 * pose model, so the body read needs nothing from the internet.
 *   node scripts/velocity-worker/bundle.mjs <out-dir>
 * Vite's `?url` imports (the WebAssembly files) become the file's own name at
 * the page's root, which is where they're copied.
 */
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] ?? "/tmp/vw-page");
mkdirSync(join(out, "models"), { recursive: true });

const urlPlugin = {
  name: "url",
  setup(b) {
    b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "url" }));
    b.onLoad({ filter: /.*/, namespace: "url" }, (a) => ({
      contents: `export default ${JSON.stringify("/" + a.path.replace(/\?url$/, "").split("/").pop())}`,
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [join(root, "scripts/velocity-worker/page-entry.ts")],
  bundle: true,
  format: "esm",
  outfile: join(out, "bundle.js"),
  tsconfig: join(root, "tsconfig.json"),
  plugins: [urlPlugin],
  logLevel: "warning",
});

const wasmDir = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) copyFileSync(join(wasmDir, f), join(out, f));
const model = join(root, "public/models/pose_landmarker_full.task");
if (!existsSync(model)) throw new Error("public/models/pose_landmarker_full.task is missing");
copyFileSync(model, join(out, "models/pose_landmarker_full.task"));
writeFileSync(join(out, "index.html"), '<!doctype html><meta charset="utf-8"><script type="module" src="bundle.js"></script>');
console.log("page bundled");
