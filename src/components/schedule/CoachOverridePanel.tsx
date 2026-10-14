import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import type { ScheduleDay, ScheduleCompletion } from "./ScheduleCalendar";

export interface CoachOverridePanelProps {
  clientId: string;
  clientName: string;
  days: ScheduleDay[];
  completions: ScheduleCompletion[];
}

/**
 * The coach's notes on a client's schedule. Clients can always move their own
 * upcoming workouts (there's no lock for that); what's fixed is what's done.
 */
export function CoachOverridePanel({ clientName, days, completions }: CoachOverridePanelProps) {
  const completedSet = new Set(completions.filter((c) => c.completed_at).map((c) => c.day_id));
  const completedCount = days.filter((d) => completedSet.has(d.id)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" /> Coach controls — {clientName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {clientName.split(" ")[0]} can move any upcoming workout from their calendar. Workouts you place keep their date when the schedule is re-planned automatically.
        </p>

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
