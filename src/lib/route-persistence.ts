/**
 * Per-user last screen, kept for one job: if the app is closed (or iOS closes
 * it in the background) mid-workout, opening it again goes back to that
 * workout. Any other fresh launch opens Crew (launch-home.ts), and switching
 * apps never reloads anything, so you stay where you were.
 *
 * Storage key:  jf:last-route:<user-id>
 * Expiration:   7 days
 * Scope:        pathname + search (a workout's ?instance= picks the scheduled
 *               instance being logged)
 */
import { inProgressWorkoutDay } from "@/lib/workout-resume";

const KEY_PREFIX = "jf:last-route:";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// Routes whose pathnames begin with these prefixes are worth remembering.
const RESTORABLE_PREFIXES = ["/portal", "/m", "/admin"];

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
  search?: string;
  savedAt: number;
}

export function saveLastRoute(userId: string, pathname: string, search = ""): void {
  if (!isRestorableRoute(pathname)) return;
  try {
    const value: PersistedRoute = { pathname, search: search.startsWith("?") ? search : "", savedAt: Date.now() };
    localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(value));
  } catch { /* storage full or unavailable */ }
}

/** The saved screen (pathname + search), or null when none, too old, or not restorable. */
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
    return parsed.pathname + (parsed.search ?? "");
  } catch {
    return null;
  }
}

export function clearLastRoute(userId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + userId);
  } catch {}
}

/** /portal/workouts/<dayId> (a workout being logged), not the list, PRs or analytics. */
const WORKOUT_DAY = /^\/portal\/workouts\/([^/?#]+)$/;
const NOT_A_DAY = new Set(["analytics", "prs"]);

/**
 * The workout to go back to on a fresh launch: this person's last screen was
 * a workout day that is still unfinished and was on screen in the last 2
 * hours (workout-resume.ts). Otherwise null, and the launch opens Crew.
 */
export function resumableWorkoutRoute(userId: string, now: number = Date.now()): string | null {
  const saved = getLastRoute(userId);
  if (!saved) return null;
  const path = saved.split("?")[0];
  const day = WORKOUT_DAY.exec(path)?.[1];
  if (!day || NOT_A_DAY.has(day)) return null;
  return inProgressWorkoutDay(now) === decodeURIComponent(day) ? saved : null;
}
