/**
 * Per-user route persistence.
 *
 * Saves the last meaningful authenticated pathname so the app can restore
 * it when the PWA is fully closed and reopened (start_url resets to "/").
 *
 * Storage key:  jf:last-route:<user-id>
 * Expiration:   7 days
 * Scope:        pathname only (no search params — path params carry all
 *               the identity info needed to reload a workout)
 */

const KEY_PREFIX = "jf:last-route:";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// Routes whose pathnames begin with these prefixes are worth restoring.
const RESTORABLE_PREFIXES = ["/portal", "/m", "/admin", "/media"];

// These prefixes are always excluded even if they match a restorable prefix.
const EXCLUDED_PREFIXES = [
  "/auth",
  "/recover",
  "/signup",
  "/membership",
  "/coaching",
  "/legal",
  "/install",
  "/invite",
  "/app",
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isRestorableRoute(pathname: string): boolean {
  if (!pathname || pathname === "/" || pathname === "") return false;
  for (const excl of EXCLUDED_PREFIXES) {
    if (matchesPrefix(pathname, excl)) return false;
  }
  for (const prefix of RESTORABLE_PREFIXES) {
    if (matchesPrefix(pathname, prefix)) return true;
  }
  return false;
}

interface PersistedRoute {
  pathname: string;
  savedAt: number;
}

export function saveLastRoute(userId: string, pathname: string): void {
  if (!isRestorableRoute(pathname)) return;
  try {
    const value: PersistedRoute = { pathname, savedAt: Date.now() };
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(value));
  } catch { /* storage full or unavailable */ }
}

export function getLastRoute(userId: string): string | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed: PersistedRoute = JSON.parse(raw);
    if (!parsed?.pathname || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > EXPIRY_MS) {
      localStorage.removeItem(KEY_PREFIX + userId);
      return null;
    }
    if (!isRestorableRoute(parsed.pathname)) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

export function clearLastRoute(userId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + userId);
  } catch {}
}
