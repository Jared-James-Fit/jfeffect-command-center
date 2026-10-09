import { createFileRoute } from "@tanstack/react-router";
import { CommunityScreen } from "@/components/community/community-screen";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * The client community feed, opened from Home's community card (also from
 * More, the header "🔥 new" pill, pushes and the post-share toast). Home stays
 * the lit tab while it's open. No page header: the feed starts right under
 * the app bar, with a back arrow, Feed / Crew / You, the bell and + Share on
 * one row. `#post=<id>` opens a post straight away.
 */
export const Route = createFileRoute("/_authenticated/portal/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: PortalCommunity,
});

function PortalCommunity() {
  const { isImpersonating } = useClientImpersonation();
  return <CommunityScreen canShare previewOnly={isImpersonating} bell backTo="/portal" />;
}
