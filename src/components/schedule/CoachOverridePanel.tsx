import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Lock, ShieldAlert, Loader2 } from "lucide-react";
import { setScheduleLock, coachOverrideCompletedMove } from "@/lib/schedule-bulk.functions";
import type { ScheduleDay, ScheduleCompletion } from "./ScheduleCalendar";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export interface CoachOverridePanelProps {
  clientId: string;
  clientName: string;
  scheduleLocked: boolean;
  days: ScheduleDay[];
  completions: ScheduleCompletion[];
}

export function CoachOverridePanel({ clientId, clientName, scheduleLocked, days, completions }: CoachOverridePanelProps) {
  const qc = useQueryClient();
  const lockFn = useServerFn(setScheduleLock);
  const overrideFn = useServerFn(coachOverrideCompletedMove);

  const [overrideDayId, setOverrideDayId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [updateCompletedAt, setUpdateCompletedAt] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);

  const completedSet = new Set(completions.filter((c) => c.completed_at).map((c) => c.day_id));
  const completedDays = days.filter((d) => completedSet.has(d.id));

  const lockMut = useMutation({
    mutationFn: (locked: boolean) => lockFn({ data: { clientId, locked } }),
    onSuccess: (res: any) => {
      toast.success(res.locked ? "Schedule locked." : "Schedule unlocked.");
      void qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not change lock."),
  });

  const overrideMut = useMutation({
    mutationFn: async () => overrideFn({
      data: {
        dayId: overrideDayId!,
        newDate: ymd(newDate!),
        updateCompletedAt,
        acknowledge: true,
      },
    }),
    onSuccess: () => {
      toast.success("Completed workout date rewritten.");
      void qc.invalidateQueries();
      setOverrideDayId(null);
      setNewDate(null);
      setUpdateCompletedAt(false);
      setAcknowledge(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not override."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" /> Coach controls — {clientName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <div>
            <Label className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4" /> Lock client schedule editing</Label>
            <p className="text-xs text-muted-foreground mt-1">When locked, the client cannot move workouts in the portal.</p>
          </div>
          <Switch checked={scheduleLocked} onCheckedChange={(v) => lockMut.mutate(v)} disabled={lockMut.isPending} />
        </div>

        <div>
          <div className="font-medium mb-2">Override a completed workout's date</div>
          {completedDays.length === 0 && (
            <p className="text-xs text-muted-foreground">No completed workouts to override.</p>
          )}
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {completedDays.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.title?.trim() || `Day ${d.day_index}`}</div>
                  <div className="text-muted-foreground">Scheduled {d.scheduled_date ?? "—"}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setOverrideDayId(d.id); setNewDate(d.scheduled_date ? new Date(d.scheduled_date + "T00:00:00") : new Date()); }}>
                  Override
                </Button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>

      <Dialog open={!!overrideDayId} onOpenChange={(o) => !o && setOverrideDayId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override completed workout</DialogTitle>
            <DialogDescription>
              This rewrites this completed workout's scheduled date. Choose whether to also rewrite the completion timestamp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-card">
              <Calendar mode="single" selected={newDate ?? undefined} onSelect={(d) => d && setNewDate(d)} className="p-3 pointer-events-auto" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={updateCompletedAt} onCheckedChange={(v) => setUpdateCompletedAt(!!v)} />
              Also rewrite completed_at to match the new date
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={acknowledge} onCheckedChange={(v) => setAcknowledge(!!v)} />
              I understand this rewrites client history.
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideDayId(null)}>Cancel</Button>
            <Button disabled={!newDate || !acknowledge || overrideMut.isPending} onClick={() => overrideMut.mutate()}>
              {overrideMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Apply override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
