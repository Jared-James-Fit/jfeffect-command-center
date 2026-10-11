import { createFileRoute } from "@tanstack/react-router";
import { CommunityScreen } from "@/components/community/community-screen";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * Crew: the raised centre tab (also Home's Crew section, pushes and the
 * post-share toast). A tab, so no back arrow: Feed / Rankings, Members, the
 * bell and + Share on one row, right under the app bar. `#post=<id>` opens a
 * post straight away, `#at=<id>` scrolls to it, `#rankings` opens Rankings.
 */
export const Route = createFileRoute("/_authenticated/portal/community")({
  head: () => ({ meta: [{ title: "Crew" }] }),
  component: PortalCommunity,
});

function PortalCommunity() {
  const { isImpersonating } = useClientImpersonation();
  return <CommunityScreen canShare previewOnly={isImpersonating} bell />;
}
