import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Archive, Trash2 } from "lucide-react";
import { formatCalorieTarget } from "@/lib/nutrition-cardio";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
};

export function CardioProgramTemplatesDialog({ open, onOpenChange, clientId }: Props) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [visibleToClient, setVisibleToClient] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["cardio-program-templates"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cardio_program_templates" as any) as any)
        .select("*").eq("archived", false).order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const selected = (templates as any[]).find((t) => t.id === selectedId);

  const archive = async (id: string) => {
    const { error } = await (supabase.from("cardio_program_templates" as any) as any).update({ archived: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Archived");
    qc.invalidateQueries({ queryKey: ["cardio-program-templates"] });
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    const { error } = await (supabase.from("cardio_program_templates" as any) as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (selectedId === id) setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["cardio-program-templates"] });
  };

  const assign = async () => {
    if (!selected) return;
    setAssigning(true);
    const rows: any[] = selected.rows ?? [];
    const inserts = rows.map((r) => ({
      client_id: clientId,
      program_name: selected.name,
      day_type: r.day_type ?? "Training Day",
      custom_day_type: r.day_type === "Custom" ? (r.custom_day_type || null) : null,
      cardio_type: r.cardio_type ?? "Incline Walking",
      custom_type: r.cardio_type === "Custom" ? (r.custom_type || null) : null,
      frequency_per_week: r.frequency_per_week ? Number(r.frequency_per_week) : null,
      duration_minutes: r.duration_minutes ? Number(r.duration_minutes) : null,
      intensity: r.intensity || null,
      step_target: r.step_target ? Number(r.step_target) : null,
      calorie_target_min: r.calorie_target_min ? Number(r.calorie_target_min) : null,
      calorie_target_max: r.calorie_target_max ? Number(r.calorie_target_max) : null,
      show_calories_to_client: r.show_calories_to_client ?? true,
      client_notes: r.client_notes || null,
      admin_notes: selected.notes || null,
      start_date: startDate,
      end_date: endDate || null,
      status: "Active",
      visible_to_client: visibleToClient,
      enabled: true,
    }));
    const { error } = await supabase.from("cardio_targets").insert(inserts);
    setAssigning(false);
    if (error) return toast.error(error.message);
    toast.success(`Assigned ${inserts.length} cardio target${inserts.length > 1 ? "s" : ""}`);
    qc.invalidateQueries({ queryKey: ["cardio-targets"] });
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Assign Saved Cardio Program</DialogTitle></DialogHeader>
        {templates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No saved templates yet. Create a program and enable "Save as reusable template".
          </div>
        ) : (
          <div className="space-y-2">
            {(templates as any[]).map((t) => {
              const isSel = t.id === selectedId;
              return (
                <div key={t.id} className={`rounded-md border p-3 cursor-pointer ${isSel ? "border-primary bg-primary/5" : "border-border bg-secondary/20"}`} onClick={() => setSelectedId(t.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{(t.rows ?? []).length} rows</div>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <ActionButton size="sm" variant="ghost" onClick={() => archive(t.id)} jobLabel="Archiving template"><Archive className="h-4 w-4" /></ActionButton>
                      <ActionButton size="sm" variant="ghost" className="text-destructive" onClick={() => remove(t.id)} jobLabel="Deleting template"><Trash2 className="h-4 w-4" /></ActionButton>
                    </div>
                  </div>
                  {isSel && (t.rows ?? []).length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {(t.rows as any[]).map((r, i) => {
                        const cal = formatCalorieTarget(r.calorie_target_min ? Number(r.calorie_target_min) : null, r.calorie_target_max ? Number(r.calorie_target_max) : null);
                        return (
                          <li key={i} className="flex flex-wrap gap-2">
                            <Badge variant="outline">{r.day_type}</Badge>
                            <span>{r.cardio_type === "Custom" ? r.custom_type : r.cardio_type}</span>
                            <span className="text-muted-foreground">
                              {r.frequency_per_week ? `${r.frequency_per_week}x/wk` : ""} {r.duration_minutes ? `· ${r.duration_minutes}min` : ""} {r.intensity ? `· ${r.intensity}` : ""} {cal ? `· ${cal}` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div><Label>Start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div><Label>End date (optional)</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
              <Label className="text-xs">Visible to client</Label>
              <Switch checked={visibleToClient} onCheckedChange={setVisibleToClient} />
            </div>
          </div>
        )}

        <DialogFooter>
          <ActionButton variant="outline" onClick={() => onOpenChange(false)}>Cancel</ActionButton>
          <ActionButton onClick={assign} jobLabel="Assigning cardio program" className="bg-gradient-primary font-bold uppercase">
            Assign to Client
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}