import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ProgressSection } from "@/components/progress/progress-section";

export const Route = createFileRoute("/_authenticated/m/progress")({
  component: MemberProgress,
});

function MemberProgress() {
  const fetchMe = useServerFn(getCurrentMember);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const member: any = me?.member;

  if (!member) {
    return (
      <>
        <PageHeader title="Progress" subtitle="Track your progress." />
        <div className="p-6"><Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Progress" subtitle="Photos, videos, weight, and measurements — saved to your account." />
      <ProgressSection
        ctx={{
          userId: member.user_id,
          ownerType: "member",
          clientId: null,
          memberId: member.id,
          assignedCoachId: null,
          viewerRole: "owner",
          preferredWeightUnit: (member.preferred_weight_unit as any) ?? "lb",
          canRequestReview: false,
        }}
      />
    </>
  );
}
