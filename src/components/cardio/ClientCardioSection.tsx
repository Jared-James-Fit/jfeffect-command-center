/**
 * ClientCardioSection — shows cardio targets for the client/member workout page.
 *
 * Day-type filtering:
 *   - "training" → shows "Training Day" and "General" targets
 *   - "rest"     → shows "Rest Day" and "General" targets
 *   - "unknown"  → shows all targets (no filter)
 *
 * Each target shows a CardioCompletionCard with a one-tap complete toggle
 * and an expandable log form (duration, type, RPE, notes).
 *
 * Admin/coach view is read-only.
 */

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CardioCompletionCard } from "./CardioCompletionCard";

type DayContext = "training" | "rest" | "unknown";

export function ClientCardioSection({
  clientId,
  hideWhenEmpty = false,
  dayContext = "unknown",
  date,
  readonly = false,
}: {
  clientId: string;
  hideWhenEmpty?: boolean;
  /** Whether today is a training day, rest day, or unknown */
  dayContext?: DayContext;
  date?: Date;
  readonly?: boolean;
}) {
  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["client-cardio-visible", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cardio_targets")
        .select(
          "id,cardio_type,custom_type,day_type,custom_day_type,frequency_per_week,duration_minutes,intensity,heart_rate_zone,machine_preference,goal,step_target,calorie_target_min,calorie_target_max,show_calories_to_client,client_notes,program_name,start_date,end_date",
        )
        .eq("client_id", clientId)
        .eq("visible_to_client", true)
        .eq("enabled", true)
        .eq("status", "Active")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Filter targets by day context
  const filteredTargets = targets.filter((t: any) => {
    if (dayContext === "unknown") return true;
    const dt = (t.day_type ?? "General").toLowerCase();
    if (dayContext === "training") {
      return dt === "training day" || dt === "general" || dt === "high day";
    }
    if (dayContext === "rest") {
      return dt === "rest day" || dt === "general";
    }
    return true;
  });

  if (isLoading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading cardio…
      </Card>
    );
  }

  if (!filteredTargets.length) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4 shrink-0" /> Cardio
        </h2>
        {dayContext === "rest" ? (
          <p className="mt-3 text-sm text-muted-foreground">Rest day — no cardio assigned.</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No cardio assigned.</p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground px-0.5">
        <Heart className="h-4 w-4 shrink-0" /> Cardio
        {dayContext === "training" && (
          <span className="text-primary font-bold">· Training Day</span>
        )}
        {dayContext === "rest" && (
          <span className="text-muted-foreground font-bold">· Rest Day</span>
        )}
      </h2>
      {filteredTargets.map((t: any) => (
        <CardioCompletionCard
          key={t.id}
          target={t}
          clientId={clientId}
          date={date}
          readonly={readonly}
        />
      ))}
    </div>
  );
}
