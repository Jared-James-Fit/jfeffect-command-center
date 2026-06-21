import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2, Utensils } from "lucide-react";
import { MealPlanDisplay } from "@/components/meal-plan-display";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function MemberMealPlanPanel() {
  const fn = useServerFn(getCoachAssignedMealPlan);
  const q = useQuery({
    queryKey: ["m-coach-meal-plan"],
    queryFn: () => fn({}),
    staleTime: 60_000,
  });

  const plan = q.data;
  const days = plan?.days ?? [];
  const [activeIdx, setActiveIdx] = useState(0);
  const idx = Math.min(activeIdx, Math.max(0, days.length - 1));
  const active = days[idx];
  const anyNotes = useMemo(() => days.some((d: any) => d.notes && String(d.notes).trim()), [days]);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!plan) return;
    setDownloading(true);
    try {
      const { downloadMealPlanPdf } = await import(
        "@/lib/nutrition-targets/meal-plan-pdf"
      );
      downloadMealPlanPdf({
        client_name: (plan as any).client_name ?? null,
        coach_name: (plan as any).coach_name ?? null,
        updated_at: (plan as any).updated_at ?? null,
        start_date: (plan as any).start_date ?? null,
        phase: plan.phase ?? null,
        goal: plan.goal ?? null,
        structure: plan.structure ?? null,
        water: plan.water ?? null,
        sleep: (plan as any).sleep ?? null,
        client_notes: plan.client_notes ?? null,
        disclaimer: "Consult a healthcare professional before starting any new diet or nutrition program.",
        days: days as any[],
      });
    } catch (err) {
      console.error("Failed to generate meal plan PDF", err);
      toast.error("Could not generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  if (q.isLoading || !plan) return null;
  if (!days.length && !plan.pdf_signed_url && !plan.client_notes) return null;

  return (
    <div className="px-4 md:px-6">
      <Card className="p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
              <Utensils className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-widest">Your Meal Plan</div>
              <div className="text-[11px] text-muted-foreground">
                {[plan.phase, plan.goal, plan.structure].filter(Boolean).join(" · ") || "Assigned by your coach"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {plan.pdf_signed_url && (
              <Button asChild size="sm" variant="default" className="gap-1.5">
                <a href={plan.pdf_signed_url} target="_blank" rel="noreferrer" download={plan.pdf_name || "meal-plan.pdf"}>
                  <FileText className="h-3.5 w-3.5" /> Download PDF
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant={plan.pdf_signed_url ? "outline" : "default"}
              className="gap-1.5"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {downloading ? "Preparing…" : "Download Plan"}
            </Button>
          </div>
        </div>

        {days.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {days.map((d: any, i: number) => (
              <button
                key={d.id ?? i}
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition",
                  i === idx
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {d.day_label}
              </button>
            ))}
          </div>
        )}

        {active && (
          <div className="space-y-3">
            {(active.calories != null ||
              active.protein != null ||
              active.carbs != null ||
              active.fats != null) && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Cal", value: active.calories },
                  { label: "Protein", value: active.protein, unit: "g" },
                  { label: "Carbs", value: active.carbs, unit: "g" },
                  { label: "Fats", value: active.fats, unit: "g" },
                ].map((m) => (
                  <div key={m.label} className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-center">
                    <div className="text-lg font-black leading-none">
                      {m.value ?? "—"}
                      {m.value != null && m.unit && (
                        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{m.unit}</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                  </div>
                ))}
              </div>
            )}
            {active.notes && active.notes.trim() ? (
              <MealPlanDisplay text={active.notes} />
            ) : !anyNotes && !plan.pdf_signed_url ? (
              <div className="text-xs text-muted-foreground">
                Your coach hasn't added meal details for this day yet.
              </div>
            ) : null}
          </div>
        )}

        {plan.client_notes && (
          <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs whitespace-pre-wrap">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Coach Notes</div>
            {plan.client_notes}
          </div>
        )}
      </Card>
    </div>
  );
}