// Guarded service-worker registration. Never registers in dev, iframe previews,
// Lovable preview hosts, or when ?sw=off. Exposes a small subscribe API so the
// UI can show the "Update available" toast.

type Status = "idle" | "ready" | "update-available" | "offline-ready" | "blocked";

let status: Status = "idle";
let triggerUpdate: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function getSwStatus(): Status { return status; }
export function subscribeSw(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export async function applyUpdate() {
  if (triggerUpdate) await triggerUpdate();
  else if (typeof window !== "undefined") window.location.reload();
}

function shouldRefuse(): boolean {
  if (typeof window === "undefined") return true;
  if (!import.meta.env.PROD) return true;
  try { if (window.top !== window.self) return true; } catch { return true; }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterMatching() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url.endsWith("/sw.js") || url.endsWith("/service-worker.js")) {
        await r.unregister();
      }
    }
  } catch { /* best-effort */ }
}

/** Call once on the client (e.g. from a useEffect in __root.tsx). */
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (shouldRefuse()) {
    status = "blocked";
    notify();
    void unregisterMatching();
    return;
  }

  // Dynamic import keeps the virtual module out of SSR / Lovable preview bundles.
  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        status = "update-available";
        notify();
      },
      onOfflineReady() {
        status = "offline-ready";
        notify();
      },
      onRegisteredSW() {
        if (status === "idle") status = "ready";
        notify();
      },
    });
    triggerUpdate = async () => {
      await updateSW(true);
    };
  }).catch(() => {
    // SW chunk missing or blocked — fall through silently.
  });
}

/**
 * Clear all caches and service worker registrations. Called on sign-out to
 * prevent the next user from seeing the previous user's cached data.
 */
export async function clearAllAppCaches() {
  if (typeof window === "undefined") return;
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.filter((k) => k.startsWith("jf-")).map((k) => caches.delete(k)));
    }
  } catch { /* best-effort */ }
  try {
    // Drop known JF Effect IndexedDB stores used for offline drafts.
    if ("indexedDB" in window && (indexedDB as any).databases) {
      const dbs = await (indexedDB as any).databases();
      for (const db of dbs as { name?: string }[]) {
        if (db.name && db.name.startsWith("jf-")) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    }
  } catch { /* best-effort */ }
}