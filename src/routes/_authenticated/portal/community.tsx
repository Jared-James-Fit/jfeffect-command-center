import { createFileRoute } from "@tanstack/react-router";
import { CommunityScreen } from "@/components/community/community-screen";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * The client community feed: the raised centre tab (also Home's community
 * card, pushes and the post-share toast). A tab, so no back arrow: Feed /
 * Crew / You, the bell and + Share on one row, right under the app bar.
 * `#post=<id>` opens a post straight away, `#at=<id>` scrolls to it.
 */
export const Route = createFileRoute("/_authenticated/portal/community")({
  head: () => ({ meta: [{ title: "League" }] }),
  component: PortalCommunity,
});

function PortalCommunity() {
  const { isImpersonating } = useClientImpersonation();
  return <CommunityScreen canShare previewOnly={isImpersonating} bell />;
}
