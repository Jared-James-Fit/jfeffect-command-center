import { createContext, useContext } from "react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSplash } from "@/components/dashboard-splash";

/** True for whatever renders in the app shell's page area (AppShell's <main>). */
export const ShellPageContext = createContext(false);
/** True under the signed-in app (the /_authenticated layout). */
export const SignedInAppContext = createContext(false);

/**
 * The router's default pending screen: what a route shows when its code or
 * data takes longer than pendingMs. Every route gets its own boundary, so a
 * slow page is held where it renders:
 *  - a page inside the app shell: a neutral skeleton, with the header,
 *    sidebar and bottom nav left in place (never the full-screen splash);
 *  - a signed-in layout still loading (a cold start): the same splash the
 *    sign-in check shows, so the launch reads as one screen;
 *  - anything public: a small centred spinner.
 */
export function RoutePending() {
  const inShell = useContext(ShellPageContext);
  const signedIn = useContext(SignedInAppContext);
  if (inShell) return <RoutePendingSkeleton />;
  if (signedIn) return <DashboardSplash />;
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status" aria-label="Loading">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** A page's placeholder inside the app shell. */
export function RoutePendingSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-4 animate-in fade-in duration-300 md:px-6 md:pt-6"
      role="status"
      aria-label="Loading"
    >
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

/** A page whose content depends on something not known yet: its title stays, the body waits. */
export function PageBodySkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4 animate-in fade-in duration-300 md:px-6" role="status" aria-label="Loading">
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
