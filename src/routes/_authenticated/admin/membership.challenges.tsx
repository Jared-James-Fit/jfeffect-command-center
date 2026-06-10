import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf, ComingSoonCard } from "@/components/admin/membership-leaf";
export const Route = createFileRoute("/_authenticated/admin/membership/challenges")({
  component: () => <MembershipLeaf title="Challenges" subtitle="Group challenges for members."><ComingSoonCard /></MembershipLeaf>,
});