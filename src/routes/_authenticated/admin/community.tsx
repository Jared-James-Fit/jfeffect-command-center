import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { CommunityScreen } from "@/components/community/community-screen";

export const Route = createFileRoute("/_authenticated/admin/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: AdminCommunity,
});

function AdminCommunity() {
  return (
    <>
      <PageHeader title="Community" subtitle="Workouts clients chose to share. A reaction or comment from you shows as Coach recognition." />
      <CommunityScreen />
    </>
  );
}
