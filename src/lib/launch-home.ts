import { cachedSessionRole } from "@/lib/auth";
import { hasStoredClientPov } from "@/lib/client-impersonation";
import { getViewMode } from "@/lib/view-mode";
import { lastRouteFor } from "@/lib/route-persistence";

/**
 * Opening the app (a cold launch always starts at "/") goes back to the screen
 * the person was last on (saved per account, up to 7 days, see
 * route-persistence.ts); with nothing saved, their Home: the portal for
 * clients and members, the admin dashboard for staff, Taxes & Books for the
 * finance login.
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

/**
 * Where a launch can go with no network: the last screen this account was on
 * (when its cached role may open it), else its Home. Null when the launch
 * needs the full auth check (see cachedLaunchHome).
 */
export function cachedLaunchTarget(): string | null {
  const home = cachedLaunchHome();
  const cached = cachedSessionRole();
  if (!home || !cached) return null;
  return lastRouteFor(cached.uid, cached.role) ?? home;
}
