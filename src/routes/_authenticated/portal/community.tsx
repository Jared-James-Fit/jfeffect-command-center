import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { CommunityScreen } from "@/components/community/community-screen";

export const Route = createFileRoute("/_authenticated/portal/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: PortalCommunity,
});

function PortalCommunity() {
  return (
    <>
      <PageHeader title="Community" subtitle="Workouts people chose to share. Optional, always." />
      <CommunityScreen />
    </>
  );
}
