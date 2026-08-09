import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { DashboardSplash } from "@/components/dashboard-splash";
import { NavigationProgress } from "@/components/navigation-progress";
import { ClientProfileOverlayMount } from "@/components/clients/profile/client-profile-overlay";
import { MemberProfileOverlayMount } from "@/components/members/member-profile-overlay";

// Module-level warm session: once the guard has validated a user this app
// lifetime, in-app revalidations (router.invalidate after mutations, error
// retries, auth events) resolve fast and never bounce the user to /auth on
// a transient network blip. A genuinely signed-out session still returns
// null from getSession (no throw) and redirects as before.
let warmUser: User | null = null;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Resilient session read for PWA cold launches on flaky networks.
    // A transient failure here (offline moment, slow Supabase response on
    // resume) was bubbling up as the router's default error fallback —
    // the "Something went wrong loading this page" screen users saw on
    // app open. Retry briefly, and on terminal failure fall through to
    // the auth redirect instead of throwing.
    const isRevalidation = warmUser !== null;
    const maxAttempts = isRevalidation ? 1 : 3;
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null = null;
    let threw = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        session = data.session;
        break;
      } catch (err) {
        if (attempt === maxAttempts - 1) {
          console.warn("[auth] getSession failed during route guard", err);
          threw = true;
          session = null;
          break;
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    if (!session?.user) {
      if (isRevalidation && threw && warmUser) {
        // Transient guard failure during an in-app revalidation — keep the
        // user on the page with their previously validated identity rather
        // than flashing the auth screen. Queries that genuinely need a
        // session fail locally and show section-level retry states.
        return { user: warmUser };
      }
      const next = location.href;
      throw redirect({
        to: "/auth",
        search: next && next !== "/" ? { next } : undefined,
      });
    }
    warmUser = session.user;
    return { user: session.user };
  },
  pendingComponent: () => <DashboardSplash />,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <>
      <NavigationProgress />
      <Outlet />
      <ClientProfileOverlayMount />
      <MemberProfileOverlayMount />
    </>
  );
}