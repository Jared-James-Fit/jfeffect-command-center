/**
 * The phone's own reading pipeline (src/lib/lift-analysis/run.ts: mediabunny
 * and WebCodecs, the plate engine) in headless Chromium, for the server's
 * reader. The page is scripts/lift-analysis/browser/entry.ts bundled by the
 * workflow (PAGE_BUNDLE_DIR); clips are served to it from this machine only.
 */
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { LiftAnalysis } from "../../src/lib/lift-analysis/analyze";
import type { Movement, GuideLift } from "../../src/lib/lift-analysis/exercise";

export type BrowserRead =
  | { ok: true; analysis: LiftAnalysis }
  | { ok: false; why: string; analysis?: undefined };

export type BrowserReader = {
  analyze: (
    file: string,
    opts: { dirHint?: "lower_first" | "lift_first"; lift: GuideLift; movement: Movement },
  ) => Promise<BrowserRead>;
  close: () => Promise<void>;
};

const PAGE_TIMEOUT_MS = 8 * 60_000;

export async function startBrowser(): Promise<BrowserReader> {
  const dir = process.env.PAGE_BUNDLE_DIR;
  if (!dir || !existsSync(join(dir, "bundle.js"))) throw new Error("PAGE_BUNDLE_DIR has no bundle.js");
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><meta charset="utf-8"><script type="module" src="bundle.js"></script>',
  );
  let clip = "";
  const server: Server = createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const p = u === "/clip.mp4" ? clip : join(dir, u.replace(/^\/+/, ""));
    if (!p || !p.startsWith(u === "/clip.mp4" ? clip : dir) || !existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    const size = statSync(p).size;
    const type = p.endsWith(".js") ? "text/javascript" : p.endsWith(".html") ? "text/html" : "video/mp4";
    const range = req.headers.range;
    if (range) {
      const [a, b] = range.replace("bytes=", "").split("-");
      const start = Number(a);
      const end = b ? Number(b) : size - 1;
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      return createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    createReadStream(p).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  // playwright is CommonJS: imported as a module its exports sit on `default`
  const pw: any = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("playwright's chromium isn't available");
  const browser = await chromium.launch();

  return {
    async analyze(file, opts) {
      clip = file;
      const page = await browser.newPage();
      try {
        await page.goto(`http://127.0.0.1:${port}/index.html`);
        await page.waitForFunction(() => typeof (window as any).analyze === "function", null, { timeout: 60_000 });
        const run = page.evaluate(
          ([o]: [Record<string, unknown>]) => (window as any).analyze("/clip.mp4", o),
          [{ dirHint: opts.dirHint, lift: opts.lift, movement: opts.movement, seed: { kind: "auto" } }],
        );
        const out = (await Promise.race([
          run,
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), PAGE_TIMEOUT_MS)),
        ])) as { res: any };
        const res = out.res;
        if (res?.ok) return { ok: true, analysis: res.analysis as LiftAnalysis };
        return { ok: false, why: String(res?.why ?? "no_plate") };
      } catch (e: any) {
        return { ok: false, why: String(e?.message ?? e) === "timeout" ? "timeout" : "unreadable" };
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    async close() {
      await browser.close().catch(() => undefined);
      server.close();
    },
  };
}
