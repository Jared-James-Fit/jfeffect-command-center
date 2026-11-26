import type { RunInput, RunResult } from "./run";

/** One off-main-thread read; cancellation terminates decoding as well as inference. */
export async function readInWorker(input: RunInput): Promise<RunResult> {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    const { analyzeVideo } = await import("./run");
    return analyzeVideo(input);
  }
  return new Promise(resolve => {
    const worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(result);
    };
    const cancel = () => finish({ ok: false, why: "cancelled", proposal: null, clip: null });
    worker.onerror = () => finish({ ok: false, why: "unreadable", proposal: null, clip: null });
    worker.onmessage = (e: MessageEvent<{ progress?: Parameters<NonNullable<RunInput["onProgress"]>>[0]; result?: RunResult }>) => {
      if (e.data.progress) input.onProgress?.(e.data.progress);
      if (e.data.result) finish(e.data.result);
    };
    input.signal?.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted) return cancel();
    const { signal: _signal, onProgress: _progress, ...data } = input;
    worker.postMessage(data);
  });
}