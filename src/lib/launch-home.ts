import { cachedSessionRole } from "@/lib/auth";
import { hasStoredClientPov } from "@/lib/client-impersonation";
import { getViewMode } from "@/lib/view-mode";
import { resumableWorkoutRoute } from "@/lib/route-persistence";
import { CLIENT_VIEW_HOME } from "@/lib/client-home";

/**
 * Where a fresh launch of the app lands (a cold launch always starts at "/").
 *
 * - Crew: clients and members (and a staff + client account in its client
 *   view) on the portal's Crew page, coaches and admins on the staff Crew
 *   page; the finance login keeps its desk, Taxes & Books.
 * - Except mid-workout: an unfinished workout that was on screen in the last
 *   2 hours reopens instead (iOS can close the app in the background while
 *   you're in Spotify; coming back must land on your sets).
 *
 * Switching apps and coming back isn't a launch: nothing reloads or
 * redirects, so you're exactly where you were.
 */

export type LaunchRole = string | null | undefined;

export { CLIENT_VIEW_HOME };

/** The Crew page for this role (or its desk / dashboard when it has no Crew). */
export function crewHome(role: LaunchRole, view: "client" | "staff" | null = null): string {
  if (view === "client" || role === "client" || role === "member") return CLIENT_VIEW_HOME;
  if (role === "admin" || role === "coach") return "/admin/community";
  if (role === "finance") return "/finance";
  return "/admin";
}

/** Fresh launch: back to an unfinished workout, else Crew. */
export function launchTarget(uid: string, role: LaunchRole, view: "client" | "staff" | null = null): string {
  const portal = view === "client" || role === "client" || role === "member" || role === "admin" || role === "coach";
  const workout = portal ? resumableWorkoutRoute(uid) : null;
  return workout ?? crewHome(role, view);
}

/**
 * The same, with no network, from the role this device cached at the last
 * sign-in. Null when the launch needs the full auth check: no cached role, a
 * role with no Crew or desk of its own, a "View as client" session, or a
 * staff + client account that chose a view.
 */
export function cachedLaunchTarget(): string | null {
  const cached = cachedSessionRole();
  if (!cached) return null;
  if (hasStoredClientPov() || getViewMode(cached.uid)) return null;
  if (!["client", "member", "admin", "coach", "finance"].includes(cached.role)) return null;
  return launchTarget(cached.uid, cached.role);
}
