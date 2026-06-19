import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { ClipboardList, Droplets, FileText } from "lucide-react";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { Button } from "@/components/ui/button";
import { MealPlanDisplay } from "@/components/meal-plan-display";

type Day = {
  id?: string;
  day_label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  notes?: string | null;
};

function MacroCell({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-center">
      <div className="text-base font-black leading-none">
        {value ?? "—"}
        {value != null && unit && (
          <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function DayBlock({ title, day }: { title: string; day: Day | undefined }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
      {day ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            <MacroCell label="Cal" value={day.calories} />
            <MacroCell label="Protein" value={day.protein} unit="g" />
            <MacroCell label="Carbs" value={day.carbs} unit="g" />
            <MacroCell label="Fats" value={day.fats} unit="g" />
          </div>
          {day.notes && day.notes.trim() ? (
            <MealPlanDisplay text={day.notes} />
          ) : null}
        </>
      ) : (
        <div className="text-xs text-muted-foreground">Not set.</div>
      )}
    </div>
  );
}

function pickDay(days: Day[], keywords: string[]): Day | undefined {
  for (const d of days) {
    const label = (d.day_label || "").toLowerCase();
    if (keywords.some((k) => label.includes(k))) return d;
  }
  return undefined;
}

export function AssignedPlanSummary() {
  const fn = useServerFn(getCoachAssignedMealPlan);
  const q = useQuery({
    queryKey: ["m-coach-meal-plan-summary"],
    queryFn: () => fn({}),
    staleTime: 60_000,
  });

  if (q.isLoading) return null;

  const plan = q.data as any;
  if (!plan) {
    return (
      <div className="px-4 md:px-6">
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-widest">Nutrition Plan</div>
              <div className="text-[11px] text-muted-foreground">No nutrition plan assigned yet.</div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const days: Day[] = plan.days ?? [];

  return (
    <div className="px-4 md:px-6">
      <Card className="p-4 md:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-black uppercase tracking-widest">Your Nutrition Plan</div>
            <div className="text-[11px] text-muted-foreground">
              {[plan.phase, plan.goal, plan.structure].filter(Boolean).join(" · ") || "Assigned by your coach"}
            </div>
          </div>
          {plan.pdf_signed_url && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={plan.pdf_signed_url} target="_blank" rel="noreferrer">
                <FileText className="h-3.5 w-3.5" /> {plan.pdf_name || "Open PDF"}
              </a>
            </Button>
          )}
        </div>

        {days.length === 0 ? (
          <div className="text-xs text-muted-foreground">No meal days set yet.</div>
        ) : (
          <div className="space-y-5">
            {days.map((d, i) => (
              <DayBlock key={d.id ?? i} title={d.day_label || `Day ${i + 1}`} day={d} />
            ))}
          </div>
        )}

        {plan.water && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
            <Droplets className="h-4 w-4 text-primary" />
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Water</div>
            <div className="ml-auto text-sm font-black">{plan.water}</div>
          </div>
        )}

        {plan.client_notes && (
          <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs whitespace-pre-wrap">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Coach Notes
            </div>
            {plan.client_notes}
          </div>
        )}
      </Card>
    </div>
  );
}