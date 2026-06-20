/**
 * Dev-only first-load timing logger.
 *
 * No-ops in production builds. In dev, prints elapsed milliseconds from
 * navigation start so we can see where the dashboard spends its time:
 *   [perf] app shell visible        +42ms
 *   [perf] auth resolved            +180ms
 *   [perf] dashboard mounted        +210ms
 *   [perf] card:progress loaded     +380ms
 *
 * Each label is only logged once per page load.
 */
const IS_DEV = import.meta.env.DEV;
const seen = new Set<string>();

function navStart(): number {
  if (typeof performance === "undefined") return 0;
  // performance.now() is already relative to navigationStart in browsers
  // and to the worker startup in SSR — both fine for relative measurements.
  return 0;
}

export function logPerf(label: string): void {
  if (!IS_DEV) return;
  if (typeof window === "undefined") return;
  if (seen.has(label)) return;
  seen.add(label);
  const elapsed = Math.round(performance.now() - navStart());
  // eslint-disable-next-line no-console
  console.log(`%c[perf] ${label.padEnd(28)} +${elapsed}ms`, "color:#60a5fa");
}

/** Reset between hot reloads / tests. */
export function resetPerfTiming(): void {
  seen.clear();
}