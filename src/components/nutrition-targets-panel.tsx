import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ActionRow, CardHeader, DayRows, MoreButton, PlanDaysView, Section, StatusChip, type DayRow, type PlanViewDay } from "@/components/nutrition/nutrition-ui";
import { Apple, Plus, Pencil, Trash2, Copy, ShoppingCart, BellRing, Send, ChevronRight, RotateCcw, History, Pill } from "lucide-react";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { clientPlansQuery, reuseEarlierPlan } from "@/lib/nutrition-targets/plan-publish";
import { planDate, planPeriod, planUpdatedAt, splitPlans, type PlanRow } from "@/lib/nutrition-targets/plan-history";
import { useServerFn } from "@tanstack/react-start";
import { sendNutritionRequestFn } from "@/lib/nutrition-ai-plans.functions";
import { NUTRITION_PHASES } from "@/lib/nutrition-cardio";
import { Download } from "lucide-react";
import { invalidateGroceryList } from "@/lib/grocery-query-keys";
import { toast } from "sonner";
import { NutritionTargetDialog } from "./nutrition-target-dialog";
import { deriveTarget, phaseLabel } from "@/lib/nutrition-cardio";
import { WaterTargetDialog } from "@/components/progress/water-target-dialog";
import { ensureWaterTarget, formatWater } from "@/lib/water";
import { useAuth } from "@/lib/auth";
import { downloadNutritionTargetsPdf } from "@/lib/nutrition-targets-pdf";
import { GroceryListSheet } from "@/components/nutrition/GroceryListSheet";
import { PlanAiChange } from "@/components/nutrition/PlanAiChange";
import { SupplementList } from "@/components/nutrition/supplements-ui";
import { readPlanSupplements } from "@/lib/nutrition-targets/supplements";
import { cn } from "@/lib/utils";

export function NutritionTargetsPanel({ clientId, className = "md:col-span-3" }: { clientId: string; className?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [waterOpen, setWaterOpen] = useState(false);
  const [groceryOpen, setGroceryOpen] = useState(false);
  const { user, role } = useAuth();
  const sendRequestFn = useServerFn(sendNutritionRequestFn);
  const [requesting, setRequesting] = useState(false);

  // Resolve the client's auth user_id (progress_water_targets is keyed on
  // auth.users.id, but this panel receives clients.id).
  const { data: clientRow } = useQuery({
    queryKey: ["client-user-id", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("user_id, full_name").eq("id", clientId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const clientUserId = clientRow?.user_id ?? null;
  const firstName = String((clientRow as any)?.full_name ?? "").trim().split(/\s+/)[0] || null;

  const { data: waterTarget } = useQuery({
    queryKey: ["water-target", clientUserId],
    enabled: !!clientUserId,
    queryFn: () => ensureWaterTarget(clientUserId!),
    staleTime: 30_000,
  });

  const viewerRole: "owner" | "admin" | "coach" =
    role === "admin" ? "admin" : "coach";

  const { data: targets = [] } = useQuery(clientPlansQuery(clientId));
  const { current, previous } = splitPlans(targets);
  const [reusing, setReusing] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["nutrition-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
    void invalidateGroceryList(qc, clientId);
  };

  /** An earlier plan (or the current one, restarted) becomes the plan from today; what's current moves to Previous plans. */
  const startAgainFrom = async (t: PlanRow) => {
    const what = t.status === "Archived" ? `the ${planPeriod(t)} plan again` : "a new plan from this one";
    if (!confirm(`Start ${what}? It runs from today for a month and the client is notified. The current plan moves to Previous plans with its dates.`)) return;
    setReusing(t.id);
    try {
      const res = await reuseEarlierPlan(clientId, t);
      fireAppEvent("nutrition_targets_updated", clientId);
      toast.success(`Plan is live from today${res.archived ? " · the one before it is in Previous plans" : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't use that plan");
    } finally {
      setReusing(null);
      refresh();
    }
  };

  const del = async (t: any) => {
    if (!confirm(t.status === "Archived"
      ? `Delete the ${planPeriod(t)} plan for good? Previous plans are kept so you can use them again; this can't be undone.`
      : "Delete this nutrition plan for good? This can't be undone. To replace it, update the plan instead: the old one is kept in Previous plans.")) return;
    const { error } = await supabase.from("nutrition_targets").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["nutrition-targets", clientId] });
    void invalidateGroceryList(qc, clientId);
    toast.success("Deleted");
  };

  const downloadPdf = (t: any) => {
    try {
      const days: any[] = t.nutrition_target_days ?? [];
      const valued = days.filter((d) => d.calories != null || d.protein != null || d.carbs != null || d.fats != null);
      const avg = (key: string) => {
        if (!valued.length) return 0;
        const sum = valued.reduce((acc, d) => acc + (Number(d[key]) || 0), 0);
        return sum / valued.length;
      };
      const phaseName = t.phase === "Custom" ? t.custom_phase : t.phase;
      const goalName = t.goal === "Custom" ? t.custom_goal : t.goal;
      downloadNutritionTargetsPdf({
        name: [phaseName, goalName].filter(Boolean).join(" · "),
        calories: avg("calories"),
        protein: avg("protein"),
        carbs: avg("carbs"),
        fats: avg("fats"),
        water: waterTarget?.active_ml ?? undefined,
        notes: t.notes ?? undefined,
        updatedAt: t.updated_at ? new Date(t.updated_at).toLocaleDateString() : undefined,
      });
    } catch (err) {
      console.error("Nutrition targets PDF failed", err);
      toast.error("Couldn't generate PDF. Please try again.");
    }
  };

  const startNewPlan = () => {
    setEditing(null);
    setOpen(true);
  };
  const sendRequest = async (t: any) => {
    setRequesting(true);
    try {
      const phase = (NUTRITION_PHASES as readonly string[]).includes(t.phase) && t.phase !== "Custom" ? t.phase : null;
      await sendRequestFn({ data: { clientId, phase } });
      toast.success("Nutrition update request sent");
      qc.invalidateQueries({ queryKey: ["nutrition-requests", clientId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the request");
    } finally {
      setRequesting(false);
    }
  };
  // The rows come from the database with every column; deriveTarget reads the few it needs.
  const plan: any = current[0] ?? null;
  const d = plan ? deriveTarget(plan) : null;
  const chip =
    !d ? null
    : d.state === "past-due" ? <StatusChip tone="attention">Update overdue</StatusChip>
    : d.state === "due-today" ? <StatusChip tone="attention">Update due today</StatusChip>
    : d.state === "ending-soon" ? <StatusChip tone="attention">Update due in {d.daysRemaining} {d.daysRemaining === 1 ? "day" : "days"}</StatusChip>
    : d.state === "upcoming" && plan.start_date ? <StatusChip>Starts {planDate(plan.start_date)}</StatusChip>
    : null;

  return (
    <Card className={cn("min-w-0 space-y-4 border-border bg-card p-4 md:p-6", className)} data-current-plan>
      <CardHeader
        icon={Apple}
        title="Current plan"
        chip={chip}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MoreButton label="Plan options" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {plan && (
                <>
                  <DropdownMenuItem onClick={() => { setEditing(plan); setOpen(true); }}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit this plan
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => startAgainFrom(plan)} disabled={reusing === plan.id}>
                    <Copy className="mr-2 h-4 w-4" /> Start a new plan from this one
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadPdf(plan)}>
                    <Download className="mr-2 h-4 w-4" /> Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={startNewPlan}>
                <Plus className="mr-2 h-4 w-4" /> Build a new plan
              </DropdownMenuItem>
              {plan && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => del(plan)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete this plan
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {plan ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{planLine(plan)}</p>
          {d && (d.state === "ending-soon" || d.state === "due-today" || d.state === "past-due") && (
            <div className="flex flex-col gap-2 rounded-xl border border-warning/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-[13px]">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                {/* A plan past its date is still the client's plan: nothing takes it away but a new one. */}
                <span>They keep this plan until you update it. The Nutrition Update asks them how it went.</span>
              </p>
              <Button variant="outline" className="h-10 shrink-0 gap-1.5" disabled={requesting} onClick={() => sendRequest(plan)}>
                <Send className="h-4 w-4" /> Send the update now
              </Button>
            </div>
          )}
          {/* A day at a time: its targets (the client's ring), then its meals. */}
          <PlanDaysView
            days={planViewDays(plan)}
            water={clientUserId && waterTarget ? formatWater(waterTarget.active_ml, "L") : null}
            waterNote={waterTarget?.target_source === "auto" ? "Automatic" : null}
            onWater={clientUserId ? () => setWaterOpen(true) : undefined}
          />
          <PlanAiChange clientId={clientId} plan={plan} firstName={firstName} />
          {current.slice(1).map((t: any) => (
            // More than one plan running is rare (two made the same day): each is shown, newest first.
            <div key={t.id} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 text-[13px] text-muted-foreground">Also running: {planLine(t)}</p>
                <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => { setEditing(t); setOpen(true); }}>Open</Button>
              </div>
              <DayRows rows={dayRowsOf(t)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {targets.length ? "No plan running. Use one from Previous plans, or build a new one." : "No plan yet. Send the Nutrition Update above, or build one by hand."}
          </p>
          <Button variant="outline" className="h-10 w-full gap-2 sm:w-auto" onClick={startNewPlan}>
            <Plus className="h-4 w-4" /> Build a plan
          </Button>
        </div>
      )}

      <div className="divide-y divide-border rounded-xl border border-border">
        {plan && (
          <Accordion type="single" collapsible>
            <Section
              value="supplements"
              icon={Pill}
              title="Supplements"
              meta={readPlanSupplements(plan.supplements).items.length ? readPlanSupplements(plan.supplements).items.map((x) => x.name).join(", ") : "None yet"}
            >
              {readPlanSupplements(plan.supplements).items.length ? (
                <SupplementList value={readPlanSupplements(plan.supplements)} />
              ) : (
                <p className="text-[13px] text-muted-foreground">None on this plan. Edit the plan to suggest them from their record (health, medications, diet, drug testing, budget).</p>
              )}
            </Section>
          </Accordion>
        )}
        <ActionRow
          icon={ShoppingCart}
          title="Grocery list"
          value="What they'll shop for"
          onClick={() => setGroceryOpen(true)}
          disabled={!clientUserId}
          trailing={<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        />
        {previous.length > 0 && (
          <Accordion type="single" collapsible>
            <Section value="previous" icon={History} title="Previous plans" meta={`${previous.length}`}>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {previous.map((t: any) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2.5" data-plan="previous">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium">{planPeriod(t)}</div>
                      <div className="text-[13px] text-muted-foreground">{planLine(t, { dates: false })}</div>
                    </div>
                    <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" onClick={() => startAgainFrom(t)} disabled={reusing === t.id} title="Make this the client's plan again, from today">
                      <RotateCcw className="h-3.5 w-3.5" /> Use again
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <MoreButton label="Previous plan options" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditing(t); setOpen(true); }}>
                          <Pencil className="mr-2 h-4 w-4" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => downloadPdf(t)}>
                          <Download className="mr-2 h-4 w-4" /> Download PDF
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => del(t)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            </Section>
          </Accordion>
        )}
      </div>

      {groceryOpen && (
        <GroceryListSheet open={groceryOpen} onOpenChange={setGroceryOpen} clientId={clientId} viewAsUserId={clientUserId} coachPreview />
      )}
      <NutritionTargetDialog open={open} onOpenChange={setOpen} clientId={clientId} initial={editing ?? undefined} />
      {clientUserId && user?.id && (
        <WaterTargetDialog open={waterOpen} onOpenChange={setWaterOpen} userId={clientUserId} currentUserId={user.id} viewerRole={viewerRole} />
      )}
    </Card>
  );
}

/** "Fat Loss · Nov 9 – Dec 9, 2026 · updated Nov 9 · next update in 29 days": the plan in one line. */
function planLine(t: any, opts: { dates?: boolean } = {}): string {
  const d = deriveTarget(t);
  const updated = planUpdatedAt(t);
  return [
    phaseLabel(t),
    opts.dates === false ? null : planPeriod(t),
    updated ? `updated ${planDate(updated.slice(0, 10))}` : null,
    t.status !== "Archived" && t.end_date && d.state === "active" ? `next update in ${d.daysRemaining} days` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The plan's days for the plan view: numbers, steps and meals, in the plan's order. */
function planViewDays(t: any): PlanViewDay[] {
  return (t.nutrition_target_days ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((day: any) => ({
      label: day.day_label,
      kcal: day.calories,
      protein: day.protein,
      carbs: day.carbs,
      fat: day.fats,
      fibre: day.fibre ?? null,
      steps: day.steps ?? null,
      meals: day.notes ?? null,
    }));
}

function dayRowsOf(t: any): DayRow[] {
  return (t.nutrition_target_days ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    // tapping a day opens its meals
    .map((day: any) => ({ label: day.day_label, kcal: day.calories, protein: day.protein, carbs: day.carbs, fat: day.fats, meals: day.notes ?? null }));
}
