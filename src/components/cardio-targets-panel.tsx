import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Plus, Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { CardioTargetDialog } from "./cardio-target-dialog";
import { deriveTarget } from "@/lib/nutrition-cardio";

export function CardioTargetsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: targets = [] } = useQuery({
    queryKey: ["cardio-targets", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cardio_targets").select("*").eq("client_id", clientId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const del = async (t: any) => {
    if (!confirm("Delete this cardio target?")) return;
    const { error } = await supabase.from("cardio_targets").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    toast.success("Deleted");
  };

  const duplicate = async (t: any) => {
    const { id, created_at, updated_at, ...rest } = t;
    const { error } = await supabase.from("cardio_targets").insert({ ...rest, status: "Active" });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    toast.success("Duplicated");
  };

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4" /> Cardio Targets
        </h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Cardio
        </Button>
      </div>
      {targets.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No cardio targets yet.</div>
      ) : (
        <ul className="space-y-2">
          {targets.map((t: any) => {
            const d = deriveTarget(t);
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className={d.tone}>{d.label}</Badge>
                  <span className="font-semibold">{t.cardio_type === "Custom" ? t.custom_type : t.cardio_type}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.frequency_per_week ? `${t.frequency_per_week}x/wk` : ""} {t.duration_minutes ? `· ${t.duration_minutes} min` : ""} {t.intensity ? `· ${t.intensity}` : ""}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => duplicate(t)}><Copy className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(t)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CardioTargetDialog open={open} onOpenChange={setOpen} clientId={clientId} initial={editing ?? undefined} />
    </Card>
  );
}