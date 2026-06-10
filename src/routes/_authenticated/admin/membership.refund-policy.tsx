import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { JfMembershipSettingsCard } from "@/components/admin/jf-membership-settings-card";

export const Route = createFileRoute("/_authenticated/admin/membership/refund-policy")({
  component: () => (
    <MembershipLeaf title="Refund / Cancellation Policy" subtitle="Shown on the public signup page and in member billing.">
      <div className="grid gap-4 md:grid-cols-2"><JfMembershipSettingsCard /></div>
    </MembershipLeaf>
  ),
});