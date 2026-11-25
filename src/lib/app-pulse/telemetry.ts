/**
 * What a visit can't leave in a record of its own (src/lib/bi/events.ts is the catalog): how fast
 * the page was (web vitals), a script error, a request that failed, a page that wasn't found. From
 * the browser, buffered here and sent with the visit's next heartbeat (pulse-client.ts), so it adds
 * no request of its own. Never throws, never blocks the page.
 *
 * Web vitals are measured with the browser's own PerformanceObserver (no library), once per page
 * load: LCP and CLS settle when the page is hidden, INP is the slowest tap or key response seen,
 * FCP and TTFB come from the first paint and the navigation entry. Readings in a background tab are
 * thrown away (a hidden page's timings mean nothing).
 */
import { cleanArea, cleanErrorLabel, cleanEvent, type BiEvent, type FailureKind, type Vital } from "@/lib/bi/events";
import { featureOf, normalizePath } from "./pulse-rules";

const MAX_BUFFER = 60;
const MAX_ERRORS_PER_LOAD = 15;

let buffer: BiEvent[] = [];
let installed = false;
let errorsThisLoad = 0;
const seenErrors = new Set<string>();
const seenFailures = new Map<string, number>();

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

function here(): { path: string; feature: string } {
  const p = typeof window === "undefined" ? "/" : window.location.pathname;
  return { path: normalizePath(p), feature: featureOf(p) };
}

function push(raw: Record<string, unknown>): void {
  const e = cleanEvent({ id: uuid(), at: new Date().toISOString(), ...here(), ...raw });
  if (!e) return;
  buffer.push(e);
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
}

/** Everything waiting, emptied (the heartbeat sends them; a lost beat loses them, never anything else). */
export function drainEvents(max = 30): BiEvent[] {
  const out = buffer.slice(0, max);
  buffer = buffer.slice(max);
  return out;
}

export function pendingEvents(): number {
  return buffer.length;
}

/** A request the app couldn't complete, by area (a query key's first part) and kind; once a minute per area and kind. */
export function recordRequestFailure(area: unknown, kind: FailureKind): void {
  if (kind === "offline") return; // the person's connection, not the app
  const key = `${cleanArea(area)}|${kind}`;
  const now = Date.now();
  if (now - (seenFailures.get(key) ?? 0) < 60_000) return;
  seenFailures.set(key, now);
  push({ name: "request_failed", label: cleanArea(area), rating: kind });
}

export function recordNotFound(): void {
  push({ name: "page_not_found" });
}

function recordError(message: unknown): void {
  if (errorsThisLoad >= MAX_ERRORS_PER_LOAD) return;
  const label = cleanErrorLabel(message);
  // the browser's own noise: an extension, a cancelled request, the resize-observer loop
  if (/ResizeObserver loop|Script error\.?$|AbortError|The user aborted|Load failed$|cancelled$/i.test(label)) return;
  const key = `${label}|${here().feature}`;
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  errorsThisLoad += 1;
  push({ name: "js_error", label });
}

function vital(name: Vital, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  push({ name: "web_vital", label: name, value });
}

function observe(type: string, cb: (entries: any[]) => void, opts: Record<string, unknown> = {}): PerformanceObserver | null {
  try {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
    const po = new PerformanceObserver((list) => cb(list.getEntries() as any[]));
    po.observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
    return po;
  } catch {
    return null;
  }
}

function watchVitals(): void {
  if (typeof document === "undefined" || typeof performance === "undefined") return;
  // a page opened in the background never had a first paint the person saw
  const hiddenAtStart = document.visibilityState === "hidden";
  let lcp = 0;
  let cls = 0;
  let sessionValue = 0;
  let sessionEntries: any[] = [];
  let inp = 0;
  let reported = false;

  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.responseStart > 0) vital("TTFB", Math.max(0, nav.responseStart - (Number((nav as any).activationStart) || 0)));
  } catch {
    /* no navigation timing */
  }
  observe("paint", (entries) => {
    for (const e of entries) if (e.name === "first-contentful-paint" && !hiddenAtStart) vital("FCP", e.startTime);
  });
  const lcpObs = observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcp = last.renderTime || last.loadTime || last.startTime;
  });
  observe("layout-shift", (entries) => {
    for (const e of entries) {
      if (e.hadRecentInput) continue;
      const first = sessionEntries[0];
      const lastE = sessionEntries[sessionEntries.length - 1];
      if (first && lastE && e.startTime - lastE.startTime < 1000 && e.startTime - first.startTime < 5000) {
        sessionValue += e.value;
        sessionEntries.push(e);
      } else {
        sessionValue = e.value;
        sessionEntries = [e];
      }
      cls = Math.max(cls, sessionValue);
    }
  });
  observe(
    "event",
    (entries) => {
      for (const e of entries) if (e.interactionId) inp = Math.max(inp, e.duration);
    },
    { durationThreshold: 40 },
  );
  const report = () => {
    if (reported) return;
    reported = true;
    lcpObs?.disconnect();
    if (!hiddenAtStart && lcp > 0) vital("LCP", lcp);
    vital("CLS", Math.round(cls * 1000) / 1000);
    if (inp > 0) vital("INP", inp);
  };
  // LCP stops at the first tap or key; the page being hidden settles all three
  const stopLcp = () => {
    if (lcp > 0 && !hiddenAtStart && !reported) lcpObs?.disconnect();
  };
  window.addEventListener("pointerdown", stopLcp, { once: true, capture: true });
  window.addEventListener("keydown", stopLcp, { once: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report();
  });
  window.addEventListener("pagehide", report);
}

/** Start listening (once per page load). */
export function installTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    // a failed image or script load has no message: that's a network blip, not an error in the app
    if (!(ev as ErrorEvent).message) return;
    recordError((ev as ErrorEvent).message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason: any = (ev as PromiseRejectionEvent).reason;
    recordError(reason?.message ?? reason);
  });
  watchVitals();
}

/** For tests: clear everything. */
export function resetTelemetry(): void {
  buffer = [];
  errorsThisLoad = 0;
  seenErrors.clear();
  seenFailures.clear();
}

export { recordError as recordClientError };
