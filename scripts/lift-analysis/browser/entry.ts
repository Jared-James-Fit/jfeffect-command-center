/** The browser pipeline for the validation harness: the app's own analyzeVideo, on a clip URL. */
import { analyzeVideo } from "../../../src/lib/lift-analysis/run";

(window as unknown as { analyze: unknown }).analyze = async (
  url: string,
  opts: Record<string, unknown> = {},
) => {
  const t0 = performance.now();
  const res = await analyzeVideo({ source: url, ...(opts as object) });
  return { ms: Math.round(performance.now() - t0), res: JSON.parse(JSON.stringify(res)) };
};
