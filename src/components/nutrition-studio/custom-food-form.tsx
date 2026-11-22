/**
 * A food from its label: per 100 g or per serving (with the serving's weight
 * when the label gives it). Calories that don't match the macros are flagged,
 * never changed: labels round, and fibre and sugar alcohols count differently.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { customFood, type StudioFood } from "@/lib/nutrition-studio/foods";
import { useSaveCustomFood } from "@/components/nutrition-studio/use-studio-foods";

const num = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
};

/** Calories and macros more than 15% (and 20 kcal) apart: worth a second look at the label. */
export function labelLooksOff(kcal: number, p: number, c: number, f: number): boolean {
  const worked = p * 4 + c * 4 + f * 9;
  return Math.abs(worked - kcal) > Math.max(20, kcal * 0.15);
}

export function CustomFoodForm({ initialName = "", onSaved }: { initialName?: string; onSaved: (f: StudioFood) => void }) {
  const save = useSaveCustomFood();
  const [basis, setBasis] = useState<"per_100g" | "per_serving">("per_serving");
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState("");
  const [servingLabel, setServingLabel] = useState("serving");
  const [servingGrams, setServingGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const [p, setP] = useState("");
  const [c, setC] = useState("");
  const [f, setF] = useState("");
  const values = [num(kcal), num(p), num(c), num(f)];
  const ready = name.trim().length > 0 && values.every((v) => v != null && v >= 0);
  const off = ready && labelLooksOff(values[0]!, values[1]!, values[2]!, values[3]!);
  const over100 = ready && basis === "per_100g" && values[1]! + values[2]! + values[3]! > 100.5;

  const submit = async () => {
    if (!ready || over100) return;
    const row = {
      name: name.trim(),
      brand: brand.trim() || null,
      basis,
      serving_label: basis === "per_serving" ? servingLabel.trim() || "serving" : null,
      serving_grams: basis === "per_serving" ? num(servingGrams) : null,
      kcal: values[0]!,
      protein: values[1]!,
      carbs: values[2]!,
      fat: values[3]!,
    };
    try {
      const id = await save.mutateAsync(row);
      onSaved(customFood({ ...row, id }));
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the food");
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <label className="text-[13px] text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => set(e.target.value)} className="h-11 text-base" autoComplete="off" {...props} />
    </div>
  );

  return (
    <div className="space-y-4" data-custom-food-form>
      {field("What it's called", name, setName, { name: "search-food-name", autoFocus: true })}
      {field("Brand (optional)", brand, setBrand, { name: "search-food-brand" })}
      <div className="flex gap-1.5">
        {(
          [
            ["per_serving", "Per serving"],
            ["per_100g", "Per 100 g"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setBasis(k)} className={cn("h-10 flex-1 rounded-lg border text-sm", basis === k ? "border-foreground bg-foreground text-background" : "border-border")}>
            {label}
          </button>
        ))}
      </div>
      {basis === "per_serving" && (
        <div className="grid grid-cols-2 gap-2">
          {field("A serving is", servingLabel, setServingLabel, { placeholder: "bar, cup, serving", name: "search-food-serving" })}
          {field("Weighs (g, optional)", servingGrams, setServingGrams, { inputMode: "decimal" })}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {field("Calories", kcal, setKcal, { inputMode: "decimal" })}
        {field("Protein g", p, setP, { inputMode: "decimal" })}
        {field("Carbs g", c, setC, { inputMode: "decimal" })}
        {field("Fat g", f, setF, { inputMode: "decimal" })}
      </div>
      {over100 && <p className="text-[13px] text-destructive">100 g of a food can't hold more than 100 g of protein, carbs and fat. Check the label.</p>}
      {off && !over100 && (
        <p className="text-[13px] text-muted-foreground" data-label-off>
          The calories don't quite match the macros ({Math.round(values[1]! * 4 + values[2]! * 4 + values[3]! * 9)} kcal from them). Labels round, so that can be fine. Double-check it's what the label says.
        </p>
      )}
      <Button className="h-11 w-full" disabled={!ready || over100 || save.isPending} onClick={submit}>
        {save.isPending ? "Saving…" : "Save food"}
      </Button>
    </div>
  );
}
