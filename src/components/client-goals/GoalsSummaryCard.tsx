import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { WEEKDAY_LABELS, isGoalsSetupComplete, type ClientGoalsSetupRow } from "@/lib/client-goals/schema";

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <div className={"text-xs uppercase tracking-wide " + (warn ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground")}>
        {label}
      </div>
      <div className="min-w-0 max-w-[60%] text-right text-sm">
        {value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function chips(items: string[] | null | undefined) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {items.map((x) => (
        <Badge key={x} variant="secondary" className="text-[10px]">{x}</Badge>
      ))}
    </div>
  );
}

export function GoalsSummaryCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["client-goals-setup", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_goals_setup")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as ClientGoalsSetupRow | null;
    },
  });

  if (isLoading) {
    return <Card className="p-4 text-sm text-muted-foreground">Loading Goals & Setup…</Card>;
  }

  const row = data ?? null;
  const complete = isGoalsSetupComplete(row);

  if (!row) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <div className="text-sm font-semibold">Goals & Setup incomplete</div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          This client hasn't completed Goals & Setup yet.
        </p>
      </Card>
    );
  }

  const goal = row.main_goal === "Other" ? (row.main_goal_other || "Other") : row.main_goal;
  const days = (row.available_weekdays ?? []).map((d) => WEEKDAY_LABELS[d as keyof typeof WEEKDAY_LABELS] ?? d);
  const equipDisplay = (() => {
    const byLoc = row.equipment_by_location ?? {};
    const locKeys = Object.keys(byLoc);
    if (locKeys.length === 0) return chips(row.equipment);
    return (
      <div className="space-y-1">
        {locKeys.map((k) => (
          <div key={k}>
            <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
            {chips(byLoc[k]) ?? <div className="text-xs text-muted-foreground">—</div>}
          </div>
        ))}
      </div>
    );
  })();

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">Client Profile Summary</div>
        {complete ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <CheckCircle2 className="h-3 w-3" /> Complete
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Incomplete
          </Badge>
        )}
        <div className="ml-auto text-[11px] text-muted-foreground">
          Updated {new Date(row.updated_at).toLocaleDateString()}
        </div>
      </div>
      <div className="divide-y divide-border/60">
        <Row label="Main goal" value={goal} />
        <Row label="Target / deadline" value={row.goal_target} />
        <Row label="Days / week" value={row.training_days_per_week ? `${row.training_days_per_week} days` : null} />
        <Row label="Available weekdays" value={chips(days)} />
        <Row label="Workout length" value={row.workout_length_minutes ? `${row.workout_length_minutes} min` : null} />
        <Row label="Experience" value={row.training_experience} />
        <Row label="Training style" value={chips(row.training_styles)} />
        <Row label="Training location" value={row.training_location} />
        <Row label="Equipment access" value={equipDisplay} />
        <Row label="Nutrition goal" value={row.nutrition_goal} />
        <Row label="Nutrition preference" value={row.nutrition_preference} />
        <Row
          label="Food restrictions"
          warn={row.food_restrictions_has}
          value={row.food_restrictions_has ? (row.food_restrictions_details || "Yes — no details") : "None"}
        />
        <Row label="Nutrition challenges" value={chips(row.nutrition_challenges)} />
        <Row
          label="Injuries / limitations"
          warn={row.injuries_has}
          value={row.injuries_has ? (row.injuries_details || "Yes — no details") : "None"}
        />
        {row.final_notes && <Row label="Final notes" value={<span className="text-left">{row.final_notes}</span>} />}
        <Row
          label="Last reviewed"
          value={row.last_reviewed_at ? new Date(row.last_reviewed_at).toLocaleDateString() : "Not yet"}
        />
      </div>
    </Card>
  );
}