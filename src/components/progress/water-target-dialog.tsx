import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ensureWaterTarget, formatWater, lToMl, ozToMl,
  setCustomWaterTarget, suggestTargetMl, useAutoWaterTarget,
} from "@/lib/water";
import { getLatestBodyweightKg } from "@/lib/bodyweight";

export function WaterTargetDialog({
  open, onOpenChange, userId, currentUserId, viewerRole,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"ml" | "L" | "oz">("L");
  const [saving, setSaving] = useState(false);

  const targetQ = useQuery({
    queryKey: ["water-target", userId],
    enabled: open && !!userId,
    queryFn: () => ensureWaterTarget(userId),
  });
  const bwQ = useQuery({
    queryKey: ["latest-bodyweight-kg", userId],
    enabled: open && !!userId,
    queryFn: () => getLatestBodyweightKg(userId),
  });

  useEffect(() => {
    if (!targetQ.data) return;
    setMode(targetQ.data.mode);
    setAmount((targetQ.data.active_ml / 1000).toString());
    setUnit("L");
  }, [targetQ.data]);

  const suggested = suggestTargetMl(bwQ.data ?? null);
  const target = targetQ.data;

  const source =
    target?.target_source === "coach" ? "Coach set"
    : target?.target_source === "admin" ? "Admin set"
    : target?.target_source === "user" ? "Custom"
    : target?.target_source === "auto" ? "Suggested"
    : "Default";

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === "auto") {
        await useAutoWaterTarget({
          userId, setByUserId: currentUserId, bodyweightKg: bwQ.data ?? null,
        });
        toast.success("Using automatic suggestion");
      } else {
        const n = Number(amount);
        if (!amount || Number.isNaN(n) || n <= 0) {
          toast.error("Enter a valid target");
          setSaving(false);
          return;
        }
        const ml = unit === "ml" ? Math.round(n) : unit === "L" ? lToMl(n) : ozToMl(n);
        const setterSource = viewerRole === "coach"
          ? "coach" : viewerRole === "admin" ? "admin" : "user";
        await setCustomWaterTarget({
          userId, activeMl: ml,
          source: setterSource as "user" | "coach" | "admin",
          setByUserId: currentUserId,
        });
        toast.success(`Target set to ${formatWater(ml, "L")}`);
      }
      qc.invalidateQueries({ queryKey: ["water-target", userId] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save target");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Water target <Badge variant="outline" className="text-[10px]">{source}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 p-3">
            <div>
              <div className="text-sm font-semibold">Use automatic suggestion</div>
              <div className="text-xs text-muted-foreground">
                {bwQ.data
                  ? `Based on bodyweight (${bwQ.data.toFixed(1)} kg × 35 mL): ${formatWater(suggested, "L")}`
                  : `Default suggestion: ${formatWater(3000, "L")} until bodyweight is logged.`}
              </div>
            </div>
            <Switch
              checked={mode === "auto"}
              onCheckedChange={(v) => setMode(v ? "auto" : "custom")}
            />
          </div>

          {mode === "custom" && (
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Custom target</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={unit === "ml" ? "e.g. 3000" : unit === "L" ? "e.g. 3.0" : "e.g. 100"}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unit</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as "ml" | "L" | "oz")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">L</SelectItem>
                    <SelectItem value="ml">mL</SelectItem>
                    <SelectItem value="oz">oz</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Water needs vary based on climate, activity, diet, medications, and health conditions.
            This is a general estimate.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save target</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}