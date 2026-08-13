import { createFileRoute } from "@tanstack/react-router";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";

export const Route = createFileRoute("/devcheck-load-menu")({ component: () => (
  <div style={{ padding: 24, width: 160 }}>
    <WeightValueInput value="" loadType="external" unit="lb" ariaLabel="Weight" onPick={() => {}} />
  </div>
) });
