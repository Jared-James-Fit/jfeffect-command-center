import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf, ComingSoonCard } from "@/components/admin/membership-leaf";
export const Route = createFileRoute("/_authenticated/admin/membership/welcome-messages")({
  component: () => <MembershipLeaf title="Welcome Messages" subtitle="Templates sent after a new member completes setup."><ComingSoonCard note="Edit your SMS & email welcome copy from the SMS / Email tools page until templates land here." /></MembershipLeaf>,
});