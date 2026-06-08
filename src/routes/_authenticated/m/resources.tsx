import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/m/resources")({ component: ResourcesPage });

function ResourcesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Resources" subtitle="Guides, PDFs, and videos included in your membership." />
      <Card className="p-6 text-sm text-muted-foreground">Resource library coming soon.</Card>
    </div>
  );
}