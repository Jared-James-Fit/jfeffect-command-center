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
export function subscribeSw(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
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

  // Clear legacy JF runtime caches left by older builds before registering the current worker.
  if ("caches" in window) {
    void caches.keys().then((keys) => Promise.allSettled(keys.filter((k) => k.startsWith("jf-")).map((k) => caches.delete(k))));
  }

  // When a newly deployed worker takes control, reload this client once so an
  // installed iOS PWA cannot keep running the previous JavaScript bundle.
  // controllerchange only fires when the controlling worker actually changes,
  // so this does not create a normal reload loop.
  let reloadingForNewWorker = false;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForNewWorker) return;
      reloadingForNewWorker = true;
      window.location.reload();
    });
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
      onRegisteredSW(_swUrl, registration) {
        if (status === "idle") status = "ready";
        notify();
        // Check for a fresh production bundle whenever the installed PWA resumes.
        // iOS can keep a standalone PWA process alive for hours, otherwise leaving
        // the old JS mounted even after a new worker has activated.
        const check = () => { if (document.visibilityState === "visible") void registration?.update(); };
        document.addEventListener("visibilitychange", check);
        window.setInterval(check, 60_000);
      },
    });
    triggerUpdate = async () => {
      await updateSW(true);
      window.location.reload();
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
  // Signed chat-media URLs belong to the signed-in user.
  void import("@/hooks/use-chat-signed-urls").then((m) => m.clearChatSignedUrls()).catch(() => {});
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