/**
 * The old JF Membership area (/m) now lives in the portal: one app for
 * coaching clients and members (service tier decides the coach's screens).
 * Where each /m path went; null = still served under /m (the Fillout
 * completion landing, which external forms link to).
 */
export function memberPathToPortal(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/m";
  if (p === "/m" || p === "/m/more") return "/portal";
  if (p.startsWith("/m/forms/")) return null;
  const exact: Record<string, string> = {
    "/m/workouts": "/portal/workouts",
    "/m/my-plans": "/portal/workouts",
    "/m/plans": "/portal/plans",
    "/m/nutrition": "/portal/nutrition-targets",
    "/m/nutrition/targets-manage": "/portal/nutrition-targets",
    "/m/nutrition/targets-setup": "/portal/nutrition-targets",
    "/m/progress": "/portal/progress",
    "/m/resources": "/portal/resources",
    "/m/tools": "/portal/tools",
    "/m/announcements": "/portal/announcements",
    "/m/support": "/portal/support",
    "/m/billing": "/portal/membership",
    "/m/upgrade": "/portal/upgrade",
    "/m/account": "/portal/account",
  };
  if (exact[p]) return exact[p];
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/m\/plans\/([^/]+)$/))) return `/portal/plans/${m[1]}`;
  if ((m = p.match(/^\/m\/resources\/([^/]+)$/))) return `/portal/resources/${m[1]}`;
  if ((m = p.match(/^\/m\/nutrition\/([^/]+)$/))) return `/portal/recipes/${m[1]}`;
  if (p.startsWith("/m/workouts/") || p.startsWith("/m/my-plans/")) return "/portal/workouts";
  return "/portal";
}
