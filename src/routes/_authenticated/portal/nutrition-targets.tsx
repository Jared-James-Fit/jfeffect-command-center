import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Apple, Beef, Wheat, Droplets, Footprints, Flame, Cookie } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({ component: NutritionTargets });

function NutritionTargets() {
  const { user } = useAuth();

  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("user_id", user!.id).maybeSingle()).data,
  });

  const { data: targets = [] } = useQuery({
    queryKey: ["my-nutrition-targets", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("nutrition_targets")
        .select("*, nutrition_target_days(*)")
        .eq("client_id", client!.id)
        .neq("status", "Archived")
        .order("start_date", { ascending: false });
      return data ?? [];
    },
  });

  const current = targets[0] as any;

  return (
    <>
      <PageHeader title="Nutrition Targets" subtitle={current ? (current.phase === "Custom" ? current.custom_phase : current.phase) : "Your assigned targets from Coach Jared."} />
      <div className="p-6 md:p-8 space-y-6">
        {!current ? (
          <Card className="border-border bg-card p-10 text-center">
            <Apple className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-4 text-xl font-black">No targets assigned yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Your coach hasn't set up your nutrition targets. Check back soon.</p>
          </Card>
        ) : (
          <>
            <Card className="border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">Current goal</div>
                  <div className="mt-1 text-lg font-black">{current.goal === "Custom" ? current.custom_goal : current.goal}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Start: {current.start_date}</div>
                  <div>End: {current.end_date ?? "ongoing"}</div>
                  <div>Last updated: {new Date(current.last_updated_at).toLocaleDateString()}</div>
                </div>
              </div>
              {current.client_notes && (
                <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{current.client_notes}</div>
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {(current.nutrition_target_days ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((day: any) => (
                <DayCard key={day.id} day={day} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function DayCard({ day }: { day: any }) {
  return (
    <Card className="border-border bg-card p-6">
      <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{day.day_label}</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Macro icon={Flame} label="Calories" value={day.calories} unit="kcal" />
        <Macro icon={Beef} label="Protein" value={day.protein} unit="g" />
        <Macro icon={Wheat} label="Carbs" value={day.carbs} unit="g" />
        <Macro icon={Cookie} label="Fats" value={day.fats} unit="g" />
        <Macro icon={Droplets} label="Water" value={day.water} unit="oz" />
        <Macro icon={Footprints} label="Steps" value={day.steps} unit="" />
      </div>
      {day.fibre != null && (
        <div className="mt-3 text-xs"><span className="text-muted-foreground">Fibre:</span> <span className="font-semibold">{day.fibre}g</span></div>
      )}
      {day.notes && <p className="mt-3 text-xs text-muted-foreground">{day.notes}</p>}
    </Card>
  );
}

function Macro({ icon: Icon, label, value, unit }: { icon: any; label: string; value: any; unit: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 text-xl font-black">{value ?? "—"}<span className="text-xs font-normal text-muted-foreground ml-1">{unit}</span></div>
    </div>
  );
}