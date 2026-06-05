import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Heart, Plus, Pencil, Trash2, Copy, EyeOff, LayoutList, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { CardioTargetDialog } from "./cardio-target-dialog";
import { CardioProgramBuilderDialog } from "./cardio-program-builder-dialog";
import { CardioProgramTemplatesDialog } from "./cardio-program-templates-dialog";
import { deriveTarget, formatCalorieTarget } from "@/lib/nutrition-cardio";
import { dayTypeLabel, dayTypeTone } from "@/lib/training-schedule";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CardioTargetsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [defaultDayType, setDefaultDayType] = useState<string | undefined>(undefined);

  const { data: client } = useQuery({
    queryKey: ["client-prefs", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("preferred_training_days,preferred_rest_days,preferred_high_days").eq("id", clientId).maybeSingle();
      return data;
    },
  });

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

  // Group targets by program_name
  const groups: Record<string, any[]> = {};
  (targets as any[]).forEach((t) => {
    const key = t.program_name || "__single__";
    (groups[key] ??= []).push(t);
  });

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4" /> Cardio Targets
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
            <BookOpen className="mr-1 h-4 w-4" /> Assign Saved
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBuilderOpen(true)}>
            <LayoutList className="mr-1 h-4 w-4" /> Create Program
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-gradient-primary font-bold uppercase">
                <Plus className="mr-1 h-4 w-4" /> Single
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("General"); setOpen(true); }}>Simple / General</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("Training Day"); setOpen(true); }}>Training Day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("Rest Day"); setOpen(true); }}>Rest Day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("High Day"); setOpen(true); }}>High Day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("Custom"); setOpen(true); }}>Custom Day Type</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {targets.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No cardio targets yet.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([programName, items]) => (
            <div key={programName} className="space-y-2">
              {programName !== "__single__" && (
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                  <LayoutList className="h-3.5 w-3.5" /> {programName}
                  <span className="text-muted-foreground">· {items.length} target{items.length > 1 ? "s" : ""}</span>
                </div>
              )}
              <ul className="space-y-2">
                {items.map((t: any) => {
                  const d = deriveTarget(t);
                  const cal = formatCalorieTarget(t.calorie_target_min, t.calorie_target_max);
                  return (
                    <li key={t.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2 ${t.enabled === false ? "opacity-60" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline" className={dayTypeTone(t.day_type)}>{dayTypeLabel(t)}</Badge>
                        <Badge variant="outline" className={d.tone}>{d.label}</Badge>
                        <span className="font-semibold">{t.cardio_type === "Custom" ? t.custom_type : t.cardio_type}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.frequency_per_week ? `${t.frequency_per_week}x/wk` : ""} {t.duration_minutes ? `· ${t.duration_minutes} min` : ""} {t.intensity ? `· ${t.intensity}` : ""}
                        </span>
                        {cal && <Badge variant="outline" className="text-[10px]">{cal}</Badge>}
                        {t.enabled === false && (
                          <Badge variant="outline" className="text-[10px]"><EyeOff className="mr-1 h-3 w-3" />Disabled</Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => duplicate(t)}><Copy className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setDefaultDayType(undefined); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(t)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <CardioTargetDialog open={open} onOpenChange={setOpen} clientId={clientId} initial={editing ?? undefined} defaultDayType={defaultDayType} />
      <CardioProgramBuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} clientId={clientId} client={client as any} />
      <CardioProgramTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} clientId={clientId} />
    </Card>
  );
}