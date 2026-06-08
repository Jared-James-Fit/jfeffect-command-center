import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/m/tools")({ component: ToolsPage });

function ToolsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Tools" subtitle="Calculators and trackers." />
      <Card className="p-6 text-sm text-muted-foreground">Tools coming soon — RPE/RIR guide, 1RM estimator, training max calculator.</Card>
    </div>
  );
}