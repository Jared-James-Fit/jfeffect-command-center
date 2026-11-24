/**
 * Work that shouldn't compete with what's on screen: run it once the page has
 * been up `after` ms and the browser has an idle moment (a plain timer where
 * there's no requestIdleCallback, i.e. Safari before 18.4).
 */
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function runWhenIdle(fn: () => void, { after = 0, timeout = 2000 }: { after?: number; timeout?: number } = {}): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as IdleWindow;
  let idleId: number | null = null;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    fn();
  };
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(go, { timeout });
    else window.setTimeout(go, 0);
  }, after);
  return () => {
    done = true;
    window.clearTimeout(t);
    if (idleId !== null) w.cancelIdleCallback?.(idleId);
  };
}

const warmed = new Set<string>();

/**
 * Fetch code a tap is likely to need (a sheet, a tab's body) in idle time,
 * once per app session, so the first tap opens it at once. Skipped on Data
 * Saver; a failure just leaves it to the tap.
 */
export function preloadWhenIdle(key: string, load: () => Promise<unknown>, after = 4000): void {
  if (typeof window === "undefined" || warmed.has(key)) return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  warmed.add(key);
  runWhenIdle(() => void load().catch(() => warmed.delete(key)), { after });
}
