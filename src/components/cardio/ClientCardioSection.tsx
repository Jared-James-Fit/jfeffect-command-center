import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Heart, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dayTypeLabel, dayTypeTone } from "@/lib/training-schedule";

/**
 * Read-only cardio section for the client/member Workout page.
 * Sources data from the existing `cardio_targets` table (no duplicate
 * cardio system) and respects client visibility flags:
 *   - visible_to_client = true
 *   - enabled = true
 *   - status = 'Active'
 * Calorie targets only render when show_calories_to_client = true.
 * admin_notes are never shown — only client_notes are coach notes visible
 * to the client.
 *
 * Hides itself entirely when no cardio is assigned and `hideWhenEmpty`
 * is true. Otherwise renders a clean "No cardio assigned." state.
 */
export function ClientCardioSection({
  clientId,
  hideWhenEmpty = false,
  dayContext,
  date,
  readonly,
}: {
  clientId: string;
  hideWhenEmpty?: boolean;
  dayContext?: "rest" | "training";
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
      return data ?? [];
    },
  });

  const filteredTargets = useMemo(() => {
    if (!dayContext) return targets;
    const restTypes = ["Rest Day", "General"];
    const trainingTypes = ["Training Day", "High Day", "General"];
    return targets.filter((t: any) => {
      if (dayContext === "rest") return restTypes.includes(t.day_type);
      if (dayContext === "training") return trainingTypes.includes(t.day_type);
      return true;
    });
  }, [targets, dayContext]);

  if (isLoading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading cardio…
      </Card>
    );
  }

  if (!targets.length) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4 shrink-0" /> Cardio
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">No cardio assigned.</p>
      </Card>
    );
  }

  // Group by program_name so multi-week programs render under a heading.
  const groups: Record<string, any[]> = {};
  for (const t of targets as any[]) {
    const key = t.program_name || "__single__";
    (groups[key] ??= []).push(t);
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Heart className="h-4 w-4 shrink-0" /> Cardio
      </h2>
      <div className="space-y-4">
        {Object.entries(groups).map(([programName, items]) => (
          <div key={programName} className="space-y-2">
            {programName !== "__single__" && (
              <div className="text-xs font-bold uppercase tracking-widest text-primary">
                {programName}
              </div>
            )}
            <ul className="space-y-2">
              {items.map((t: any) => {
                const typeName =
                  t.cardio_type === "Custom" ? t.custom_type || "Custom" : t.cardio_type;
                const cal =
                  t.show_calories_to_client &&
                  (t.calorie_target_min || t.calorie_target_max)
                    ? t.calorie_target_min && t.calorie_target_max
                      ? `${t.calorie_target_min}–${t.calorie_target_max} cal`
                      : `${t.calorie_target_min ?? t.calorie_target_max} cal`
                    : null;
                const metaParts: string[] = [];
                if (t.frequency_per_week) metaParts.push(`${t.frequency_per_week}×/week`);
                if (t.duration_minutes) metaParts.push(`${t.duration_minutes} min`);
                if (t.intensity) metaParts.push(t.intensity);
                if (t.heart_rate_zone) metaParts.push(t.heart_rate_zone);
                if (t.machine_preference) metaParts.push(t.machine_preference);
                if (t.step_target) metaParts.push(`${t.step_target.toLocaleString()} steps`);
                return (
                  <li
                    key={t.id}
                    className="rounded-md border border-border bg-secondary/20 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={dayTypeTone(t.day_type)}>
                        {dayTypeLabel(t)}
                      </Badge>
                      <span className="font-semibold">{typeName}</span>
                      {cal && (
                        <Badge variant="outline" className="text-[10px]">
                          {cal}
                        </Badge>
                      )}
                    </div>
                    {metaParts.length > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {metaParts.join(" · ")}
                      </div>
                    )}
                    {t.goal && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Goal: <span className="text-foreground">{t.goal}</span>
                      </div>
                    )}
                    {t.client_notes && (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {t.client_notes}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}