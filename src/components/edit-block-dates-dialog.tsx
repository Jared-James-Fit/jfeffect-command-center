import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";
import { setBlockStartDate, computeBlockEnd } from "@/lib/block-dates";
import { setBlockEndDate } from "@/lib/pl-programs";
import { format } from "date-fns";

export function EditBlockDatesDialog({
  open,
  onOpenChange,
  blockId,
  initialStart,
  initialEnd,
  weeks,
  weekDurationDays,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blockId: string;
  initialStart: string | null;
  initialEnd: string | null;
  weeks: number;
  weekDurationDays: number;
  onSaved?: () => void;
}) {
  const [start, setStart] = useState(initialStart ?? "");
  const [end, setEnd] = useState(initialEnd ?? "");
  const [endTouched, setEndTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setStart(initialStart ?? "");
      setEnd(initialEnd ?? "");
      setEndTouched(false);
    }
  }, [open, initialStart, initialEnd]);

  // Auto-recompute end when start changes (unless user manually edited end).
  useEffect(() => {
    if (endTouched) return;
    if (!start) { setEnd(""); return; }
    const computed = computeBlockEnd(start, weeks, weekDurationDays);
    if (computed) setEnd(format(computed, "yyyy-MM-dd"));
  }, [start, weeks, weekDurationDays, endTouched]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Block Dates</DialogTitle>
          <DialogDescription>
            Changing the start date recalculates the end date automatically. Manually editing the end date overrides it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Start date</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>End date</Label>
            <Input
              type="date"
              value={end}
              onChange={(e) => { setEnd(e.target.value); setEndTouched(true); }}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {endTouched ? "Manual end date (won't auto-recompute)." : "Auto-calculated from start + block length."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <ActionButton
            loadingLabel="Saving…"
            successLabel="Saved"
            successToast="Block dates updated"
            onAction={async () => {
              await setBlockStartDate({ blockId, startDate: start || null, weekDurationDays });
              if (endTouched) {
                await setBlockEndDate(blockId, end || null);
              }
              onSaved?.();
              onOpenChange(false);
            }}
          >
            Save dates
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}