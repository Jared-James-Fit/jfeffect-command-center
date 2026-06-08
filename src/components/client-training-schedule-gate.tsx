import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { CalendarClock } from "lucide-react";
import { TrainingScheduleCard } from "@/components/training-schedule-card";

/**
 * Blocks the client portal until the committed training schedule is set.
 * Admin impersonating a client bypasses this gate.
 */
export function ClientTrainingScheduleGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();

  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client-schedule-gate", user?.id],
    enabled: !!user && !isImpersonating,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isImpersonating) return <>{children}</>;
  if (!user || isLoading || !client) return <>{children}</>;
  if (client.training_schedule_completed) return <>{children}</>;

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4 md:p-6">
      <Card className="w-full max-w-2xl border-border bg-card p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">Set your training schedule</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell us how many days a week you're committed to training and which days. This is required before you can use the rest of the portal — you can update it anytime in Account Settings.
            </p>
          </div>
        </div>
        <TrainingScheduleCard client={client as any} editable />
      </Card>
    </div>
  );
}