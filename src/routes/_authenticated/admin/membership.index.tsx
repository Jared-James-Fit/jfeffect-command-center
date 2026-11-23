import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { MembershipHome } from "@/components/admin/intel/membership-home";

/**
 * Membership (Nov 23 2026): health and growth, what needs the coach, the plans members can move
 * to, then the members. The old dashboard's tools (action needed, legacy subscriptions, setup and
 * reset links, onboarding email, checkout settings, the member-app preview) are in its ⋯ menu.
 */
export const Route = createFileRoute("/_authenticated/admin/membership/")({
  head: () => ({ meta: [{ title: "Membership · JF Effect" }] }),
  component: MembershipRoute,
});

function MembershipRoute() {
  return (
    <>
      <PageHeader title="Membership" />
      <MembershipHome />
    </>
  );
}
