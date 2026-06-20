// Deployment chunk-load recovery.
//
// When a new deployment ships, the browser may still be holding references to
// old hashed JS chunks that no longer exist on the origin. Dynamic imports
// (route splits, lazy components) then reject with errors like
// "Failed to fetch dynamically imported module" / "ChunkLoadError", which
// would otherwise render a blank screen.
//
// Strategy:
//   1. Listen for Vite's `vite:preloadError` and for window error /
//      unhandledrejection events that look like chunk failures.
//   2. Reload the page ONCE per recovery attempt, guarded by a sessionStorage
//      flag so we cannot create an infinite reload loop.
//   3. After the app boots successfully on the new build, clear the guard so
//      a future deployment can recover again.
//
// This module is client-only and safe to import at the root.

const RELOAD_GUARD_KEY = "jfe_chunk_reload_v1";

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /dynamically imported module/i,
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && err !== null && (err as { name?: string }).name === "ChunkLoadError") {
    return true;
  }
  const msg =
    typeof err === "string"
      ? err
      : typeof err === "object" && err !== null
        ? ((err as { message?: string }).message ?? "")
        : "";
  if (!msg) return false;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(msg));
}

function canReloadOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_KEY)) return false;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    // sessionStorage disabled — refuse to reload rather than risk a loop.
    return false;
  }
}

/**
 * Attempt a one-time recovery reload. Returns true if a reload was triggered.
 * Returns false if the guard is already set (so the caller should render a
 * user-facing fallback instead of reloading again).
 */
export function attemptChunkReload(reason: string): boolean {
  if (typeof window === "undefined") return false;
  if (!canReloadOnce()) {
    // eslint-disable-next-line no-console
    console.warn("[chunk-recovery] reload guard set; skipping auto-reload", { reason });
    return false;
  }
  // eslint-disable-next-line no-console
  console.warn("[chunk-recovery] reloading once to recover stale chunk", { reason });
  window.location.reload();
  return true;
}

function clearReloadGuard() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    // ignore
  }
}

let initialised = false;

/**
 * Install global chunk-load recovery listeners. Idempotent.
 * Call once from the client after the app shell mounts.
 */
export function initChunkRecovery() {
  if (typeof window === "undefined" || initialised) return;
  initialised = true;

  // Vite emits this when a <link rel="modulepreload"> or dynamic import fails.
  window.addEventListener("vite:preloadError", (event) => {
    const e = event as Event & { payload?: unknown };
    // Prevent Vite from rethrowing — we own recovery for this error.
    event.preventDefault?.();
    // eslint-disable-next-line no-console
    console.warn("[chunk-recovery] vite:preloadError", {
      message: (e.payload as { message?: string })?.message,
    });
    attemptChunkReload("vite:preloadError");
  });

  // Catch dynamic import rejections that don't go through vite:preloadError.
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      attemptChunkReload("unhandledrejection");
    }
  });

  // Catch <script> load failures for old hashed bundles.
  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
      attemptChunkReload("window.error");
    }
  });

  // Once the app has successfully booted on the new build, release the guard
  // so a future deployment can trigger one recovery reload again. We wait a
  // few seconds to be sure initial route chunks resolved.
  window.setTimeout(clearReloadGuard, 5000);
}