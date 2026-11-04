import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { OneRepMaxCalculator } from "@/components/tools/OneRepMaxCalculator";
import { MacroCalculator } from "@/components/tools/MacroCalculator";
import { PlateCalculator } from "@/components/tools/PlateCalculator";
import { WaterCalculator } from "@/components/tools/WaterCalculator";
import { SleepCalculator } from "@/components/tools/SleepCalculator";

export const Route = createFileRoute("/_authenticated/portal/tools")({ component: ToolsPage });

// The calculators. Member resources (the old "More tools" list) only ever held one setup placeholder and are gone.
function ToolsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Tools" subtitle="Calculators and trackers." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <OneRepMaxCalculator />
        <MacroCalculator />
        <PlateCalculator />
        <WaterCalculator />
        <SleepCalculator />
      </div>
    </div>
  );
}
