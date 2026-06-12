import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { Inbox, RefreshCw, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { notifyCoachOfWorkoutFailure } from "@/lib/support-alerts.functions";
import { runJob } from "@/lib/progress-jobs";

/**
 * Distinct UI for "workout loaded but has no exercises". Different from
 * WorkoutLoadFailureCard (which renders for actual render/load errors).
 * Gives the client a way to ping their coach instead of staring at an
 * empty page.
 */
export function WorkoutEmptyCard({
  clientId,
  clientName,
  workoutId,
  route,
  onRetry,
}: {
  clientId: string | null;
  clientName: string | null;
  workoutId: string | null;
  route: string;
  onRetry: () => void;
}) {
  const notifyFn = useServerFn(notifyCoachOfWorkoutFailure);
  return (
    <Card className="space-y-4 border-amber-500/30 bg-amber-500/5 p-6">
      <div className="flex items-start gap-3">
        <Inbox className="mt-1 h-6 w-6 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <div className="text-base font-bold">No exercises are assigned for this workout yet.</div>
          <div className="text-sm text-muted-foreground">
            If you expected to see exercises here, your coach can add them for you.
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          loadingLabel="Notifying…"
          successLabel="Coach notified"
          icon={<Send className="h-4 w-4" />}
          onAction={async () => {
            await runJob(
              {
                title: "Notifying coach",
                description: clientName ?? "Empty workout",
                steps: ["Capturing context", "Creating alert", "Sending SMS", "Done"],
                successToast: "Coach has been notified",
              },
              async (job) => {
                job.completeStep(0);
                const device = typeof navigator !== "undefined" ? { userAgent: navigator.userAgent } : null;
                job.completeStep(1);
                await notifyFn({
                  data: {
                    client_id: clientId ?? undefined,
                    workout_id: workoutId ?? undefined,
                    page_route: route,
                    error_type: "empty_workout",
                    error_message: "Workout loaded with zero exercises.",
                    device_info: device,
                    details: { app_section: "workout_logger" },
                  },
                });
                job.completeStep(2);
                job.completeStep(3);
              },
            );
          }}
        >
          Notify Coach
        </ActionButton>
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try Again
        </Button>
      </div>
    </Card>
  );
}