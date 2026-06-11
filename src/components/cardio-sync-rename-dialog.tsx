import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dayTypeLabel } from "@/lib/training-schedule";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  orphaned: any[];
  nutritionLabels: string[];
};

const KNOWN = ["Training Day", "Rest Day", "High Day", "General"];

export function CardioSyncRenameDialog({ open, onOpenChange, clientId, orphaned, nutritionLabels }: Props) {
  const qc = useQueryClient();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    orphaned.forEach((r) => {
      const guess = nutritionLabels.find((l) => KNOWN.includes(l) && (l.toLowerCase().includes(r.day_type?.toLowerCase()?.split(" ")[0] ?? "")))
        ?? nutritionLabels[0]
        ?? "";
      init[r.id] = guess;
    });
    setChoices(init);
  }, [open, orphaned, nutritionLabels]);

  const apply = async (rowId: string) => {
    const target = choices[rowId];
    if (!target) return;
    setSaving(true);
    const isKnown = KNOWN.includes(target);
    const patch: any = isKnown
      ? { day_type: target, custom_day_type: null }
      : { day_type: "Custom", custom_day_type: target };
    const { error } = await supabase.from("cardio_targets").update(patch).eq("id", rowId);
    setSaving(false);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    toast.success("Cardio name updated");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync Cardio Names</DialogTitle>
          <DialogDescription>
            Nutrition day types changed. Update these cardio targets to match, or keep their current names.
          </DialogDescription>
        </DialogHeader>
        {orphaned.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">All cardio targets are aligned.</div>
        ) : (
          <ul className="space-y-2">
            {orphaned.map((r) => (
              <li key={r.id} className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="border-warning/40 text-warning">{dayTypeLabel(r)}</Badge>
                  <span className="text-xs text-muted-foreground">{r.cardio_type} · {r.duration_minutes ?? "?"} min</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={choices[r.id] ?? ""} onValueChange={(v) => setChoices({ ...choices, [r.id]: v })}>
                    <SelectTrigger className="h-9 max-w-xs"><SelectValue placeholder="Pick a nutrition day" /></SelectTrigger>
                    <SelectContent>
                      {nutritionLabels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={saving || !choices[r.id]} onClick={() => apply(r.id)}>Update Cardio Name</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}