import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { CommunityScreen } from "@/components/community/community-screen";
import { useMemberAccess } from "@/lib/member-access";

/**
 * The community for members. Access is the 'community' entitlement
 * (member_access / member_has_access); the database enforces the same rule
 * in can_view_community(). Members share workouts they built themselves.
 */
export const Route = createFileRoute("/_authenticated/m/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: MemberCommunity,
});

function MemberCommunity() {
  const { loading, hasAccess } = useMemberAccess();
  return (
    <>
      <PageHeader title="Community" subtitle="What the crew is lifting" backTo="/m" backLabel="Home" />
      {loading ? null : hasAccess("community") ? (
        <CommunityScreen canShare />
      ) : (
        <Card className="mx-4 p-6 text-sm text-muted-foreground">
          The community isn't part of your current plan.
        </Card>
      )}
    </>
  );
}
