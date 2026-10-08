import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { CommunityScreen } from "@/components/community/community-screen";
import { useClientImpersonation } from "@/lib/client-impersonation";

/**
 * The client community: its own page, opened from Home (and the header "🔥 new"
 * pill, push notifications, the post-share toast). Back always returns to Home,
 * and Home stays the active tab, so it never strands anyone in Workouts.
 * `#post=<id>` opens a post straight away.
 */
export const Route = createFileRoute("/_authenticated/portal/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: PortalCommunity,
});

function PortalCommunity() {
  const { isImpersonating } = useClientImpersonation();
  return (
    <>
      <PageHeader title="Community" subtitle="What the crew is lifting" backTo="/portal" backLabel="Home" />
      <CommunityScreen canShare previewOnly={isImpersonating} />
    </>
  );
}
