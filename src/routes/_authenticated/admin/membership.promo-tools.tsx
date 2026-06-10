import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf, ComingSoonCard } from "@/components/admin/membership-leaf";
export const Route = createFileRoute("/_authenticated/admin/membership/promo-tools")({
  component: () => <MembershipLeaf title="Promo Tools" subtitle="Promotional codes & limited-time pricing."><ComingSoonCard note="Stripe coupon manager will live here." /></MembershipLeaf>,
});