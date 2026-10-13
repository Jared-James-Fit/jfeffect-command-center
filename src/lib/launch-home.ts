import { cachedSessionRole } from "@/lib/auth";
import { hasStoredClientPov } from "@/lib/client-impersonation";
import { getViewMode } from "@/lib/view-mode";

/**
 * Opening the app (a cold launch always starts at "/") lands on the person's
 * Home: the portal for clients and members, the admin dashboard for staff,
 * Taxes & Books for the finance login. Never the last screen they were on.
 */

/**
 * The Home this device can pick with no network, from the role it cached at
 * the last sign-in. Null when the launch needs the full auth check: no cached
 * role, a "View as client" session, or a staff + client account that chose a
 * view.
 */
export function cachedLaunchHome(): "/portal" | "/admin" | "/finance" | null {
  const cached = cachedSessionRole();
  if (!cached) return null;
  if (hasStoredClientPov() || getViewMode(cached.uid)) return null;
  switch (cached.role) {
    case "client":
    case "member":
      return "/portal";
    case "admin":
    case "coach":
      return "/admin";
    case "finance":
      return "/finance";
    default:
      return null;
  }
}

/** Saved "last screen" entries from before launches always opened Home. */
export function forgetSavedLastRoutes(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("jf:last-route:")) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}
