import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Flame } from "lucide-react";
import { toast } from "sonner";
import { WarmupPicker, type WarmupMode } from "@/components/warmup-picker";

const sb = supabase as any;

export function ExerciseWarmupDialog({
  exercise,
  open,
  onClose,
}: {
  exercise: { id: string; name: string; warmup_notes?: string | null; warmup_protocol_id?: string | null; is_powerlifting?: boolean; pl_lift_group?: string | null } | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [isPl, setIsPl] = useState(false);
  const [liftGroup, setLiftGroup] = useState<string>("none");
  const [mode, setMode] = useState<WarmupMode>("default");
  const [protocolId, setProtocolId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!exercise) return;
    setNotes(exercise.warmup_notes ?? "");
    setIsPl(!!exercise.is_powerlifting);
    setLiftGroup(exercise.pl_lift_group ?? "none");
    if (exercise.warmup_protocol_id) {
      setMode("custom");
      setProtocolId(exercise.warmup_protocol_id);
    } else {
      setMode("default");
      setProtocolId(null);
    }
  }, [exercise?.id]);

  if (!exercise) return null;

  const save = async () => {
    setSaving(true);
    const patch: any = {
      warmup_notes: notes.trim() || null,
      is_powerlifting: isPl,
      pl_lift_group: liftGroup === "none" ? null : liftGroup,
      warmup_protocol_id: mode === "custom" ? protocolId : mode === "none" ? null : null,
    };
    const { error } = await sb.from("exercises").update(patch).eq("id", exercise.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["exercises"] });
      qc.invalidateQueries({ queryKey: ["exercises-min"] });
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" /> Warm-Up — {exercise.name}
          </DialogTitle>
          <DialogDescription>
            Powerlifting flag drives auto-detect on the workout warm-up sheet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border p-2">
            <Label htmlFor="ex-pl-toggle" className="text-sm">Powerlifting exercise</Label>
            <Switch id="ex-pl-toggle" checked={isPl} onCheckedChange={setIsPl} />
          </div>
          {isPl && (
            <div>
              <Label>Lift group</Label>
              <Select value={liftGroup} onValueChange={setLiftGroup}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="squat">Squat</SelectItem>
                  <SelectItem value="bench">Bench</SelectItem>
                  <SelectItem value="deadlift">Deadlift</SelectItem>
                  <SelectItem value="none">Other / none</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Warm-up notes (shown on exercise)</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 1 lighter set of 8–10, focus on hinge pattern." />
          </div>
          <WarmupPicker
            label="Exercise-Specific Protocol"
            mode={mode}
            protocolId={protocolId}
            onChange={(v) => {
              setMode(v.mode);
              setProtocolId(v.protocolId);
            }}
          />
        </div>
        <DialogFooter>
          <ActionButton variant="ghost" onClick={onClose}>Cancel</ActionButton>
          <ActionButton onClick={save} jobLabel="Saving warmup protocol">Save</ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}