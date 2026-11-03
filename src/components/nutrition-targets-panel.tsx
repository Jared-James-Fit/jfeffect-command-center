import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Apple, Plus, Pencil, Trash2, Copy, Droplet, ShoppingCart, BellRing, Send, History, ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
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

export function NutritionTargetsPanel({ clientId }: { clientId: string }) {
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
        .from("clients").select("user_id").eq("id", clientId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const clientUserId = clientRow?.user_id ?? null;

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
  const [showPrevious, setShowPrevious] = useState(false);
  const [reusing, setReusing] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["nutrition-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
    void invalidateGroceryList(qc, clientId);
  };

  /** An earlier plan (or the current one, restarted) becomes the plan from today; what's current moves to Previous plans. */
  const useAgain = async (t: PlanRow) => {
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

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Apple className="h-4 w-4" /> Nutrition Plans
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="font-bold uppercase"
            onClick={() => setGroceryOpen(true)}
            disabled={!clientUserId}
          >
            <ShoppingCart className="mr-2 h-4 w-4" /> Preview Grocery List
          </Button>
          <Button size="sm" className="bg-primary font-semibold" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add plan
          </Button>
        </div>
      {groceryOpen && (
        <GroceryListSheet
          open={groceryOpen}
          onOpenChange={setGroceryOpen}
          clientId={clientId}
          viewAsUserId={clientUserId}
          coachPreview
        />
      )}
      </div>
      {clientUserId && (
        <div className="flex items-center justify-between rounded-md border border-border bg-secondary/20 p-3">
          <div className="flex items-center gap-2">
            <Droplet className="h-4 w-4 text-sky-500" />
            <div>
              <div className="text-sm font-semibold">
                Water target: {waterTarget ? formatWater(waterTarget.active_ml, "L") : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Source: {waterTarget?.target_source ?? "default"} · synced across Home & Nutrition
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setWaterOpen(true)}>
            Set water target
          </Button>
        </div>
      )}
      {targets.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No nutrition plan yet.
        </div>
      ) : (
        <>
          {current.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No current plan. Use one from Previous plans, or add one.
            </div>
          )}
          <ul className="space-y-3">
            {current.map((t: any) => (
              <PlanCard
                key={t.id}
                t={t}
                onEdit={() => { setEditing(t); setOpen(true); }}
                onPdf={() => downloadPdf(t)}
                onDelete={() => del(t)}
                onReuse={() => useAgain(t)}
                reusing={reusing === t.id}
                requestSlot={
                  <UpdateDue
                    t={t}
                    requesting={requesting}
                    onRequest={async () => {
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
                    }}
                  />
                }
              />
            ))}
          </ul>
          {previous.length > 0 && (
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowPrevious((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                aria-expanded={showPrevious}
              >
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <History className="h-4 w-4" /> Previous plans · {previous.length}
                </span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition", showPrevious && "rotate-180")} />
              </button>
              {showPrevious && (
                <ul className="space-y-2 border-t border-border p-3">
                  {previous.map((t: any) => (
                    <PlanCard
                      key={t.id}
                      t={t}
                      compact
                      onEdit={() => { setEditing(t); setOpen(true); }}
                      onPdf={() => downloadPdf(t)}
                      onDelete={() => del(t)}
                      onReuse={() => useAgain(t)}
                      reusing={reusing === t.id}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      <NutritionTargetDialog open={open} onOpenChange={setOpen} clientId={clientId} initial={editing ?? undefined} />
      {clientUserId && user?.id && (
        <WaterTargetDialog
          open={waterOpen}
          onOpenChange={setWaterOpen}
          userId={clientUserId}
          currentUserId={user.id}
          viewerRole={viewerRole}
        />
      )}
    </Card>
  );
}

/** One plan: its dates, when it was last updated, and each day's numbers. */
function PlanCard({
  t,
  compact = false,
  onEdit,
  onPdf,
  onDelete,
  onReuse,
  reusing,
  requestSlot,
}: {
  t: any;
  compact?: boolean;
  onEdit: () => void;
  onPdf: () => void;
  onDelete: () => void;
  onReuse: () => void;
  reusing: boolean;
  requestSlot?: ReactNode;
}) {
  const d = deriveTarget(t);
  const updated = planUpdatedAt(t);
  const archived = t.status === "Archived";
  const days = (t.nutrition_target_days ?? []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order);
  return (
    <li className={cn("rounded-md border border-border p-3", archived ? "bg-card" : "bg-secondary/20")} data-plan={archived ? "previous" : "current"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {!archived && <Badge variant="outline" className={d.tone}>{d.label}</Badge>}
            <span className="text-sm font-semibold">{planPeriod(t)}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {[phaseLabel(t), t.structure, updated ? `Updated ${planDate(updated.slice(0, 10))}` : null].filter(Boolean).join(" · ")}
            {!archived && t.end_date && d.state === "active" ? ` · update due in ${d.daysRemaining} days` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {archived ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onReuse} disabled={reusing} title="Make this the client's plan again, from today">
              <RotateCcw className="h-3.5 w-3.5" /> Use again
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onReuse} disabled={reusing} title="Start a new plan from this one (this one moves to Previous plans)"><Copy className="h-4 w-4" /></Button>
          )}
          <Button size="sm" variant="ghost" onClick={onPdf} title="Download PDF"><Download className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={onEdit} title={archived ? "Open" : "Edit"}><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete} title="Delete"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {requestSlot}
      {days.length > 0 && (
        <div className={cn("mt-2 grid gap-2 text-xs", compact ? "sm:grid-cols-3" : "md:grid-cols-3")}>
          {days.map((day: any) => (
            <div key={day.id} className="rounded border border-border bg-card px-2 py-1.5">
              <div className="font-semibold">{day.day_label}</div>
              <div className="text-muted-foreground">{day.calories ?? "—"} kcal · P {day.protein ?? "—"} / C {day.carbs ?? "—"} / F {day.fats ?? "—"}</div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** The current plan's "update due" strip with Send update request. */
function UpdateDue({ t, requesting, onRequest }: { t: any; requesting: boolean; onRequest: () => void }) {
  const d = deriveTarget(t);
  if (!(d.state === "ending-soon" || d.state === "due-today" || d.state === "past-due")) return null;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <BellRing className="h-4 w-4 shrink-0 text-warning" />
        <span>
          {d.state === "past-due"
            ? `Nutrition update overdue by ${Math.abs(d.daysRemaining)} day${Math.abs(d.daysRemaining) === 1 ? "" : "s"}`
            : d.state === "due-today" ? "Nutrition update due today" : `Nutrition update due in ${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"}`}
          {/* A plan past its date is still the client's plan: nothing takes it away but a new one. */}
          <span className="block font-normal text-muted-foreground">The client keeps this plan until you update it.</span>
        </span>
      </div>
      <Button size="sm" className="h-8 gap-1.5 font-bold" disabled={requesting} onClick={onRequest}>
        <Send className="h-3.5 w-3.5" /> Send update request
      </Button>
    </div>
  );
}
