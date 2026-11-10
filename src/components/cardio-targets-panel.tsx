import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardHeader, MoreButton, StatusChip } from "@/components/nutrition/nutrition-ui";
import { cn } from "@/lib/utils";
import { Heart, Plus, Pencil, Trash2, Copy, LayoutList, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { CardioTargetDialog } from "./cardio-target-dialog";
import { CardioProgramBuilderDialog } from "./cardio-program-builder-dialog";
import { CardioApplyDefaultsDialog } from "./cardio-apply-defaults-dialog";
import { CardioSyncRenameDialog } from "./cardio-sync-rename-dialog";
import { deriveTarget, formatCalorieTarget, nutritionLabelsFromTargets, findOrphanedCardio } from "@/lib/nutrition-cardio";
import { dayTypeLabel } from "@/lib/training-schedule";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cardioActivityLabel } from "@/lib/cardio-activity";

/** A session's dates, only when they're news (a running one says nothing). */
const CARDIO_STATE: Record<string, string> = { "past-due": "Ended", "due-today": "Ends today", "ending-soon": "Ends soon", upcoming: "Starts later", archived: "Archived" };

export function CardioTargetsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
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
        .select("id,status,nutrition_target_days(id,day_label,sort_order)")
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
  const orphanIds = new Set((orphaned as any[]).map((o) => o.id));

  const del = async (t: any) => {
    if (!confirm("Delete this cardio target?")) return;
    const { error } = await supabase.from("cardio_targets").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["cal-client-cardio", clientId] });
    qc.invalidateQueries({ queryKey: ["client-cardio-resolved", clientId] });
    qc.invalidateQueries({ queryKey: ["week-sched-data"] });
    toast.success("Deleted");
  };

  const duplicate = async (t: any) => {
    const { id, created_at, updated_at, ...rest } = t;
    const { error } = await supabase.from("cardio_targets").insert({ ...rest, status: "Active" });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["cal-client-cardio", clientId] });
    qc.invalidateQueries({ queryKey: ["client-cardio-resolved", clientId] });
    qc.invalidateQueries({ queryKey: ["week-sched-data"] });
    toast.success("Duplicated");
  };

  // Group targets by program_name
  const groups: Record<string, any[]> = {};
  (targets as any[]).forEach((t) => {
    const key = t.program_name || "__single__";
    (groups[key] ??= []).push(t);
  });

  const add = (dayType: string) => {
    setEditing(null);
    setDefaultDayType(dayType);
    setOpen(true);
  };

  return (
    <Card className="space-y-4 overflow-hidden border-border bg-card p-4 md:col-span-3 md:p-6" data-cardio-card>
      <CardHeader
        icon={Heart}
        title="Cardio"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10 gap-1.5">
                <Plus className="h-4 w-4" /> Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => setDefaultsOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" /> The default plan for their days
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => add("Training Day")}>Training day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add("Rest Day")}>Non-training day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add("High Day")}>High day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add("General")}>Any day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add("Custom")}>A day type of your own</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setBuilderOpen(true)}>
                <LayoutList className="mr-2 h-4 w-4" /> A multi-week program
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {showOrphanBanner && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/40 px-3 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              The nutrition plan's days changed: {orphaned.length} cardio {orphaned.length > 1 ? "targets don't" : "target doesn't"} match a day any more.
            </span>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" className="h-10" onClick={() => setBannerDismissed(true)}>Not now</Button>
            <Button variant="outline" className="h-10" onClick={() => setRenameOpen(true)}>Match the days</Button>
          </div>
        </div>
      )}

      {targets.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">No cardio yet. The default plan sets a session for each kind of day in one tap.</p>
          <Button variant="outline" className="h-10 w-full gap-2 sm:w-auto" onClick={() => setDefaultsOpen(true)}>
            <Sparkles className="h-4 w-4" /> Add the default plan
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([programName, items]) => (
            <div key={programName} className="space-y-2">
              {programName !== "__single__" && (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <LayoutList className="h-4 w-4" /> <span className="font-medium text-foreground">{programName}</span> · {items.length} {items.length > 1 ? "sessions" : "session"}
                </div>
              )}
              <ul className="divide-y divide-border rounded-xl border border-border">
                {items.map((t: any) => {
                  const d = deriveTarget(t);
                  const cal = formatCalorieTarget(t.calorie_target_min, t.calorie_target_max);
                  // The same rule as the banner: a session for a day the nutrition plan doesn't have.
                  const unlinked = orphanIds.has(t.id);
                  const meta = [
                    dayTypeLabel(t),
                    t.frequency_per_week ? `${t.frequency_per_week}×/wk` : null,
                    t.duration_minutes ? `${t.duration_minutes} min` : null,
                    t.intensity || null,
                    cal || null,
                  ].filter(Boolean);
                  return (
                    <li key={t.id} className={cn("flex items-start gap-2 px-3 py-2.5", t.enabled === false && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-medium">{cardioActivityLabel(t as any)}</span>
                          {/* Only what's news: a session that's ended, not started yet, or switched off. */}
                          {CARDIO_STATE[d.state] && <StatusChip tone={d.state === "past-due" ? "attention" : "neutral"}>{CARDIO_STATE[d.state]}</StatusChip>}
                          {t.enabled === false && <StatusChip>Off</StatusChip>}
                        </div>
                        <div className="mt-0.5 text-[13px] text-muted-foreground">{meta.join(" · ")}</div>
                        {unlinked && <div className="mt-0.5 text-[13px] text-warning">Not on any day of their nutrition plan</div>}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <MoreButton label="Cardio options" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditing(t); setDefaultDayType(undefined); setOpen(true); }}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void duplicate(t)}>
                            <Copy className="mr-2 h-4 w-4" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void del(t)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
      <CardioApplyDefaultsDialog
        open={defaultsOpen}
        onOpenChange={setDefaultsOpen}
        clientId={clientId}
        existing={targets as any[]}
        nutritionLabels={nutritionLabels}
        nutritionDays={(nutritionTargets as any[])[0]?.nutrition_target_days ?? []}
      />
      <CardioSyncRenameDialog open={renameOpen} onOpenChange={setRenameOpen} clientId={clientId} orphaned={orphaned} nutritionLabels={nutritionLabels.length ? nutritionLabels : ["Training Day","Rest Day","High Day"]} />
    </Card>
  );
}
