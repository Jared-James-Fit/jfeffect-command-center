import type { RunInput, RunResult } from "./run";
import { analyzeVideo } from "./run";

const scope = self as unknown as { onmessage: ((e: MessageEvent<Omit<RunInput, "signal" | "onProgress">>) => void) | null; postMessage: (v: unknown) => void };
scope.onmessage = async e => {
  try {
    const result: RunResult = await analyzeVideo({ ...e.data, onProgress: progress => scope.postMessage({ progress }) });
    scope.postMessage({ result });
  } catch {
    scope.postMessage({ result: { ok: false, why: "unreadable", proposal: null, clip: null } });
  }
};