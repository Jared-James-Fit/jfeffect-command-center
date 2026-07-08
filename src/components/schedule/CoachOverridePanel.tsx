import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Lock, ShieldAlert } from "lucide-react";
import { setScheduleLock } from "@/lib/schedule-bulk.functions";
import type { ScheduleDay, ScheduleCompletion } from "./ScheduleCalendar";

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

  const completedSet = new Set(completions.filter((c) => c.completed_at).map((c) => c.day_id));
  const completedCount = days.filter((d) => completedSet.has(d.id)).length;

  const lockMut = useMutation({
    mutationFn: (locked: boolean) => lockFn({ data: { clientId, locked } }),
    onSuccess: (res: any) => {
      toast.success(res.locked ? "Schedule locked." : "Schedule unlocked.");
      void qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not change lock."),
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

        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
          <div className="font-medium mb-1">Completed workouts are locked ({completedCount})</div>
          <p className="text-muted-foreground">
            Once a workout is completed, its scheduled date, time, and order
            are permanent. To reproduce it on a new date, schedule a new copy
            from the client calendar — the original completion stays as
            historical record.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
