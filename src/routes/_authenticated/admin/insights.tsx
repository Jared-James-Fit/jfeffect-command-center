import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { AppIntelPage } from "@/components/admin/intel/app-intel-page";

/**
 * App & website: who's here now, who comes back, what they use, how they found you, where they
 * are (approximately) and what it earns (Nov 23 2026). Admin only (the server checks again).
 */
export const Route = createFileRoute("/_authenticated/admin/insights")({
  head: () => ({ meta: [{ title: "App & website · JF Effect" }] }),
  component: InsightsRoute,
});

function InsightsRoute() {
  const { accountRole, loading } = useAuth();
  if (loading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  if (accountRole !== "admin") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <PageHeader title="App & website" />
        <Card className="p-4 text-[13px] text-muted-foreground">Only an admin can see this page.</Card>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="App & website" />
      <AppIntelPage />
    </>
  );
}
