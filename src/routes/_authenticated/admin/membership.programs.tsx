import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { ProgramLibrary } from "./program-library";

export const Route = createFileRoute("/_authenticated/admin/membership/programs")({
  component: MembershipProgramsPage,
});

function MembershipProgramsPage() {
  return (
    <MembershipLeaf
      title="Membership Programs"
      subtitle="Workout programs available to the Membership App. Use the Membership App tag instead of title markers."
    >
      <ProgramLibrary embedded initialAudience="membership" />
    </MembershipLeaf>
  );
}
