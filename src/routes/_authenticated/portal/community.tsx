import { createFileRoute } from "@tanstack/react-router";
import { CommunityScreen } from "@/components/community/community-screen";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * The client community: its own tab in the bottom bar, one tap from anywhere
 * (also opened by Home's community strip, the header "🔥 new" pill, pushes
 * and the post-share toast). No page header: the feed starts right under the
 * app bar, with Feed / Crew / You, the bell and + Share on one row. Tapping
 * the tab again goes back to the top and pulls the newest posts.
 * `#post=<id>` opens a post straight away.
 */
export const Route = createFileRoute("/_authenticated/portal/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: PortalCommunity,
});

function PortalCommunity() {
  const { isImpersonating } = useClientImpersonation();
  return <CommunityScreen canShare previewOnly={isImpersonating} bell retapPath="/portal/community" />;
}
