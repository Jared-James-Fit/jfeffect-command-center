import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";

export const Route = createFileRoute("/wp-verify")({ component: P });

function Cell({ unit, ref_ }: { unit: "kg" | "lb"; ref_: number | null }) {
  const [v, setV] = useState("");
  const [bw, setBw] = useState(false);
  return (
    <div className="w-24" data-testid={`cell-${unit}-${ref_ ?? "none"}`}>
      <WeightValueInput
        value={v}
        isBodyweight={bw}
        unit={unit}
        referenceWeight={ref_}
        ariaLabel={`w-${unit}-${ref_ ?? "none"}`}
        onPick={({ load, bodyweight }) => { setV(bodyweight ? "0" : load); setBw(bodyweight); }}
      />
    </div>
  );
}

function P() {
  return (
    <div className="space-y-6 p-4">
      <Cell unit="kg" ref_={null} />
      <Cell unit="kg" ref_={170} />
      <Cell unit="lb" ref_={null} />
    </div>
  );
}
