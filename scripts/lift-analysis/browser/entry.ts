/** The browser pipeline for the validation harness: the app's own analyzeVideo, on a clip URL. */
import { analyzeVideo } from "../../../src/lib/lift-analysis/run";

(window as unknown as { analyze: unknown }).analyze = async (
  url: string,
  opts: Record<string, unknown> = {},
) => {
  const t0 = performance.now();
  // when each stage started (ms from the start), for --stages
  const stages: Record<string, number> = {};
  const res = await analyzeVideo({
    source: url,
    ...(opts as object),
    onProgress: (p) => {
      if (!(p.stage in stages)) stages[p.stage] = Math.round(performance.now() - t0);
    },
  });
  return { ms: Math.round(performance.now() - t0), stages, res: JSON.parse(JSON.stringify(res)) };
};
