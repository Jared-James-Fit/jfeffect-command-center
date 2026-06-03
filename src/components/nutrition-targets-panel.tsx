import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Apple, Plus, Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { NutritionTargetDialog } from "./nutrition-target-dialog";
import { deriveTarget } from "@/lib/nutrition-cardio";

export function NutritionTargetsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

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
    toast.success("Duplicated");
  };

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Apple className="h-4 w-4" /> Nutrition Targets
        </h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Targets
        </Button>
      </div>
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
    </Card>
  );
}