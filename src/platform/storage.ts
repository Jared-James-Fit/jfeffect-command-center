// Namespaced localStorage with safe JSON + SSR guard.
// Capacitor-ready (swap with @capacitor/preferences for native).

const NS = "jf:";

function ok(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export const kvStorage = {
  get<T>(key: string, fallback: T): T {
    if (!ok()) return fallback;
    try {
      const raw = window.localStorage.getItem(NS + key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    if (!ok()) return;
    try {
      window.localStorage.setItem(NS + key, JSON.stringify(value));
    } catch {
      // ignore
    }
  },
  remove(key: string): void {
    if (!ok()) return;
    try {
      window.localStorage.removeItem(NS + key);
    } catch {
      // ignore
    }
  },
};