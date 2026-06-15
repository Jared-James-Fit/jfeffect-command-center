import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { JfMembershipSettingsCard } from "@/components/admin/jf-membership-settings-card";

export const Route = createFileRoute("/_authenticated/admin/membership/checkout-settings")({
  component: () => (
    <MembershipLeaf
      title="Checkout Settings"
      subtitle="Master kill switch for /membership plus Stripe pricing, mode, and trial configuration."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <JfMembershipSettingsCard />
      </div>
    </MembershipLeaf>
  ),
});