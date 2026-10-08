import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { raceVideoUpload, shouldSwitch, type RaceDeps } from "@/lib/video-upload-race";
import type { CompressOutcome } from "@/lib/video-compress";

// A controllable fake upload/compress: each step resolves when the test says so.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const small = new File([new Uint8Array(8)], "c.mp4", { type: "video/mp4" });

function harness(originalBytes = 100) {
  const orig = deferred<void>();
  const comp = deferred<CompressOutcome>();
  const up = deferred<void>();
  const state = {
    origAborted: false,
    compAborted: false,
    uploadedCompressed: false,
    origProgress: (_: number) => {},
    progress: [] as number[],
  };
  const deps: RaceDeps = {
    originalBytes,
    uploadOriginal: (p, sig) => {
      state.origProgress = p;
      sig.addEventListener("abort", () => { state.origAborted = true; orig.reject(new Error("aborted")); });
      return orig.promise;
    },
    compress: (_p, sig) => {
      sig.addEventListener("abort", () => { state.compAborted = true; comp.resolve({ file: null, reason: "aborted", ms: 1 }); });
      return comp.promise;
    },
    uploadCompressed: () => { state.uploadedCompressed = true; return up.promise; },
  };
  const run = raceVideoUpload(deps, { onProgress: (f) => state.progress.push(f) });
  return { orig, comp, up, state, run };
}

describe("racing the original upload against the phone's compressed copy", () => {
  it("switches to the compressed copy when it will land sooner", async () => {
    const h = harness(100);
    h.state.origProgress(0.2);
    h.comp.resolve({ file: small, reason: "ok", ms: 900, durationSec: 12 });
    await tick();
    expect(h.state.origAborted).toBe(true);
    expect(h.state.uploadedCompressed).toBe(true);
    h.up.resolve();
    const r = await h.run;
    expect(r.sent).toBe("compressed");
    expect(r.why).toBe("compressed-sooner");
  });

  it("keeps the original when it finishes first, and stops compressing", async () => {
    const h = harness();
    h.orig.resolve();
    const r = await h.run;
    expect(r.sent).toBe("original");
    expect(r.why).toBe("original-first");
    expect(h.state.compAborted).toBe(true);
    expect(h.state.uploadedCompressed).toBe(false);
  });

  it("lets the original finish when compression gives up (and records why)", async () => {
    const h = harness();
    h.comp.resolve({ file: null, reason: "no-webcodecs", ms: 0 });
    await tick();
    expect(h.state.origAborted).toBe(false);
    h.orig.resolve();
    const r = await h.run;
    expect(r).toMatchObject({ sent: "original", why: "not-compressed:no-webcodecs" });
  });

  it("keeps an original that's nearly done even if a copy is ready", async () => {
    const h = harness(100);
    h.state.origProgress(0.97);
    h.comp.resolve({ file: new File([new Uint8Array(20)], "c.mp4"), reason: "ok", ms: 5000 });
    await tick();
    expect(h.state.origAborted).toBe(false);
    h.orig.resolve();
    expect((await h.run).why).toBe("original-nearly-done");
  });

  it("falls back to the copy if the original upload fails", async () => {
    const h = harness();
    h.orig.reject(new Error("network"));
    await tick();
    h.comp.resolve({ file: small, reason: "ok", ms: 3000 });
    await tick();
    h.up.resolve();
    expect(await h.run).toMatchObject({ sent: "compressed", why: "original-failed" });
  });

  it("fails only when both ways fail", async () => {
    const h = harness();
    h.orig.reject(new Error("network"));
    h.comp.resolve({ file: null, reason: "error:x", ms: 10 });
    await expect(h.run).rejects.toThrow("network");
  });

  it("never moves the progress bar backwards", async () => {
    const h = harness(100);
    h.state.origProgress(0.6);
    h.comp.resolve({ file: small, reason: "ok", ms: 900 });
    await tick();
    h.up.resolve();
    await h.run;
    for (let i = 1; i < h.state.progress.length; i++) {
      expect(h.state.progress[i]).toBeGreaterThanOrEqual(h.state.progress[i - 1]);
    }
  });

  it("switches only when the copy is clearly smaller than what's left", () => {
    expect(shouldSwitch(10, 100, 0)).toBe(true);
    expect(shouldSwitch(10, 100, 0.9)).toBe(false); // 10 left vs 10: keep going
    expect(shouldSwitch(5, 100, 0.9)).toBe(true);
  });
});

describe("chat video uploads", () => {
  const shared = readFileSync("src/components/chat-shared.tsx", "utf8");
  it("record what happened on the phone with the attachment", () => {
    expect(shared).toContain("att.transfer = {");
    expect(shared).toContain("why: result.why,");
    expect(shared).toContain("compress: result.compress?.reason ?? null,");
  });
  it("upload the poster as soon as it's ready, not after the video", () => {
    expect(shared).toContain("const posterUpload = posterP.then(");
  });
});

describe("poster capture on iPhone", () => {
  const poster = readFileSync("src/lib/video-poster.ts", "utf8");
  it("decodes in the page, waits for a real frame, and can force one by playing muted", () => {
    expect(poster).toContain("appendChild(v)");
    expect(poster).toContain("requestVideoFrameCallback");
    expect(poster).toContain("const started = v.play();");
    expect(poster).toContain("v.remove();");
  });
});
