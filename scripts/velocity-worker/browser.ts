/**
 * The phone's own reading pipeline (src/lib/lift-analysis/run.ts: mediabunny
 * and WebCodecs, the plate engine) in headless Chromium, for the server's
 * reader. The page is scripts/lift-analysis/browser/entry.ts bundled by the
 * workflow (PAGE_BUNDLE_DIR); clips are served to it from this machine only.
 */
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve, sep } from "node:path";
import type { LiftAnalysis } from "../../src/lib/lift-analysis/analyze";
import type { Movement, GuideLift } from "../../src/lib/lift-analysis/exercise";
import type { PackedPose } from "../../src/lib/lift-analysis/pose/pose-pack";

export type BrowserRead =
  | { ok: true; analysis: LiftAnalysis }
  | { ok: false; why: string; analysis?: undefined };

export type BodyRead =
  | {
      ok: true;
      ms: number;
      model: string;
      delegate: "GPU" | "CPU";
      fps: number;
      frames: number;
      found: number;
      packed: PackedPose;
    }
  | { ok: false; why: string; ms?: number };

export type BrowserReader = {
  analyze: (
    file: string,
    opts: { dirHint?: "lower_first" | "lift_first"; lift: GuideLift; movement: Movement },
  ) => Promise<BrowserRead>;
  /** The athlete's body over a window of the clip (the app's own runPose), packed for storage. */
  readBody: (
    file: string,
    opts: {
      window: { start: number; end: number };
      series?: { t: number[]; x: (number | null)[]; y: (number | null)[] } | null;
    },
  ) => Promise<BodyRead>;
  close: () => Promise<void>;
};

const PAGE_TIMEOUT_MS = 8 * 60_000;
/** The body read over a set's window takes ~20-60 s on a runner's CPU; past this it's given up. */
const BODY_TIMEOUT_MS = 6 * 60_000;

const CONTENT_TYPES: Record<string, string> = {
  js: "text/javascript",
  html: "text/html",
  wasm: "application/wasm",
  task: "application/octet-stream",
};

/** A promise that rejects with "timeout" after ms, its timer cleared once the work settles (never holding the process open). */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export async function startBrowser(): Promise<BrowserReader> {
  const dir = process.env.PAGE_BUNDLE_DIR;
  if (!dir || !existsSync(join(dir, "bundle.js")))
    throw new Error("PAGE_BUNDLE_DIR has no bundle.js");
  if (!existsSync(join(dir, "index.html")))
    writeFileSync(
      join(dir, "index.html"),
      '<!doctype html><meta charset="utf-8"><script type="module" src="bundle.js"></script>',
    );
  let clip = "";
  const root = resolve(dir);
  // what a request may read: the clip being read, or a file inside the page's folder (never outside it)
  const fileFor = (url: string): string | null => {
    let u: string;
    try {
      u = decodeURIComponent(url.split("?")[0]);
    } catch {
      return null;
    }
    if (u.includes("\0")) return null;
    if (u === "/clip.mp4") return clip || null;
    const p = resolve(root, "." + u);
    if (p !== root && !p.startsWith(root + sep)) return null;
    try {
      return statSync(p).isFile() ? p : null;
    } catch {
      return null;
    }
  };
  const server: Server = createServer((req, res) => {
    try {
      const p = fileFor(req.url ?? "/");
      if (!p) {
        res.writeHead(404);
        return res.end();
      }
      const size = statSync(p).size;
      const type =
        p === clip
          ? "video/mp4"
          : (CONTENT_TYPES[p.split(".").pop() ?? ""] ?? "application/octet-stream");
      const send = (stream: ReturnType<typeof createReadStream>) => {
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      };
      const range = req.headers.range;
      if (range) {
        const [a, b] = range.replace("bytes=", "").split("-");
        const start = Math.max(0, Number(a) || 0);
        const end = Math.min(size - 1, b ? Number(b) || size - 1 : size - 1);
        if (start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          return res.end();
        }
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
        });
        return send(createReadStream(p, { start, end }));
      }
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": size,
        "Accept-Ranges": "bytes",
      });
      send(createReadStream(p));
    } catch {
      // a bad request never takes the worker down
      try {
        res.writeHead(500);
        res.end();
      } catch {
        res.destroy();
      }
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  // playwright is CommonJS: imported as a module its exports sit on `default`
  const pw: any = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright's chromium isn't available");
  // a browser that crashed or disconnected is started again for the next job (a dead one fails every job after it)
  let browser = await chromium.launch();
  const newPage = async () => {
    if (!browser.isConnected()) {
      await browser.close().catch(() => undefined);
      browser = await chromium.launch();
    }
    return browser.newPage();
  };

  return {
    async analyze(file, opts) {
      clip = file;
      let page: any = null;
      try {
        page = await newPage();
        await page.goto(`http://127.0.0.1:${port}/index.html`);
        await page.waitForFunction(() => typeof (window as any).analyze === "function", null, {
          timeout: 60_000,
        });
        const run = page.evaluate(
          ([o]: [Record<string, unknown>]) => (window as any).analyze("/clip.mp4", o),
          [
            {
              dirHint: opts.dirHint,
              lift: opts.lift,
              movement: opts.movement,
              seed: { kind: "auto" },
            },
          ],
        );
        const out = (await withTimeout(run, PAGE_TIMEOUT_MS)) as { res: any };
        const res = out.res;
        if (res?.ok) return { ok: true, analysis: res.analysis as LiftAnalysis };
        return { ok: false, why: String(res?.why ?? "no_plate") };
      } catch (e: any) {
        return { ok: false, why: String(e?.message ?? e) === "timeout" ? "timeout" : "unreadable" };
      } finally {
        await page?.close().catch(() => undefined);
      }
    },
    async readBody(file, opts) {
      clip = file;
      let page: any = null;
      try {
        page = await newPage();
        await page.goto(`http://127.0.0.1:${port}/index.html`);
        await page.waitForFunction(() => typeof (window as any).readBody === "function", null, {
          timeout: 60_000,
        });
        const run = page.evaluate(
          ([o]: [Record<string, unknown>]) => (window as any).readBody("/clip.mp4", o),
          [{ window: opts.window, series: opts.series ?? null }],
        );
        return (await withTimeout(run, BODY_TIMEOUT_MS)) as BodyRead;
      } catch (e: any) {
        return { ok: false, why: String(e?.message ?? e) === "timeout" ? "timeout" : "unreadable" };
      } finally {
        await page?.close().catch(() => undefined);
      }
    },
    async close() {
      await browser.close().catch(() => undefined);
      server.close();
    },
  };
}
