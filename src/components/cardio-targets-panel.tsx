import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Heart, Plus, Pencil, Trash2, Copy, EyeOff, LayoutList, BookOpen, Sparkles, RefreshCw, Link2, Link2Off, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { CardioTargetDialog } from "./cardio-target-dialog";
import { CardioProgramBuilderDialog } from "./cardio-program-builder-dialog";
import { CardioProgramTemplatesDialog } from "./cardio-program-templates-dialog";
import { CardioApplyDefaultsDialog } from "./cardio-apply-defaults-dialog";
import { CardioSyncRenameDialog } from "./cardio-sync-rename-dialog";
import { deriveTarget, formatCalorieTarget, nutritionLabelsFromTargets, findOrphanedCardio, findDefaultFor, DEFAULT_CARDIO_PRESETS, presetToRow } from "@/lib/nutrition-cardio";
import { dayTypeLabel, dayTypeTone } from "@/lib/training-schedule";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CardioTargetsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
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

  const { data: nutritionTargets = [] } = useQuery({
    queryKey: ["client-nutrition-days", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nutrition_targets")
        .select("id,status,nutrition_target_days(day_label)")
        .eq("client_id", clientId)
        .neq("status", "Archived")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const nutritionLabels = nutritionLabelsFromTargets(nutritionTargets as any[]);
  const orphaned = findOrphanedCardio(targets as any[], nutritionLabels);
  const showOrphanBanner = !bannerDismissed && nutritionLabels.length > 0 && orphaned.length > 0;

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

  const syncWithNutrition = async () => {
    if (nutritionLabels.length === 0) {
      toast.error("This client has no active nutrition day types yet.");
      return;
    }
    // Step 1: ensure a default exists for each nutrition day type that has a matching preset
    const inserts: any[] = [];
    for (const preset of DEFAULT_CARDIO_PRESETS) {
      if (!nutritionLabels.includes(preset.day_type)) continue;
      if (!findDefaultFor(targets as any[], preset.day_type)) {
        inserts.push(presetToRow(preset, clientId));
      }
    }
    if (inserts.length) {
      const { error } = await supabase.from("cardio_targets").insert(inserts);
      if (error) return toast.error(error.message);
    }
    if (orphaned.length) {
      setRenameOpen(true);
    }
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    toast.success(`Synced with nutrition day types${inserts.length ? ` · created ${inserts.length}` : ""}`);
  };

  // Group targets by program_name
  const groups: Record<string, any[]> = {};
  (targets as any[]).forEach((t) => {
    const key = t.program_name || "__single__";
    (groups[key] ??= []).push(t);
  });

  return (
    <Card className="border-border bg-card p-4 sm:p-6 md:col-span-3 space-y-4 overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4 shrink-0" /> Cardio Targets
        </h3>
        <div className="flex flex-wrap gap-2">
          <ActionButton size="sm" className="flex-1 bg-gradient-primary font-bold uppercase sm:flex-none" onClick={() => setDefaultsOpen(true)}>
            <Sparkles className="mr-1 h-4 w-4" /> Apply Default Cardio
          </ActionButton>
          <ActionButton size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={syncWithNutrition} jobLabel="Syncing with nutrition">
            <RefreshCw className="mr-1 h-4 w-4" /> Sync With Nutrition
          </ActionButton>
          <ActionButton size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => setTemplatesOpen(true)}>
            <BookOpen className="mr-1 h-4 w-4" /> Assign Saved
          </ActionButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ActionButton size="sm" variant="outline" className="flex-1 sm:flex-none">
                <Plus className="mr-1 h-4 w-4" /> Create Custom
              </ActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("General"); setOpen(true); }}>Simple / General</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("Training Day"); setOpen(true); }}>Training Day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("Rest Day"); setOpen(true); }}>Non-Training / Rest Day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("High Day"); setOpen(true); }}>High Day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditing(null); setDefaultDayType("Custom"); setOpen(true); }}>Custom Day Type</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setBuilderOpen(true)}>
                <LayoutList className="mr-2 h-4 w-4" /> Create Multi-Week Program
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showOrphanBanner && (
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Nutrition day types changed. {orphaned.length} cardio target{orphaned.length > 1 ? "s" : ""} no longer match a nutrition day.
            </span>
          </div>
          <div className="flex gap-2">
            <ActionButton size="sm" variant="outline" onClick={() => setBannerDismissed(true)}>Dismiss</ActionButton>
            <ActionButton size="sm" onClick={() => setRenameOpen(true)}>Sync Names</ActionButton>
          </div>
        </div>
      )}

      {targets.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No cardio targets yet. Tap <span className="font-semibold text-foreground">Apply Default Cardio</span> to set up a quick starter plan.
        </div>
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
                  const linked = nutritionLabels.length > 0 && nutritionLabels.includes(t.day_type);
                  return (
                    <li key={t.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between ${t.enabled === false ? "opacity-60" : ""}`}>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm sm:gap-2">
                        <Badge variant="outline" className={dayTypeTone(t.day_type)}>{dayTypeLabel(t)}</Badge>
                        <Badge variant="outline" className={d.tone}>{d.label}</Badge>
                        <span className="truncate font-semibold">{t.cardio_type === "Custom" ? t.custom_type : t.cardio_type}</span>
                        <span className="w-full text-xs text-muted-foreground sm:w-auto">
                          {t.frequency_per_week ? `${t.frequency_per_week}x/wk` : ""} {t.duration_minutes ? `· ${t.duration_minutes} min` : ""} {t.intensity ? `· ${t.intensity}` : ""}
                        </span>
                        {cal && <Badge variant="outline" className="text-[10px]">{cal}</Badge>}
                        {nutritionLabels.length > 0 && (
                          linked ? (
                            <Badge variant="outline" className="border-success/40 text-[10px] text-success">
                              <Link2 className="mr-1 h-3 w-3" />Linked to {t.day_type} nutrition
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-muted-foreground/40 text-[10px] text-muted-foreground">
                              <Link2Off className="mr-1 h-3 w-3" />Not linked to nutrition day
                            </Badge>
                          )
                        )}
                        {t.enabled === false && (
                          <Badge variant="outline" className="text-[10px]"><EyeOff className="mr-1 h-3 w-3" />Disabled</Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <ActionButton size="icon" variant="ghost" className="h-9 w-9" onClick={() => duplicate(t)} jobLabel="Duplicating cardio target" aria-label="Duplicate"><Copy className="h-4 w-4" /></ActionButton>
                        <ActionButton size="icon" variant="ghost" className="h-9 w-9" onClick={() => { setEditing(t); setDefaultDayType(undefined); setOpen(true); }} aria-label="Edit"><Pencil className="h-4 w-4" /></ActionButton>
                        <ActionButton size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => del(t)} jobLabel="Deleting cardio target" aria-label="Delete"><Trash2 className="h-4 w-4" /></ActionButton>
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
      <CardioApplyDefaultsDialog open={defaultsOpen} onOpenChange={setDefaultsOpen} clientId={clientId} existing={targets as any[]} nutritionLabels={nutritionLabels} />
      <CardioSyncRenameDialog open={renameOpen} onOpenChange={setRenameOpen} clientId={clientId} orphaned={orphaned} nutritionLabels={nutritionLabels.length ? nutritionLabels : ["Training Day","Rest Day","High Day"]} />
    </Card>
  );
}