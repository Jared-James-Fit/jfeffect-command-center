import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { DashboardSplash } from "@/components/dashboard-splash";
import { ClientProfileOverlayMount } from "@/components/clients/profile/client-profile-overlay";
import { z } from "zod";
import { fallback } from "@tanstack/zod-adapter";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  validateSearch: z.object({
    clientId: fallback(z.string().optional(), undefined),
    clientTab: fallback(z.string().optional(), undefined),
  }).passthrough(),
  beforeLoad: async ({ location }) => {
    // Resilient session read for PWA cold launches on flaky networks.
    // A transient failure here (offline moment, slow Supabase response on
    // resume) was bubbling up as the router's default error fallback —
    // the "Something went wrong loading this page" screen users saw on
    // app open. Retry briefly, and on terminal failure fall through to
    // the auth redirect instead of throwing.
    let session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        session = data.session;
        break;
      } catch (err) {
        if (attempt === 2) {
          console.warn("[auth] getSession failed during route guard", err);
          session = null;
          break;
        }
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    if (!session?.user) {
      const next = location.href;
      throw redirect({
        to: "/auth",
        search: next && next !== "/" ? { next } : undefined,
      });
    }
    return { user: session.user };
  },
  pendingMs: 0,
  pendingComponent: () => <DashboardSplash />,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <>
      <Outlet />
      <ClientProfileOverlayMount />
    </>
  );
}