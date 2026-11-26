import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dualLoadText, inputKg, kgIn, otherUnit, roundUpWeight, weightNumber, type WeightUnit } from "@/lib/dual-weight";

export type WeightDraft = { value: string; unit: WeightUnit };
export function draftKg(draft: WeightDraft): number | null {
  const v = Number(draft.value);
  return draft.value.trim() && Number.isFinite(v) && v > 0 ? inputKg(v, draft.unit) : null;
}

/** The original draft stays authoritative until a user types or intentionally
 * rounds. Switching the display unit never reinterprets or rounds the draft. */
export function CompactWeightInput({ draft, onChange, incrementKg, confirmed, autoFocus = false, disabled = false }: {
  draft: WeightDraft;
  onChange: (draft: WeightDraft) => void;
  incrementKg?: number;
  confirmed?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [displayUnit, setDisplayUnit] = useState(draft.unit);
  const kg = draftKg(draft);
  const raw = displayUnit === draft.unit ? draft.value : kg == null ? "" : weightNumber(kgIn(kg, displayUnit), 3);
  const next = kg != null && incrementKg != null ? roundUpWeight(kg, incrementKg) : null;
  const other = otherUnit(displayUnit);
  return (
    <div className="min-w-0 space-y-1" data-compact-weight-input>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input type="text" inputMode="decimal" autoFocus={autoFocus} onFocus={(e) => e.currentTarget.select()}
          aria-label="Target weight" placeholder="Weight" disabled={disabled} value={raw}
          onChange={(e) => onChange({ value: e.target.value, unit: displayUnit })}
          className="h-9 w-20 shrink-0 px-2 tabular-nums" />
        <Select value={displayUnit} onValueChange={(v) => setDisplayUnit(v as WeightUnit)} disabled={disabled}>
          <SelectTrigger className="h-9 w-[62px] shrink-0 px-2" aria-label="Weight unit"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="kg">kg</SelectItem><SelectItem value="lb">lb</SelectItem></SelectContent>
        </Select>
        {kg != null && <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-live="polite">= {weightNumber(kgIn(kg, other), 1)} {other}</span>}
      </div>
      {next != null && <Button type="button" size="sm" variant="outline" disabled={disabled} className="min-h-9 h-auto whitespace-normal px-2 py-1 text-xs"
        onClick={() => onChange({ value: String(next), unit: "kg" })}>
        Round up to {dualLoadText(next, "kg")}
      </Button>}
      {next != null && !confirmed && <p className="text-[10px] text-muted-foreground">Standard increment · confirm meet rules</p>}
    </div>
  );
}
