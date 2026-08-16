import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Apple, Plus, Pencil, Trash2, Copy, Droplet, ShoppingCart } from "lucide-react";
import { Download } from "lucide-react";
import { invalidateGroceryList } from "@/lib/grocery-query-keys";
import { toast } from "sonner";
import { NutritionTargetDialog } from "./nutrition-target-dialog";
import { deriveTarget } from "@/lib/nutrition-cardio";
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

  const { data: targets = [] } = useQuery({
    queryKey: ["nutrition-targets", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nutrition_targets")
        .select("*, nutrition_target_days(*)")
        .eq("client_id", clientId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const del = async (t: any) => {
    if (!confirm("Delete this nutrition target?")) return;
    const { error } = await supabase.from("nutrition_targets").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["nutrition-targets", clientId] });
    void invalidateGroceryList(qc, clientId);
    toast.success("Deleted");
  };

  const duplicate = async (t: any) => {
    const { id, created_at, updated_at, nutrition_target_days, ...rest } = t;
    const { data, error } = await supabase.from("nutrition_targets").insert({ ...rest, status: "Active" }).select("id").single();
    if (error || !data) return toast.error(error?.message ?? "Failed");
    if (nutrition_target_days?.length) {
      const rows = nutrition_target_days.map((d: any) => ({ ...d, id: undefined, target_id: data.id, created_at: undefined }));
      await supabase.from("nutrition_target_days").insert(rows);
    }
    qc.invalidateQueries({ queryKey: ["nutrition-targets", clientId] });
    void invalidateGroceryList(qc, clientId);
    toast.success("Duplicated");
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
          <Apple className="h-4 w-4" /> Nutrition Targets
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
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Targets
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
          No nutrition targets assigned yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {targets.map((t: any) => {
            const d = deriveTarget(t);
            return (
              <li key={t.id} className="rounded-md border border-border bg-secondary/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={d.tone}>{d.label}</Badge>
                    <span className="text-sm font-semibold">{t.phase === "Custom" ? t.custom_phase : t.phase}</span>
                    <span className="text-xs text-muted-foreground">· {t.goal === "Custom" ? t.custom_goal : t.goal}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => duplicate(t)}><Copy className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadPdf(t)} title="Download PDF"><Download className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(t)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t.start_date} → {t.end_date ?? "ongoing"} · {t.structure}
                </div>
                {t.nutrition_target_days?.length > 0 && (
                  <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
                    {t.nutrition_target_days.sort((a: any, b: any) => a.sort_order - b.sort_order).map((day: any) => (
                      <div key={day.id} className="rounded border border-border bg-card px-2 py-1.5">
                        <div className="font-semibold">{day.day_label}</div>
                        <div className="text-muted-foreground">{day.calories ?? "—"} kcal · P {day.protein ?? "—"} / C {day.carbs ?? "—"} / F {day.fats ?? "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
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